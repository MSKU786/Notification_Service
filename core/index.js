const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const { loadPlugins } = require('./pluginLoader');
const { validateNotification } = require('./validate');
const { buildConfig, redact } = require('./config');
const { JobQueue } = require('./queue');

const app = new Koa();
const router = new Router();
const PORT = process.env.PORT || 3000;
const config = buildConfig();
const context = { db: {}, logger: console, config };
const plugins = loadPlugins(config, context);

// Worker: turn a queued job into a provider send via its channel plugin.
// Failed sends are retried with exponential backoff per config.queue.
const queue = new JobQueue({
  logger: console,
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
  ctx.body = {
    id: job.id,
    via: job.type,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: queue.maxAttempts,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
});

// bodyParser must run before the router so ctx.request.body is populated
app.use(bodyParser());
app.use(router.routes());
app.use(router.allowedMethods());

app.listen(PORT, () => {
  const loaded = Object.keys(plugins);
  console.log(`Server running on port ${PORT}`);
  console.log(`Loaded channels: ${loaded.length ? loaded.join(', ') : 'none'}`);
  for (const name of loaded) {
    const cfg = config[name];
    const state = cfg && cfg.configured ? 'configured' : 'mock mode';
    console.log(`  - ${name}: ${state}`);
  }
  console.log('Config:', JSON.stringify(redact(config)));
});
