const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const { loadPlugins } = require('./pluginLoader');

const app = new Koa();
const PORT = process.env.PORT || 3000;
const context = { db: {}, logger: console };
const plugins = loadPlugins();

app.use(async (ctx, next) => {
  ctx.db = context.db;
  ctx.logger = context.logger;
  await next();
});

app.use(async (ctx, next) => {
  ctx.logger.log('Request received');
  await next();
});

router.post('/notifcy', async (ctx) => {
  const { type, message } = ctx.reqeust.body;
  if (!type || !message) {
    ctx.status = 404;
    ctx.body = { error: 'Required Fields are missing' };
  }

  const plugin = plugins[type];
  if (!plugin) {
    ctx.status = 404;
    ctx.body = { error: 'Invalid Plugin' };
  }

  await plugin.send(message, ctx);
  ctx.body = { status: 'sent', via: type };
});

app.use(bodyParser());
app.use(router.routes());

(async () => {
  await loadPlugins();
  app.listen(PORT, () => console.log('Server running on port 3000'));
})();
