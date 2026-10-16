const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MemoryStore, FileStore, createStore } = require('../core/store');

const silent = { log() {}, error() {}, info() {}, warn() {} };

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-store-'));
  return path.join(dir, 'jobs.json');
}

function sampleJob(id, status = 'queued') {
  return { id, type: 'email', payload: { message: 'hi' }, status, attempts: 0 };
}

test('MemoryStore: set / get / all round-trip', () => {
  const s = new MemoryStore();
  assert.strictEqual(s.get('x'), null);
  s.set(sampleJob('x'));
  assert.strictEqual(s.get('x').id, 'x');
  s.set(sampleJob('y'));
  assert.deepStrictEqual(s.all().map((j) => j.id).sort(), ['x', 'y']);
});

test('MemoryStore: set replaces an existing job', () => {
  const s = new MemoryStore();
  s.set(sampleJob('x', 'queued'));
  s.set(sampleJob('x', 'sent'));
  assert.strictEqual(s.get('x').status, 'sent');
  assert.strictEqual(s.all().length, 1);
});

test('FileStore: requires a path', () => {
  assert.throws(() => new FileStore(), /requires a file path/);
  assert.throws(() => new FileStore(42), /requires a file path/);
});

test('FileStore: persists writes to disk and creates the dir', () => {
  const file = tmpFile();
  const s = new FileStore(file);
  s.set(sampleJob('a', 'sent'));
  assert.ok(fs.existsSync(file));
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(onDisk.length, 1);
  assert.strictEqual(onDisk[0].id, 'a');
  assert.strictEqual(onDisk[0].status, 'sent');
});

test('FileStore: a new instance reloads jobs from the same file', () => {
  const file = tmpFile();
  const first = new FileStore(file);
  first.set(sampleJob('a', 'queued'));
  first.set(sampleJob('b', 'failed'));

  const second = new FileStore(file); // simulates a restart
  assert.deepStrictEqual(second.all().map((j) => j.id).sort(), ['a', 'b']);
  assert.strictEqual(second.get('b').status, 'failed');
});

test('FileStore: missing file starts empty, not an error', () => {
  const file = tmpFile();
  const s = new FileStore(file); // file does not exist yet
  assert.deepStrictEqual(s.all(), []);
});

test('FileStore: a corrupt file is set aside and the store starts empty', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ this is not json');
  const s = new FileStore(file);
  assert.deepStrictEqual(s.all(), []);
  // the bad file was renamed aside, not left in place
  assert.ok(!fs.existsSync(file));
  const siblings = fs.readdirSync(path.dirname(file));
  assert.ok(siblings.some((f) => f.includes('.corrupt-')));
});

test('createStore: defaults to MemoryStore', () => {
  assert.ok(createStore({}, silent) instanceof MemoryStore);
  assert.ok(createStore({ store: 'memory' }, silent) instanceof MemoryStore);
});

test('createStore: builds a FileStore for store="file"', () => {
  const file = tmpFile();
  const s = createStore({ store: 'file', file }, silent);
  assert.ok(s instanceof FileStore);
});

test('createStore: unknown store falls back to memory', () => {
  assert.ok(createStore({ store: 'redis' }, silent) instanceof MemoryStore);
});
