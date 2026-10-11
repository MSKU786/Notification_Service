const crypto = require('crypto');

/**
 * In-memory job queue with a background worker.
 *
 * This is intentionally a thin abstraction (enqueue / get / start / stop) so
 * the in-memory backing can later be swapped for Redis/BullMQ without the
 * HTTP layer changing. Jobs move: queued -> processing -> sent | failed.
 *
 * The `processor` is an async fn (job) => result. Throwing marks the job
 * failed; returning a value marks it sent and stores the value as result.
 */
class JobQueue {
  constructor({ processor, logger = console } = {}) {
    if (typeof processor !== 'function') {
      throw new Error('JobQueue requires a processor function');
    }
    this.processor = processor;
    this.logger = logger;
    this.jobs = new Map(); // id -> job
    this.pending = []; // ids awaiting processing
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
    this.jobs.set(job.id, job);
    this.pending.push(job.id);
    this.logger.log(`[queue] enqueued ${job.id} (${type})`);
    if (this.running) this._drain();
    return job;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  start() {
    this.running = true;
    this._drain();
  }

  stop() {
    this.running = false;
  }

  _touch(job, patch) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  }

  async _drain() {
    if (this.draining || !this.running) return;
    this.draining = true;
    try {
      while (this.running && this.pending.length > 0) {
        const id = this.pending.shift();
        const job = this.jobs.get(id);
        if (!job) continue;

        this._touch(job, { status: 'processing', attempts: job.attempts + 1 });
        try {
          const result = await this.processor(job);
          this._touch(job, { status: 'sent', result });
          this.logger.log(`[queue] sent ${job.id}`);
        } catch (err) {
          this._touch(job, { status: 'failed', error: err.message });
          this.logger.error(`[queue] failed ${job.id}: ${err.message}`);
        }
      }
    } finally {
      this.draining = false;
    }
  }
}

module.exports = { JobQueue };
