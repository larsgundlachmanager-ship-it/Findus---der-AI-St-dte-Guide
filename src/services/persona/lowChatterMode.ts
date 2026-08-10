/**
 * Low-Chatter-Mode (V7.0):
 * Explicit "Du redest zu viel" (etc.) → essential nav-only until next local morning.
 * Never auto-trigger on short answers.
 */

import * as FileSystem from 'expo-file-system';

const PATH = `${FileSystem.documentDirectory}findus-low-chatter.json`;

type LowChatterState = {
  active: boolean;
  /** Local calendar day (YYYY-MM-DD) when mode was enabled. Resets next morning. */
  enabledOnLocalDay: string | null;
};

let cache: LowChatterState | null = null;
let loaded = false;

function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Explicit complaints only — never short-answer heuristics. */
const ACTIVATE_RE =
  /\b(du\s+redest\s+zu\s+viel|zu\s+viel\s+(geredet|labern|laberst)|hör\s+auf\s+zu\s+(reden|labern)|weniger\s+(reden|labern|quatschen)|sei\s+mal\s+leise|laber\s+nicht\s+so|halt\s+die\s+klappe|shut\s+up|too\s+much\s+talking|quiet\s+mode)\b/iu;

const DEACTIVATE_RE =
  /\b(wieder\s+normal|mehr\s+erzählen|du\s+darfst\s+wieder|chatter\s+(an|on)|erzähl\s+wieder|laber\s+wieder)\b/iu;

async function persist(): Promise<void> {
  if (!cache) return;
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

export async function loadLowChatterState(): Promise<LowChatterState> {
  if (loaded && cache) {
    maybeResetAtMorning();
    return cache;
  }
  loaded = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(PATH);
      const parsed = JSON.parse(raw) as Partial<LowChatterState>;
      cache = {
        active: parsed.active === true,
        enabledOnLocalDay:
          typeof parsed.enabledOnLocalDay === 'string'
            ? parsed.enabledOnLocalDay
            : null,
      };
      maybeResetAtMorning();
      return cache;
    }
  } catch {
    /* fresh */
  }
  cache = { active: false, enabledOnLocalDay: null };
  return cache;
}

/** If enabled yesterday (or earlier), clear at next local calendar day. */
function maybeResetAtMorning(): void {
  if (!cache?.active || !cache.enabledOnLocalDay) return;
  const today = localDayKey();
  if (cache.enabledOnLocalDay < today) {
    cache = { active: false, enabledOnLocalDay: null };
    void persist();
    if (__DEV__) console.log('[low-chatter] auto-reset next morning');
  }
}

export function isLowChatterActive(): boolean {
  if (!cache) return false;
  maybeResetAtMorning();
  return cache.active === true;
}

export async function enableLowChatterMode(): Promise<void> {
  await loadLowChatterState();
  cache = { active: true, enabledOnLocalDay: localDayKey() };
  await persist();
  if (__DEV__) console.log('[low-chatter] ON until next morning');
}

export async function disableLowChatterMode(): Promise<void> {
  await loadLowChatterState();
  cache = { active: false, enabledOnLocalDay: null };
  await persist();
}

/** Cloud-Restore — remote active wins if still same local day. */
export async function applyLowChatterStateFromCloud(
  remote: Partial<LowChatterState> | null | undefined,
): Promise<void> {
  if (!remote || typeof remote !== 'object') return;
  await loadLowChatterState();
  const today = localDayKey();
  const remoteActive =
    remote.active === true &&
    typeof remote.enabledOnLocalDay === 'string' &&
    remote.enabledOnLocalDay === today;
  if (!remoteActive) return;
  if (cache?.active && cache.enabledOnLocalDay === today) return;
  cache = {
    active: true,
    enabledOnLocalDay: remote.enabledOnLocalDay ?? today,
  };
  loaded = true;
  await persist();
}

export async function snapshotLowChatterState(): Promise<LowChatterState> {
  return loadLowChatterState();
}

/**
 * Inspect user utterance. Returns true if mode was just toggled
 * (caller may acknowledge briefly and skip full answer).
 */
export async function observeLowChatterUtterance(
  text: string,
): Promise<'activated' | 'deactivated' | null> {
  const t = (text ?? '').trim();
  if (!t) return null;
  await loadLowChatterState();

  if (DEACTIVATE_RE.test(t) && isLowChatterActive()) {
    await disableLowChatterMode();
    return 'deactivated';
  }
  if (ACTIVATE_RE.test(t)) {
    await enableLowChatterMode();
    return 'activated';
  }
  return null;
}

/** Prompt block when Low-Chatter is active. */
export function lowChatterPromptBlock(): string {
  if (!isLowChatterActive()) return '';
  return `=== LOW-CHATTER-MODE (AKTIV BIS MORGEN) ===
- Der Nutzer hat explizit gesagt, du redest zu viel.
- NUR essenzielle Navi-/Sicherheits-Hinweise. Keine Stories, keine Smalltalk-Hooks, keine Feature-Tips.
- Max. 1–2 kurze Sätze. Keine Empathie-Nachfragen außer bei echten Notfällen.
- Kein Entschuldigen in jeder Antwort — einmal reicht.`;
}

export function lowChatterAck(kind: 'activated' | 'deactivated'): string {
  if (kind === 'activated') {
    return 'Alles klar — ich halte mich kurz, nur Navi wenn nötig. Bis morgen früh wieder normal.';
  }
  return 'Cool — ich erzähl wieder normal mit.';
}
