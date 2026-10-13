const { test } = require('node:test');
const assert = require('node:assert');
const { validateNotification } = require('../core/validate');

test('rejects a non-object body', () => {
  const { errors, value } = validateNotification(null);
  assert.deepStrictEqual(value, {});
  assert.ok(errors.some((e) => /must be a JSON object/.test(e)));
});

test('requires a non-empty string type', () => {
  for (const type of [undefined, '', '   ', 42]) {
    const { errors } = validateNotification({ type, message: 'hi' });
    assert.ok(
      errors.some((e) => /"type" is required/.test(e)),
      `expected type error for ${JSON.stringify(type)}`
    );
  }
});

test('requires a non-empty string message', () => {
  for (const message of [undefined, '', '   ', 42]) {
    const { errors } = validateNotification({ type: 'email', message });
    assert.ok(
      errors.some((e) => /"message" is required/.test(e)),
      `expected message error for ${JSON.stringify(message)}`
    );
  }
});

test('trims type but preserves message whitespace', () => {
  const { errors, value } = validateNotification({
    type: '  email  ',
    message: '  padded body  ',
  });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(value.type, 'email');
  assert.strictEqual(value.message, '  padded body  ');
});

test('"to" must be a string when provided', () => {
  const bad = validateNotification({ type: 'sms', message: 'x', to: 123 });
  assert.ok(bad.errors.some((e) => /"to" must be a string/.test(e)));

  const ok = validateNotification({ type: 'sms', message: 'x', to: '+1555' });
  assert.deepStrictEqual(ok.errors, []);
  assert.strictEqual(ok.value.to, '+1555');
});

test('"meta" must be a plain object when provided', () => {
  for (const meta of ['str', 42, ['a'], null]) {
    const { errors } = validateNotification({
      type: 'email',
      message: 'x',
      meta,
    });
    assert.ok(
      errors.some((e) => /"meta" must be an object/.test(e)),
      `expected meta error for ${JSON.stringify(meta)}`
    );
  }

  const ok = validateNotification({
    type: 'email',
    message: 'x',
    meta: { subject: 'Hi' },
  });
  assert.deepStrictEqual(ok.errors, []);
  assert.deepStrictEqual(ok.value.meta, { subject: 'Hi' });
});

test('a fully valid request normalizes cleanly', () => {
  const { errors, value } = validateNotification({
    type: 'email',
    message: 'body',
    to: 'a@b.com',
    meta: { subject: 'S' },
  });
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(value, {
    type: 'email',
    message: 'body',
    to: 'a@b.com',
    meta: { subject: 'S' },
  });
});
