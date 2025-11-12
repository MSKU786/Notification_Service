const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');

const app = new Koa();
const PORT = process.env.PORT || 3000;
const context = { db: {}, logger: console };

app.use(async (ctx, next) => {
  ctx.db = context.db;
  ctx.logger = context.logger;
  await next();
});

app.use(async (ctx, next) => {
  ctx.logger.log('Request received');
  await next();
});

app.use(router.routes());

(async () => {
  await loadPlugins();
  app.listen(PORT, () => console.log('Server running on port 3000'));
})();
