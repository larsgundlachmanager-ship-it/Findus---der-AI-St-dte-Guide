/**
 * LTM v1 — lokale User-Fakten (SQLite, keyword + subject).
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { runExclusiveDbWrite } from './dbWriteLock';

export type UserMemoryFact = {
  id: string;
  subject: string;
  keyword: string;
  fact: string;
  sourceTurnId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

const MAX_FACTS = 400;

export async function ensureUserMemoryFactsTable(
  db: SQLiteDatabase,
): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS user_memory_facts (
      id TEXT PRIMARY KEY NOT NULL,
      subject TEXT NOT NULL,
      keyword TEXT NOT NULL,
      fact TEXT NOT NULL,
      source_turn_id TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS user_memory_facts_subject_idx
      ON user_memory_facts (subject);
    CREATE INDEX IF NOT EXISTS user_memory_facts_keyword_idx
      ON user_memory_facts (keyword);
  `);
}

function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}

export async function upsertUserMemoryFacts(opts: {
  subject: string;
  facts: string[];
  sourceTurnId?: string | null;
}): Promise<void> {
  const subject = slug(opts.subject || 'general');
  const lines = opts.facts.map((f) => f.trim()).filter(Boolean).slice(0, 8);
  if (!lines.length) return;
  try {
    const { getDatabase } = await import('./database');
    const db = await getDatabase();
    await ensureUserMemoryFactsTable(db);
    const now = Date.now();
    await runExclusiveDbWrite(async () => {
      for (const fact of lines) {
        const keyword = slug(fact.split(/\s+/).slice(0, 3).join(' ')) || 'fact';
        const id = `${subject}_${keyword}_${now}`;
        await db.runAsync(
          `INSERT OR REPLACE INTO user_memory_facts
            (id, subject, keyword, fact, source_turn_id, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          id,
          subject,
          keyword,
          fact.slice(0, 240),
          opts.sourceTurnId ?? null,
          now,
          now,
        );
      }
      const row = await db.getFirstAsync<{ c: number }>(
        'SELECT COUNT(*) as c FROM user_memory_facts',
      );
      const count = row?.c ?? 0;
      if (count > MAX_FACTS) {
        const excess = count - MAX_FACTS;
        await db.runAsync(
          `DELETE FROM user_memory_facts WHERE id IN (
            SELECT id FROM user_memory_facts ORDER BY updated_at_ms ASC LIMIT ?
          )`,
          excess,
        );
      }
    });
  } catch {
    /* soft */
  }
}

export async function searchUserMemoryFacts(opts: {
  subject?: string | null;
  query?: string | null;
  limit?: number;
}): Promise<UserMemoryFact[]> {
  const limit = Math.min(12, Math.max(1, opts.limit ?? 6));
  try {
    const { getDatabase } = await import('./database');
    const db = await getDatabase();
    await ensureUserMemoryFactsTable(db);
    const subject = opts.subject ? slug(opts.subject) : null;
    const q = (opts.query || '').trim().toLowerCase();
    if (subject && q) {
      const rows = await db.getAllAsync<{
        id: string;
        subject: string;
        keyword: string;
        fact: string;
        source_turn_id: string | null;
        created_at_ms: number;
        updated_at_ms: number;
      }>(
        `SELECT * FROM user_memory_facts
         WHERE subject = ? AND (keyword LIKE ? OR fact LIKE ?)
         ORDER BY updated_at_ms DESC LIMIT ?`,
        subject,
        `%${q}%`,
        `%${q}%`,
        limit,
      );
      return rows.map(rowToFact);
    }
    if (subject) {
      const rows = await db.getAllAsync<{
        id: string;
        subject: string;
        keyword: string;
        fact: string;
        source_turn_id: string | null;
        created_at_ms: number;
        updated_at_ms: number;
      }>(
        `SELECT * FROM user_memory_facts WHERE subject = ?
         ORDER BY updated_at_ms DESC LIMIT ?`,
        subject,
        limit,
      );
      return rows.map(rowToFact);
    }
    if (q) {
      const rows = await db.getAllAsync<{
        id: string;
        subject: string;
        keyword: string;
        fact: string;
        source_turn_id: string | null;
        created_at_ms: number;
        updated_at_ms: number;
      }>(
        `SELECT * FROM user_memory_facts
         WHERE keyword LIKE ? OR fact LIKE ?
         ORDER BY updated_at_ms DESC LIMIT ?`,
        `%${q}%`,
        `%${q}%`,
        limit,
      );
      return rows.map(rowToFact);
    }
    return [];
  } catch {
    return [];
  }
}

function rowToFact(row: {
  id: string;
  subject: string;
  keyword: string;
  fact: string;
  source_turn_id: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}): UserMemoryFact {
  return {
    id: row.id,
    subject: row.subject,
    keyword: row.keyword,
    fact: row.fact,
    sourceTurnId: row.source_turn_id,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

export function formatUserMemoryForPrompt(
  facts: UserMemoryFact[],
): string {
  if (!facts.length) return '';
  return `USER-LTM:\n${facts.map((f) => `- ${f.fact}`).join('\n')}`;
}
