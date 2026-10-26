const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const { loadPlugins } = require('./pluginLoader');
const { validateNotification } = require('./validate');
const { buildConfig, redact } = require('./config');
const { JobQueue } = require('./queue');
const { createStore } = require('./store');

const app = new Koa();
const router = new Router();
const PORT = process.env.PORT || 3000;
const config = buildConfig();
const context = { db: {}, logger: console, config };
const plugins = loadPlugins(config, context);

// Worker: turn a queued job into a provider send via its channel plugin.
// Failed sends are retried with exponential backoff per config.queue.
const store = createStore(config.queue, console);
const queue = new JobQueue({
  logger: console,
  store,
  maxAttempts: config.queue.maxAttempts,
  baseDelayMs: config.queue.baseDelayMs,
  maxDelayMs: config.queue.maxDelayMs,
  processor: async (job) => {
    const plugin = plugins[job.type];
    if (!plugin) throw new Error(`Unknown channel: ${job.type}`);
    return plugin.send(job.payload, context);
  },
});
queue.start();
// Resume any jobs a previous run left mid-flight (file store only).
queue.recover();

// attach shared context to every request
app.use(async (ctx, next) => {
  ctx.db = context.db;
  ctx.logger = context.logger;
  await next();
});

app.use(async (ctx, next) => {
  ctx.logger.log('Request received');
  await next();
});

// Compact view of a job for list/detail responses (payload omitted to keep
// listings light; the detail route adds `result`).
const summarize = (job) => ({
  id: job.id,
  via: job.type,
  status: job.status,
  attempts: job.attempts,
  maxAttempts: queue.maxAttempts,
  error: job.error,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const JOB_STATUSES = ['queued', 'processing', 'retrying', 'sent', 'failed'];

router.post('/notify', async (ctx) => {
  const body = ctx.request.body || {};
  const { errors, value } = validateNotification(body);

  if (errors.length) {
    ctx.status = 400;
    ctx.body = { error: 'Invalid request', details: errors };
    return;
  }

  const { type, to, message, meta } = value;
  if (!plugins[type]) {
    ctx.status = 404;
    ctx.body = {
      error: `Unknown channel: ${type}`,
      available: Object.keys(plugins),
    };
    return;
  }

  // Enqueue and return immediately — delivery happens in the background worker.
  const job = queue.enqueue({ type, payload: { to, message, meta } });
  ctx.status = 202;
  ctx.body = {
    id: job.id,
    status: 'queued', // accepted state; poll statusUrl for progress
    via: type,
    statusUrl: `/notify/${job.id}`,
  };
});

router.get('/notify/:id', async (ctx) => {
  const job = queue.get(ctx.params.id);
  if (!job) {
    ctx.status = 404;
    ctx.body = { error: 'Job not found' };
    return;
  }
  ctx.status = 200;
  ctx.body = { ...summarize(job), result: job.result };
});

// List jobs, newest first. ?status=failed is the dead-letter view.
router.get('/jobs', async (ctx) => {
  const status = ctx.query.status;
  if (status && !JOB_STATUSES.includes(status)) {
    ctx.status = 400;
    ctx.body = { error: `Invalid status "${status}"`, valid: JOB_STATUSES };
    return;
  }
  const jobs = queue.list({ status });
  ctx.status = 200;
  ctx.body = { count: jobs.length, jobs: jobs.map(summarize) };
});

// Manually requeue a dead-lettered (failed) job with a fresh retry budget.
router.post('/notify/:id/retry', async (ctx) => {
  const outcome = queue.requeue(ctx.params.id);
  if (!outcome) {
    ctx.status = 404;
    ctx.body = { error: 'Job not found' };
    return;
  }
  if (!outcome.requeued) {
    ctx.status = 409;
    ctx.body = {
      error: `Only failed jobs can be retried (job is "${outcome.job.status}")`,
    };
    return;
  }
  ctx.status = 202;
  ctx.body = {
    id: outcome.job.id,
    status: 'queued',
    via: outcome.job.type,
    statusUrl: `/notify/${outcome.job.id}`,
  };
});

// bodyParser must run before the router so ctx.request.body is populated
app.use(bodyParser());
app.use(router.routes());
app.use(router.allowedMethods());

app.listen(PORT, () => {
  const loaded = Object.keys(plugins);
  console.log(`Server running on port ${PORT}`);
  console.log(`Job store: ${config.queue.store}`);
  console.log(`Loaded channels: ${loaded.length ? loaded.join(', ') : 'none'}`);
  for (const name of loaded) {
    const cfg = config[name];
    const state = cfg && cfg.configured ? 'configured' : 'mock mode';
    console.log(`  - ${name}: ${state}`);
  }
  console.log('Config:', JSON.stringify(redact(config)));
});
