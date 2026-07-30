import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  FeedbackRecord,
  FeedbackTelemetrySnapshot,
  LocalFeedbackEntry,
} from '../types/feedback';

export async function ensureFeedbackEntriesTable(
  db: SQLiteDatabase,
): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS feedback_entries (
      feedback_id TEXT PRIMARY KEY NOT NULL,
      timestamp TEXT NOT NULL,
      user_name TEXT NOT NULL,
      issue_description TEXT NOT NULL,
      desired_behavior TEXT NOT NULL,
      telemetry_json TEXT NOT NULL,
      uploaded INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS feedback_entries_uploaded_idx
      ON feedback_entries (uploaded);
  `);
}

function rowToEntry(row: {
  feedback_id: string;
  timestamp: string;
  user_name: string;
  issue_description: string;
  desired_behavior: string;
  telemetry_json: string;
  uploaded: number;
}): LocalFeedbackEntry {
  return {
    feedbackId: row.feedback_id,
    timestamp: row.timestamp,
    userName: row.user_name,
    issueDescription: row.issue_description,
    desiredBehavior: row.desired_behavior,
    telemetryJson: row.telemetry_json,
    uploaded: row.uploaded === 1 ? 1 : 0,
  };
}

export function newFeedbackId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function insertFeedbackEntry(
  db: SQLiteDatabase,
  input: {
    userName: string;
    issueDescription: string;
    desiredBehavior: string;
    telemetry: FeedbackTelemetrySnapshot;
  },
): Promise<LocalFeedbackEntry> {
  await ensureFeedbackEntriesTable(db);
  const entry: LocalFeedbackEntry = {
    feedbackId: newFeedbackId(),
    timestamp: new Date().toISOString(),
    userName: input.userName.trim() || 'Tester / User',
    issueDescription: input.issueDescription.trim(),
    desiredBehavior: input.desiredBehavior.trim(),
    telemetryJson: JSON.stringify(input.telemetry),
    uploaded: 0,
  };
  await db.runAsync(
    `INSERT INTO feedback_entries
      (feedback_id, timestamp, user_name, issue_description, desired_behavior, telemetry_json, uploaded)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    entry.feedbackId,
    entry.timestamp,
    entry.userName,
    entry.issueDescription,
    entry.desiredBehavior,
    entry.telemetryJson,
  );
  return entry;
}

export async function listUnsentFeedbackEntries(
  db: SQLiteDatabase,
): Promise<LocalFeedbackEntry[]> {
  await ensureFeedbackEntriesTable(db);
  const rows = await db.getAllAsync<{
    feedback_id: string;
    timestamp: string;
    user_name: string;
    issue_description: string;
    desired_behavior: string;
    telemetry_json: string;
    uploaded: number;
  }>(
    `SELECT feedback_id, timestamp, user_name, issue_description, desired_behavior, telemetry_json, uploaded
     FROM feedback_entries
     WHERE uploaded = 0
     ORDER BY timestamp ASC`,
  );
  return rows.map(rowToEntry);
}

export async function countUnsentFeedbackEntries(
  db: SQLiteDatabase,
): Promise<number> {
  await ensureFeedbackEntriesTable(db);
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM feedback_entries WHERE uploaded = 0',
  );
  return row?.count ?? 0;
}

export async function purgeFeedbackEntries(
  db: SQLiteDatabase,
  feedbackIds: string[],
): Promise<void> {
  if (feedbackIds.length === 0) return;
  await ensureFeedbackEntriesTable(db);
  const placeholders = feedbackIds.map(() => '?').join(', ');
  await db.runAsync(
    `DELETE FROM feedback_entries WHERE feedback_id IN (${placeholders})`,
    ...feedbackIds,
  );
}

export function localEntryToRecord(entry: LocalFeedbackEntry): FeedbackRecord {
  let telemetry: FeedbackTelemetrySnapshot = {
    llm_prompts: [],
    llm_responses: [],
    ui_states: [],
    last_actions: [],
    user_speech_exact: [],
    findus_speech_exact: [],
    findus_actions_triggered: [],
    nav_execution_tracking: null,
    judge_passes: [],
  };
  try {
    const parsed = JSON.parse(entry.telemetryJson) as FeedbackTelemetrySnapshot;
    if (parsed && typeof parsed === 'object') {
      telemetry = {
        llm_prompts: Array.isArray(parsed.llm_prompts) ? parsed.llm_prompts : [],
        llm_responses: Array.isArray(parsed.llm_responses)
          ? parsed.llm_responses
          : [],
        ui_states: Array.isArray(parsed.ui_states) ? parsed.ui_states : [],
        last_actions: Array.isArray(parsed.last_actions)
          ? parsed.last_actions
          : [],

        user_speech_exact: Array.isArray((parsed as any).user_speech_exact)
          ? (parsed as any).user_speech_exact
          : [],
        findus_speech_exact: Array.isArray((parsed as any).findus_speech_exact)
          ? (parsed as any).findus_speech_exact
          : [],
        findus_actions_triggered: Array.isArray((parsed as any).findus_actions_triggered)
          ? (parsed as any).findus_actions_triggered
          : [],
        nav_execution_tracking:
          (parsed as any).nav_execution_tracking && typeof (parsed as any).nav_execution_tracking === 'object'
            ? (parsed as any).nav_execution_tracking
            : null,
        judge_passes: Array.isArray((parsed as any).judge_passes)
          ? (parsed as any).judge_passes
          : [],
      };
    }
  } catch {
    /* keep empty snapshot */
  }
  return {
    feedback_id: entry.feedbackId,
    timestamp: entry.timestamp,
    user_name: entry.userName,
    issue_description: entry.issueDescription,
    desired_behavior: entry.desiredBehavior,
    telemetry_10min: telemetry,
  };
}
