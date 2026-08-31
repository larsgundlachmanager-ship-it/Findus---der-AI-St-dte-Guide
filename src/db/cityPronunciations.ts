import type { SQLiteDatabase } from 'expo-sqlite';
import { runExclusiveDbWrite } from './dbWriteLock';

export type CityPronunciationRow = {
  city_id: string;
  word: string;
  ipa: string;
};

export async function ensureCityPronunciationsTable(
  db: SQLiteDatabase,
): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS city_pronunciations (
      city_id TEXT NOT NULL,
      word TEXT NOT NULL,
      ipa TEXT NOT NULL,
      PRIMARY KEY (city_id, word)
    );
    CREATE INDEX IF NOT EXISTS idx_city_pronunciations_city
      ON city_pronunciations(city_id);
  `);
}

/** Ersetzt alle Aussprache-Einträge einer Stadt (voller Replace). */
export async function replaceCityPronunciations(
  db: SQLiteDatabase,
  cityId: string,
  entries: Array<{ word: string; ipa: string }>,
): Promise<void> {
  const id = cityId.trim().toLowerCase();
  if (!id) return;

  await runExclusiveDbWrite(async () => {
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'DELETE FROM city_pronunciations WHERE city_id = ?',
        id,
      );
      for (const e of entries) {
        const word = e.word.trim().toLowerCase();
        const ipa = e.ipa.trim();
        if (!word || !ipa) continue;
        await db.runAsync(
          `INSERT OR REPLACE INTO city_pronunciations (city_id, word, ipa)
           VALUES (?, ?, ?)`,
          id,
          word,
          ipa,
        );
      }
    });
  });
}

/** Lädt city_id → word→ipa Map für die aktive Stadt. */
export async function loadCityPronunciationMap(
  db: SQLiteDatabase,
  cityId: string,
): Promise<Record<string, string>> {
  const id = cityId.trim().toLowerCase();
  if (!id) return {};

  const rows = await db.getAllAsync<CityPronunciationRow>(
    'SELECT city_id, word, ipa FROM city_pronunciations WHERE city_id = ?',
    id,
  );
  const map: Record<string, string> = {};
  for (const row of rows) {
    const w = row.word.trim().toLowerCase();
    if (w && row.ipa) map[w] = row.ipa;
  }
  return map;
}

export async function deleteCityPronunciations(
  db: SQLiteDatabase,
  cityId: string,
): Promise<void> {
  const id = cityId.trim().toLowerCase();
  if (!id) return;
  await runExclusiveDbWrite(async () => {
    await db.runAsync('DELETE FROM city_pronunciations WHERE city_id = ?', id);
  });
}
