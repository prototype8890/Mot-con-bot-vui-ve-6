import { promises as fs } from 'fs';
import path from 'path';

export class AnalyticsStore {
  constructor({ dbPath = 'data/analytics.db', enabled = true } = {}) {
    this.dbPath = dbPath;
    this.enabled = enabled;
    this.ready = false;
    this.mode = 'json';
    this.buffer = [];
    this.sqlite = null;
  }

  async init() {
    if (!this.enabled) return;

    try {
      const { default: Database } = await import('better-sqlite3');
      this.sqlite = new Database(this.dbPath);
      this.sqlite.pragma('journal_mode = WAL');
      this.sqlite.exec(`CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT,
        pair TEXT,
        action TEXT,
        amount REAL,
        pnl REAL,
        gas REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT
      );`);
      this.sqlite.exec(`CREATE TABLE IF NOT EXISTS detections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT,
        pair TEXT,
        score REAL,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`);
      this.mode = 'sqlite';
      this.ready = true;
    } catch (error) {
      console.warn('[AnalyticsStore] SQLite unavailable, falling back to JSON storage:', error.message);
      await this.ensureDir();
      this.mode = 'json';
      this.ready = true;
    }
  }

  async ensureDir() {
    const dir = path.dirname(this.dbPath);
    await fs.mkdir(dir, { recursive: true });
  }

  async flush() {
    if (!this.enabled || this.mode !== 'json' || this.buffer.length === 0) return;
    await this.ensureDir();
    const file = this.dbPath.replace(/\.db$/i, '.json');
    let existing = [];
    try {
      const data = await fs.readFile(file, 'utf8');
      existing = JSON.parse(data);
    } catch {}
    existing.push(...this.buffer);
    await fs.writeFile(file, JSON.stringify(existing, null, 2));
    this.buffer.length = 0;
  }

  async recordDetection(entry) {
    if (!this.enabled) return;
    const payload = { type: 'detection', ...entry };
    if (this.mode === 'sqlite') {
      this.sqlite.prepare('INSERT INTO detections (token, pair, score, reason) VALUES (?, ?, ?, ?)')
        .run(entry.token, entry.pair, entry.score ?? null, entry.reason ?? null);
    } else {
      this.buffer.push(payload);
      await this.flush();
    }
  }

  async recordTrade(entry) {
    if (!this.enabled) return;
    const payload = { type: 'trade', ...entry };
    if (this.mode === 'sqlite') {
      this.sqlite.prepare('INSERT INTO trades (token, pair, action, amount, pnl, gas, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(entry.token, entry.pair, entry.action, entry.amount ?? null, entry.pnl ?? null, entry.gas ?? null, JSON.stringify(entry.metadata || {}));
    } else {
      this.buffer.push(payload);
      await this.flush();
    }
  }

  async close() {
    if (!this.enabled) return;
    if (this.mode === 'sqlite' && this.sqlite) {
      this.sqlite.close();
    }
    if (this.mode === 'json') {
      await this.flush();
    }
  }
}

