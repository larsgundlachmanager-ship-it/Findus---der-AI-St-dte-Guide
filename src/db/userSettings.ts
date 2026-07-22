import type { SQLiteDatabase } from 'expo-sqlite';
import { normalizeVoiceId, type VoiceId } from '../types/userProfile';

export type UserVoiceSettings = {
  voiceId: VoiceId;
  /** Profil-Name / Rolle (gleiche Id wie voiceId) */
  voiceProfile: string;
  speechRate: number;
  updatedAt: string;
};

export async function ensureUserSettingsTable(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      voice_id TEXT NOT NULL,
      voice_profile TEXT NOT NULL,
      speech_rate REAL NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export async function saveUserVoiceSettings(
  db: SQLiteDatabase,
  settings: {
    voiceId: VoiceId;
    speechRate: number;
    voiceProfile?: string;
  },
): Promise<UserVoiceSettings> {
  await ensureUserSettingsTable(db);
  const voiceId = normalizeVoiceId(settings.voiceId);
  const row: UserVoiceSettings = {
    voiceId,
    voiceProfile: settings.voiceProfile ?? voiceId,
    speechRate: settings.speechRate,
    updatedAt: new Date().toISOString(),
  };
  await db.runAsync(
    `INSERT INTO user_settings (id, voice_id, voice_profile, speech_rate, updated_at)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       voice_id = excluded.voice_id,
       voice_profile = excluded.voice_profile,
       speech_rate = excluded.speech_rate,
       updated_at = excluded.updated_at`,
    row.voiceId,
    row.voiceProfile,
    row.speechRate,
    row.updatedAt,
  );
  return row;
}

export async function loadUserVoiceSettings(
  db: SQLiteDatabase,
): Promise<UserVoiceSettings | null> {
  await ensureUserSettingsTable(db);
  const row = await db.getFirstAsync<{
    voice_id: string;
    voice_profile: string;
    speech_rate: number;
    updated_at: string;
  }>('SELECT voice_id, voice_profile, speech_rate, updated_at FROM user_settings WHERE id = 1');

  if (!row) return null;
  const voiceId = normalizeVoiceId(row.voice_id);
  return {
    voiceId,
    voiceProfile: row.voice_profile || voiceId,
    speechRate: row.speech_rate,
    updatedAt: row.updated_at,
  };
}
