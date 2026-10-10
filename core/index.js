const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const { loadPlugins } = require('./pluginLoader');
const { validateNotification } = require('./validate');
const { buildConfig, redact } = require('./config');

const app = new Koa();
const router = new Router();
const PORT = process.env.PORT || 3000;
const config = buildConfig();
const context = { db: {}, logger: console, config };
const plugins = loadPlugins(config, context);

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
  const plugin = plugins[type];
  if (!plugin) {
    ctx.status = 404;
    ctx.body = {
      error: `Unknown channel: ${type}`,
      available: Object.keys(plugins),
    };
    return;
  }

  try {
    const result = await plugin.send({ to, message, meta }, ctx);
    ctx.status = 200;
    ctx.body = { status: 'sent', via: type, result };
  } catch (err) {
    ctx.logger.error(`[${type}] send failed: ${err.message}`);
    ctx.status = 502;
    ctx.body = { status: 'failed', via: type, error: err.message };
  }
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
