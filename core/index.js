const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const { loadPlugins } = require('./pluginLoader');

const app = new Koa();
const router = new Router();
const PORT = process.env.PORT || 3000;
const context = { db: {}, logger: console };
const plugins = loadPlugins();

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
  const { type, message } = ctx.request.body || {};
  if (!type || !message) {
    ctx.status = 400;
    ctx.body = { error: 'Required fields are missing: type, message' };
    return;
  }

  const plugin = plugins[type];
  if (!plugin) {
    ctx.status = 404;
    ctx.body = { error: `Invalid channel: ${type}` };
    return;
  }

  await plugin.send(message, ctx);
  ctx.body = { status: 'sent', via: type };
});

// bodyParser must run before the router so ctx.request.body is populated
app.use(bodyParser());
app.use(router.routes());
app.use(router.allowedMethods());

app.listen(PORT, () => {
  const loaded = Object.keys(plugins);
  console.log(`Server running on port ${PORT}`);
  console.log(`Loaded channels: ${loaded.length ? loaded.join(', ') : 'none'}`);
});
