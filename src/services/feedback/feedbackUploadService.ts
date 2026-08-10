/**
 * Append-only upload of local feedback to Supabase Storage master_feedback.json.
 * Uses direct REST (RN-safe) — supabase-js storage SDK can return misleading
 * "Bucket not Found" on Android even when the bucket exists.
 * Purges local cache only after confirmed HTTP 200 success.
 */

import { env } from '../../config/env';
import { getDatabase } from '../../db/database';
import {
  listUnsentFeedbackEntries,
  localEntryToRecord,
  purgeFeedbackEntries,
} from '../../db/feedbackEntries';
import type { FeedbackRecord } from '../../types/feedback';
import { readResponseAsText } from '../../utils/readBodyAsText';
import { clearTelemetryBuffer } from './telemetryBuffer';

const FEEDBACK_BUCKET = 'feedback';
const MASTER_FEEDBACK_PATH = 'master_feedback.json';

type SupabaseRestConfig = {
  baseUrl: string;
  anonKey: string;
};

function resolveSupabaseRestConfig(): SupabaseRestConfig | null {
  const baseUrl = env.supabaseUrl()?.replace(/\/$/, '') ?? '';
  const anonKey = env.supabaseAnonKey() ?? '';
  if (
    !baseUrl ||
    !anonKey ||
    baseUrl.includes('your-project') ||
    anonKey.includes('your-anon')
  ) {
    return null;
  }
  return { baseUrl, anonKey };
}

function storageObjectUrl(cfg: SupabaseRestConfig, authenticated: boolean): string {
  const encoded = encodeURIComponent(MASTER_FEEDBACK_PATH);
  if (authenticated) {
    return `${cfg.baseUrl}/storage/v1/object/${FEEDBACK_BUCKET}/${encoded}`;
  }
  return `${cfg.baseUrl}/storage/v1/object/public/${FEEDBACK_BUCKET}/${encoded}`;
}

function isMissingObject(status: number, body: string): boolean {
  if (status === 404) return true;
  const m = body.toLowerCase();
  return (
    m.includes('object not found') ||
    (m.includes('not found') && !m.includes('bucket'))
  );
}

function isMissingBucket(status: number, body: string): boolean {
  const m = body.toLowerCase();
  return status === 404 && m.includes('bucket');
}

function isPermissionDenied(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  const m = body.toLowerCase();
  return m.includes('permission') || m.includes('unauthorized') || m.includes('forbidden');
}

function formatStorageError(
  phase: 'Download' | 'Upload',
  status: number,
  body: string,
): string {
  if (isMissingBucket(status, body)) {
    return `${phase} fehlgeschlagen: Storage-Bucket „${FEEDBACK_BUCKET}“ existiert nicht im Supabase-Projekt. Bitte Bucket anlegen.`;
  }
  if (isPermissionDenied(status, body)) {
    return `${phase} fehlgeschlagen: Keine Berechtigung für Bucket „${FEEDBACK_BUCKET}“. RLS-Policy für anon prüfen.`;
  }
  const detail = body.trim().slice(0, 180);
  return detail
    ? `${phase} fehlgeschlagen (HTTP ${status}): ${detail}`
    : `${phase} fehlgeschlagen (HTTP ${status}).`;
}

function parseFeedbackRecords(text: string): FeedbackRecord[] {
  if (!text.trim()) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is FeedbackRecord =>
        row != null &&
        typeof row === 'object' &&
        typeof (row as FeedbackRecord).feedback_id === 'string',
    );
  } catch {
    return [];
  }
}

async function downloadMasterFeedback(cfg: SupabaseRestConfig): Promise<FeedbackRecord[]> {
  const publicUrl = storageObjectUrl(cfg, false);
  try {
    const res = await fetch(publicUrl);
    if (res.ok) {
      return parseFeedbackRecords(await readResponseAsText(res));
    }
    const body = await readResponseAsText(res).catch(() => '');
    if (isMissingObject(res.status, body)) return [];
    if (res.status === 404) {
      // Public route unavailable — try authenticated object URL
    } else if (!isMissingBucket(res.status, body)) {
      throw new Error(formatStorageError('Download', res.status, body));
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Download fehlgeschlagen')) {
      throw err;
    }
    /* fall through to authenticated download */
  }

  const authUrl = storageObjectUrl(cfg, true);
  const res = await fetch(authUrl, {
    headers: {
      Authorization: `Bearer ${cfg.anonKey}`,
      apikey: cfg.anonKey,
    },
  });

  if (res.ok) {
    return parseFeedbackRecords(await readResponseAsText(res));
  }

  const body = await readResponseAsText(res).catch(() => '');
  if (isMissingObject(res.status, body)) return [];
  throw new Error(formatStorageError('Download', res.status, body));
}

async function uploadViaRest(
  cfg: SupabaseRestConfig,
  body: string,
): Promise<void> {
  const endpoint = storageObjectUrl(cfg, true);
  const headers = {
    Authorization: `Bearer ${cfg.anonKey}`,
    apikey: cfg.anonKey,
    'Content-Type': 'application/json',
    'x-upsert': 'true',
  };

  let res = await fetch(endpoint, { method: 'POST', headers, body });
  if (res.status === 200) return;

  const firstBody = await readResponseAsText(res).catch(() => '');

  res = await fetch(endpoint, { method: 'PUT', headers, body });
  if (res.status === 200) return;

  const secondBody = await readResponseAsText(res).catch(() => '');
  const detail = secondBody || firstBody;
  throw new Error(formatStorageError('Upload', res.status, detail));
}

export type FeedbackUploadResult = {
  uploadedCount: number;
  totalInCloud: number;
};

/**
 * Fetches unsent local entries, appends to master_feedback.json, purges on success.
 */
export async function uploadPendingFeedback(): Promise<FeedbackUploadResult> {
  const cfg = resolveSupabaseRestConfig();
  if (!cfg) {
    throw new Error(
      'Supabase ist nicht konfiguriert — Upload nicht möglich.',
    );
  }

  const db = await getDatabase();
  const pending = await listUnsentFeedbackEntries(db);
  if (pending.length === 0) {
    throw new Error('Kein ausstehendes Feedback zum Upload.');
  }

  const newRecords = pending.map(localEntryToRecord);
  const existing = await downloadMasterFeedback(cfg);
  const merged = [...existing, ...newRecords];

  await uploadViaRest(cfg, JSON.stringify(merged, null, 2));

  const ids = pending.map((e) => e.feedbackId);
  await purgeFeedbackEntries(db, ids);
  clearTelemetryBuffer();

  return {
    uploadedCount: newRecords.length,
    totalInCloud: merged.length,
  };
}

export async function getPendingFeedbackCount(): Promise<number> {
  const db = await getDatabase();
  const pending = await listUnsentFeedbackEntries(db);
  return pending.length;
}
