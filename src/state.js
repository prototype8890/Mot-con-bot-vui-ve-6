
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export async function createDB(file='state.db') {
  const db = await open({ filename: file, driver: sqlite3.Database });
  await db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY,
      token TEXT NOT NULL,
      pair TEXT,
      amountIn TEXT,
      amountOut TEXT,
      buyTx TEXT UNIQUE,
      sellTx TEXT,
      tsBuy INTEGER,
      tsSell INTEGER,
      status TEXT,
      pnlUsd REAL,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS metrics (
      key TEXT PRIMARY KEY,
      value REAL,
      ts INTEGER
    );
  `);
  return db;
}
