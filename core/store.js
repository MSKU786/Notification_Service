const fs = require('fs');
const path = require('path');

/**
 * Job stores: the pluggable persistence layer behind JobQueue.
 *
 * A store is a small key/value interface over job records, keyed by job id:
 *
 *   get(id)   -> job | null
 *   set(job)  -> void   (insert or replace; must persist before returning)
 *   all()     -> job[]  (every job; used for boot-time recovery)
 *
 * Keeping it this narrow is deliberate: swapping the backing for Redis,
 * SQLite or BullMQ later means writing one new class here, with no change to
 * JobQueue or the HTTP layer. MemoryStore is the original in-process Map;
 * FileStore mirrors that Map to a JSON file so jobs survive a restart.
 */
class MemoryStore {
  constructor() {
    this.jobs = new Map();
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  set(job) {
    this.jobs.set(job.id, job);
  }

  all() {
    return [...this.jobs.values()];
  }
}

/**
 * File-backed store. Holds the same in-memory Map for fast reads and mirrors
 * every write to a JSON file on disk, so a restart can recover jobs that were
 * mid-flight. Writes are synchronous and atomic (temp file + rename) so a
 * crash mid-write can't leave a half-written, unparseable file.
 */
class FileStore {
  constructor(file) {
    if (!file || typeof file !== 'string') {
      throw new Error('FileStore requires a file path');
    }
    this.file = path.resolve(file);
    this.jobs = new Map();
    this._load();
  }

  _load() {
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return; // first run, nothing to load
      throw err;
    }
    if (!raw.trim()) return;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A corrupt file shouldn't crash boot; start empty but keep the bad
      // file aside for inspection rather than silently overwriting it.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.file, backup);
      } catch {
        /* best effort */
      }
      return;
    }
    const list = Array.isArray(parsed) ? parsed : [];
    for (const job of list) {
      if (job && typeof job.id === 'string') this.jobs.set(job.id, job);
    }
  }

  _persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...this.jobs.values()], null, 2));
    fs.renameSync(tmp, this.file); // atomic replace on the same volume
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  set(job) {
    this.jobs.set(job.id, job);
    this._persist();
  }

  all() {
    return [...this.jobs.values()];
  }
}

/**
 * Build the store named by config.queue.store ("memory" | "file").
 * Unknown values fall back to memory so a typo never takes the service down.
 */
function createStore(queueConfig = {}, logger = console) {
  const kind = queueConfig.store || 'memory';
  if (kind === 'file') {
    const file = queueConfig.file || 'data/jobs.json';
    logger.log(`[store] using file store at ${path.resolve(file)}`);
    return new FileStore(file);
  }
  if (kind !== 'memory') {
    logger.warn(`[store] unknown store "${kind}", falling back to memory`);
  }
  return new MemoryStore();
}

module.exports = { MemoryStore, FileStore, createStore };
