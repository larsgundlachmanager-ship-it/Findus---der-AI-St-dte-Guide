import type { SQLiteDatabase } from 'expo-sqlite';

export type UserCustomPhoneticRow = {
  word: string;
  phonetic: string;
  source_city_id: string | null;
  learned_at: string;
};

export async function ensureUserCustomPhoneticsTable(
  db: SQLiteDatabase,
): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS user_custom_phonetics (
      word TEXT PRIMARY KEY NOT NULL,
      phonetic TEXT NOT NULL,
      source_city_id TEXT,
      learned_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_custom_phonetics_city
      ON user_custom_phonetics(source_city_id);
  `);
}

export async function upsertUserCustomPhonetics(
  db: SQLiteDatabase,
  entries: Array<{
    word: string;
    phonetic: string;
    sourceCityId?: string | null;
  }>,
): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    for (const e of entries) {
      const word = e.word.normalize('NFKC').toLowerCase().trim();
      const phonetic = e.phonetic.trim();
      if (!word || !phonetic || word.length < 2) continue;

      const existing = await db.getFirstAsync<{ word: string }>(
        'SELECT word FROM user_custom_phonetics WHERE word = ?',
        word,
      );

      await db.runAsync(
        `INSERT OR REPLACE INTO user_custom_phonetics
         (word, phonetic, source_city_id, learned_at)
         VALUES (?, ?, ?, ?)`,
        word,
        phonetic,
        e.sourceCityId?.trim().toLowerCase() ?? null,
        now,
      );

      if (existing) updated += 1;
      else added += 1;
    }
  });

  return { added, updated };
}

export async function loadAllUserCustomPhonetics(
  db: SQLiteDatabase,
): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<UserCustomPhoneticRow>(
    'SELECT word, phonetic FROM user_custom_phonetics',
  );
  const out: Record<string, string> = {};
  for (const row of rows) {
    const w = row.word.trim().toLowerCase();
    const p = row.phonetic.trim();
    if (w && p) out[w] = p;
  }
  return out;
}

export async function getUserCustomPhoneticsCount(
  db: SQLiteDatabase,
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM user_custom_phonetics',
  );
  return row?.count ?? 0;
}
