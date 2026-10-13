const { test } = require('node:test');
const assert = require('node:assert');
const { JobQueue } = require('../core/queue');

const silent = { log() {}, error() {}, info() {}, warn() {} };

// Wait until a job leaves the non-terminal states, or time out.
function waitFor(queue, id, { timeout = 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const job = queue.get(id);
      if (job && (job.status === 'sent' || job.status === 'failed')) {
        return resolve(job);
      }
      if (Date.now() - started > timeout) {
        return reject(new Error(`timed out waiting for ${id}`));
      }
      setImmediate(tick);
    };
    tick();
  });
}

test('constructor requires a processor function', () => {
  assert.throws(() => new JobQueue({ logger: silent }), /requires a processor/);
  assert.throws(() => new JobQueue({ processor: 42, logger: silent }), /requires a processor/);
});

test('constructor rejects a non-positive maxAttempts', () => {
  const p = async () => 'ok';
  assert.throws(() => new JobQueue({ processor: p, maxAttempts: 0, logger: silent }), /positive integer/);
  assert.throws(() => new JobQueue({ processor: p, maxAttempts: 1.5, logger: silent }), /positive integer/);
});

test('enqueue returns a queued job with an id and timestamps', () => {
  const queue = new JobQueue({ processor: async () => 'ok', logger: silent });
  const job = queue.enqueue({ type: 'email', payload: { message: 'hi' } });
  assert.ok(job.id);
  assert.strictEqual(job.status, 'queued');
  assert.strictEqual(job.attempts, 0);
  assert.strictEqual(job.result, null);
  assert.strictEqual(job.error, null);
  assert.ok(job.createdAt);
  assert.strictEqual(queue.get(job.id), job);
});

test('get returns null for an unknown id', () => {
  const queue = new JobQueue({ processor: async () => 'ok', logger: silent });
  assert.strictEqual(queue.get('nope'), null);
});

test('a started worker processes a job to "sent" and stores the result', async () => {
  const queue = new JobQueue({
    processor: async (job) => ({ echoed: job.payload.message }),
    logger: silent,
  });
  queue.start();
  const job = queue.enqueue({ type: 'email', payload: { message: 'hello' } });
  const done = await waitFor(queue, job.id);
  assert.strictEqual(done.status, 'sent');
  assert.strictEqual(done.attempts, 1);
  assert.deepStrictEqual(done.result, { echoed: 'hello' });
  assert.strictEqual(done.error, null);
});

test('a throwing processor marks the job "failed" when retries are disabled', async () => {
  const queue = new JobQueue({
    maxAttempts: 1, // no retries
    processor: async () => {
      throw new Error('provider exploded');
    },
    logger: silent,
  });
  queue.start();
  const job = queue.enqueue({ type: 'sms', payload: {} });
  const done = await waitFor(queue, job.id);
  assert.strictEqual(done.status, 'failed');
  assert.strictEqual(done.error, 'provider exploded');
  assert.strictEqual(done.result, null);
  assert.strictEqual(done.attempts, 1);
});

test('a transient failure is retried and eventually succeeds', async () => {
  let calls = 0;
  const queue = new JobQueue({
    maxAttempts: 3,
    backoff: () => 1, // near-instant retries keep the test fast
    processor: async () => {
      calls += 1;
      if (calls < 3) throw new Error(`flaky #${calls}`);
      return { ok: true, calls };
    },
    logger: silent,
  });
  queue.start();
  const job = queue.enqueue({ type: 'email', payload: {} });
  const done = await waitFor(queue, job.id);
  assert.strictEqual(done.status, 'sent');
  assert.strictEqual(done.attempts, 3);
  assert.deepStrictEqual(done.result, { ok: true, calls: 3 });
  // a successful send clears the last transient error
  assert.strictEqual(done.error, null);
});

test('a job that keeps failing is given up after maxAttempts', async () => {
  let calls = 0;
  const queue = new JobQueue({
    maxAttempts: 3,
    backoff: () => 1,
    processor: async () => {
      calls += 1;
      throw new Error('always down');
    },
    logger: silent,
  });
  queue.start();
  const job = queue.enqueue({ type: 'sms', payload: {} });
  const done = await waitFor(queue, job.id);
  assert.strictEqual(done.status, 'failed');
  assert.strictEqual(done.attempts, 3);
  assert.strictEqual(calls, 3);
  assert.strictEqual(done.error, 'always down');
});

test('the default backoff grows exponentially up to the cap', () => {
  const queue = new JobQueue({
    processor: async () => 'ok',
    baseDelayMs: 500,
    maxDelayMs: 4000,
    logger: silent,
  });
  assert.strictEqual(queue.backoff(1), 500); // 500 * 2^0
  assert.strictEqual(queue.backoff(2), 1000); // 500 * 2^1
  assert.strictEqual(queue.backoff(3), 2000); // 500 * 2^2
  assert.strictEqual(queue.backoff(4), 4000); // capped (would be 4000)
  assert.strictEqual(queue.backoff(5), 4000); // capped (would be 8000)
});

test('stop() cancels a scheduled retry', async () => {
  const queue = new JobQueue({
    maxAttempts: 5,
    backoff: () => 40,
    processor: async () => {
      throw new Error('down');
    },
    logger: silent,
  });
  queue.start();
  const job = queue.enqueue({ type: 'email', payload: {} });
  // Wait for the first attempt to fail and schedule a retry.
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(queue.get(job.id).status, 'retrying');
  queue.stop();
  const attemptsAtStop = queue.get(job.id).attempts;
  // After the backoff window the retry must NOT have fired.
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(queue.get(job.id).attempts, attemptsAtStop);
  assert.strictEqual(queue.get(job.id).status, 'retrying');
});

test('jobs enqueued before start() are drained once started', async () => {
  const queue = new JobQueue({ processor: async () => 'ok', logger: silent });
  const a = queue.enqueue({ type: 'email', payload: {} });
  const b = queue.enqueue({ type: 'sms', payload: {} });
  // Nothing runs while stopped.
  assert.strictEqual(queue.get(a.id).status, 'queued');
  queue.start();
  await waitFor(queue, a.id);
  await waitFor(queue, b.id);
  assert.strictEqual(queue.get(a.id).status, 'sent');
  assert.strictEqual(queue.get(b.id).status, 'sent');
});

test('stop() halts processing of remaining pending jobs', async () => {
  let processed = 0;
  const queue = new JobQueue({
    processor: async () => {
      processed += 1;
      queue.stop(); // stop after the first job begins draining
      return 'ok';
    },
    logger: silent,
  });
  queue.start();
  const first = queue.enqueue({ type: 'email', payload: {} });
  const second = queue.enqueue({ type: 'email', payload: {} });
  await waitFor(queue, first.id);
  // Give the loop a chance to (not) pick up the second job.
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(processed, 1);
  assert.strictEqual(queue.get(second.id).status, 'queued');
});

test('each processed job gets a fresh, increasing updatedAt', async () => {
  const queue = new JobQueue({ processor: async () => 'ok', logger: silent });
  queue.start();
  const job = queue.enqueue({ type: 'email', payload: {} });
  const createdAt = job.createdAt;
  const done = await waitFor(queue, job.id);
  assert.ok(done.updatedAt >= createdAt);
});
