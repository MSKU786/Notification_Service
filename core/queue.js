const crypto = require('crypto');
const { MemoryStore } = require('./store');

/**
 * Background job queue with a pluggable persistence store.
 *
 * The backing store (see store.js) is a thin get/set/all interface, so the
 * in-memory default can be swapped for a file/Redis/BullMQ store without the
 * HTTP layer changing. Jobs move:
 *
 *   queued -> processing -> sent
 *                        -> retrying -> processing -> ... -> failed
 *
 * The `processor` is an async fn (job) => result. Throwing fails the attempt:
 * while attempts remain the job is rescheduled after a backoff delay; once
 * `maxAttempts` is reached it becomes `failed`. Returning a value marks the
 * job `sent` and stores the value as its result.
 *
 * Retry policy (all optional):
 *   maxAttempts  total attempts before a job is given up as failed (default 3)
 *   backoff      (attempts) => delayMs for the wait BEFORE the next attempt.
 *                Defaults to exponential: baseDelayMs * 2^(attempts-1),
 *                capped at maxDelayMs.
 *   baseDelayMs  first retry delay, doubled each attempt (default 500)
 *   maxDelayMs   ceiling for the exponential delay (default 30000)
 */
class JobQueue {
  constructor({
    processor,
    logger = console,
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 30000,
    backoff,
    store,
  } = {}) {
    if (typeof processor !== 'function') {
      throw new Error('JobQueue requires a processor function');
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error('JobQueue maxAttempts must be a positive integer');
    }
    this.processor = processor;
    this.logger = logger;
    this.store = store || new MemoryStore();
    this.maxAttempts = maxAttempts;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.backoff =
      typeof backoff === 'function'
        ? backoff
        : (attempts) =>
            Math.min(this.baseDelayMs * 2 ** (attempts - 1), this.maxDelayMs);
    this.pending = []; // ids awaiting processing
    this.timers = new Set(); // outstanding retry timers
    this.running = false; // worker loop active
    this.draining = false; // a drain pass is in flight
  }

  enqueue({ type, payload }) {
    const now = new Date().toISOString();
    const job = {
      id: crypto.randomUUID(),
      type,
      payload,
      status: 'queued',
      attempts: 0,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(job);
    this.pending.push(job.id);
    this.logger.log(`[queue] enqueued ${job.id} (${type})`);
    if (this.running) this._drain();
    return job;
  }

  get(id) {
    return this.store.get(id);
  }

  // List jobs, newest first, optionally filtered by status. Used by the
  // dead-letter view (status: 'failed') and general job inspection.
  list({ status } = {}) {
    let jobs = this.store.all();
    if (status) jobs = jobs.filter((j) => j.status === status);
    return jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  // Manually requeue a dead-lettered (failed) job — e.g. after the provider
  // outage that failed it is resolved. The attempt count resets so the job
  // gets a fresh retry budget. Returns:
  //   null                       job id not found
  //   { requeued: false, job }   job exists but isn't in a failed state
  //   { requeued: true,  job }   job was reset to queued and re-enqueued
  requeue(id) {
    const job = this.store.get(id);
    if (!job) return null;
    if (job.status !== 'failed') return { requeued: false, job };
    this._touch(job, { status: 'queued', attempts: 0, error: null, result: null });
    this.pending.push(job.id);
    this.logger.log(`[queue] requeued ${job.id} from dead-letter`);
    if (this.running) this._drain();
    return { requeued: true, job };
  }

  // Re-queue jobs the store held in a non-terminal state — e.g. a restart
  // interrupted them mid-flight. Their attempt count is preserved, so the
  // retry budget still applies. Terminal jobs (sent/failed) are left as-is.
  recover() {
    let recovered = 0;
    for (const job of this.store.all()) {
      if (job.status === 'sent' || job.status === 'failed') continue;
      if (job.status !== 'queued') {
        this._touch(job, { status: 'queued' });
      }
      this.pending.push(job.id);
      recovered += 1;
    }
    if (recovered) {
      this.logger.log(`[queue] recovered ${recovered} pending job(s)`);
      if (this.running) this._drain();
    }
    return recovered;
  }

  start() {
    this.running = true;
    this._drain();
  }

  stop() {
    this.running = false;
    // Cancel any pending retry timers so a stopped queue stays idle.
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  _touch(job, patch) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    this.store.set(job); // persist every state transition
  }

  async _drain() {
    if (this.draining || !this.running) return;
    this.draining = true;
    try {
      while (this.running && this.pending.length > 0) {
        const id = this.pending.shift();
        const job = this.store.get(id);
        if (!job) continue;

        this._touch(job, { status: 'processing', attempts: job.attempts + 1 });
        try {
          const result = await this.processor(job);
          this._touch(job, { status: 'sent', result, error: null });
          this.logger.log(`[queue] sent ${job.id}`);
        } catch (err) {
          this._onAttemptFailed(job, err);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  // Decide what happens after a processor throws: retry with backoff while
  // attempts remain, otherwise give up and mark the job failed.
  _onAttemptFailed(job, err) {
    if (job.attempts < this.maxAttempts) {
      const delay = this.backoff(job.attempts);
      this._touch(job, { status: 'retrying', error: err.message });
      this.logger.warn(
        `[queue] attempt ${job.attempts}/${this.maxAttempts} failed for ` +
          `${job.id}: ${err.message} — retrying in ${delay}ms`
      );
      this._scheduleRetry(job, delay);
    } else {
      this._touch(job, { status: 'failed', error: err.message });
      this.logger.error(
        `[queue] failed ${job.id} after ${job.attempts} attempts: ${err.message}`
      );
    }
  }

  _scheduleRetry(job, delay) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.running) return; // stopped while waiting
      this.pending.push(job.id);
      this._drain();
    }, delay);
    // Don't let a pending retry keep the process alive on its own.
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.add(timer);
  }
}

module.exports = { JobQueue };
