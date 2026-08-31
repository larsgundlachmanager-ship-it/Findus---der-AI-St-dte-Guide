/**
 * Erste Landung auf der Karte nach Setup — personalisiertes Eisbrechen + UI-Tutorial.
 * Master-Prompt → Gemini → Cartesia (User-Stimme).
 */

import * as FileSystem from 'expo-file-system';
import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { getCachedUserProfile, saveUserProfile } from '../userProfileService';
import {
  speakAssistantText,
  getVoiceSettingsForTour,
} from '../ttsService';
import { useFinnusStore } from '../../store/useFinnusStore';
import type { UserProfile } from '../../types/userProfile';
import { EXPERIENCE_CARDS } from '../../constants/onboardingOptions';
import type { ExplanationHint } from '../../i18n';

const FLAG_PATH = `${FileSystem.documentDirectory}findus-first-map-welcome.json`;

type FlagState = { done: boolean };

let speaking = false;
let doneCache: boolean | null = null;

async function loadDone(): Promise<boolean> {
  if (doneCache != null) return doneCache;
  try {
    const info = await FileSystem.getInfoAsync(FLAG_PATH);
    if (info.exists) {
      const raw = JSON.parse(
        await FileSystem.readAsStringAsync(FLAG_PATH),
      ) as FlagState;
      doneCache = !!raw.done;
      return doneCache;
    }
  } catch {
    /* ignore */
  }
  doneCache = false;
  return false;
}

async function markDone(): Promise<void> {
  doneCache = true;
  try {
    await FileSystem.writeAsStringAsync(
      FLAG_PATH,
      JSON.stringify({ done: true, at: new Date().toISOString() }),
    );
  } catch {
    /* ignore */
  }
}

export async function markFirstMapWelcomeDone(
  profile?: UserProfile | null,
): Promise<void> {
  await markDone();
  const p = profile ?? getCachedUserProfile();
  if (p && !p.firstMapWelcomeDone) {
    await saveUserProfile({ ...p, firstMapWelcomeDone: true });
  }
}

function interestSummary(profile: UserProfile): string {
  const parts: string[] = [];
  if (profile.aboutMe?.trim()) parts.push(profile.aboutMe.trim().slice(0, 160));
  if (profile.wantToExperience?.trim()) {
    parts.push(`Will erleben: ${profile.wantToExperience.trim().slice(0, 120)}`);
  }
  const yes = EXPERIENCE_CARDS.filter(
    (c) => profile.experiencePrefs?.[c.id] === 'yes',
  )
    .slice(0, 6)
    .map((c) => c.labelDe);
  if (yes.length) parts.push(`Interessen: ${yes.join(', ')}`);
  if (profile.characters?.[0]) parts.push(`Charakter: ${profile.characters[0]}`);
  return parts.join(' · ') || 'offen, neugierig, unterwegs';
}

function buildMasterPrompt(opts: {
  userName: string;
  interests: string;
  city: string;
  liveContext: string;
}): string {
  return [
    'Du bist Yorro, der persönliche, charmante und hochintelligente Audio-Guide des Users.',
    'Deine Aufgabe: den User zum ersten Mal in der App begrüßen, eine persönliche Verbindung aufbauen und anschließend kurz und knackig die Benutzeroberfläche erklären.',
    'Sprich natürlich, enthusiastisch und wie ein guter Freund. Deutsch, Du-Form, kein Markdown.',
    '',
    'Kontext-Daten:',
    `User-Name: ${opts.userName}`,
    `Interessen: ${opts.interests}`,
    `Aktueller Ort: ${opts.city}`,
    `Live-Daten: ${opts.liveContext}`,
    '',
    'Struktur deiner Antwort (zwingend einhalten!):',
    '',
    'PHASE 1: Das personalisierte Eisbrechen (dynamisch)',
    '- Begrüße den User mit seinem Namen.',
    '- Gehe charmant auf seine Interessen ein und verknüpfe sie sofort mit dem aktuellen Ort.',
    '',
    'PHASE 2: Das UI-Tutorial (strukturiert, aber locker)',
    'Leite elegant über ("Bevor wir loslegen, zeige ich dir kurz, wie das hier funktioniert...").',
    'Erkläre die UI-Elemente GENAU in dieser Reihenfolge und nutze die Emojis als visuelle Anker:',
    '👆 Unten links — Action-Button: tippen oder lange drücken (Spracheingabe). Konkrete Beispiele: Wetter, Stufen eines Turms, Tischreservierung.',
    '📍 Oben links — Live-Anzeige: Ort / Tipps tippen. Stempelkarte: Icon oben rechts unter dem Zahnrad (Erkundungsstand, ohne Karte).',
    '🗺️ Swipe-Geste — Routen-Modus: während Navigation wischen; Multi-Stops planen, Drag & Drop, löschen.',
    '⚙️ Oben rechts — Einstellungen: Zahnrad für Datenschutz und Stimme ändern.',
    '',
    'PHASE 3: Abschluss',
    'Motivierend beenden: du bist ab jetzt im Hintergrund da, User kann einfach loslaufen.',
    '',
    'Länge: ca. 180–280 Wörter. Keine Aufzählungszeichen außer den vorgegebenen Emojis.',
  ].join('\n');
}

export type FirstMapSegment = {
  hint: ExplanationHint;
  text: string;
};

/** Zerlegt Gemini-Text grob nach UI-Emoji-Ankern für Finger-Hints. */
export function segmentFirstMapWelcome(full: string): FirstMapSegment[] {
  const parts = full
    .split(/(?=👆|📍|🗺️|⚙️)/u)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    return [{ hint: 'none', text: full.trim() }];
  }
  return parts.map((text) => {
    if (text.startsWith('👆')) return { hint: 'mic' as const, text };
    if (text.startsWith('📍')) return { hint: 'location' as const, text };
    if (text.startsWith('🗺️')) return { hint: 'swipe' as const, text };
    if (text.startsWith('⚙️')) return { hint: 'settings' as const, text };
    return { hint: 'none' as const, text };
  });
}

export async function composeFirstMapWelcomeSpeech(
  profile: UserProfile,
  liveContext = 'keine besonderen Live-Daten',
): Promise<string> {
  const userName = profile.firstName?.trim() || 'du';
  const city = profile.cityName?.trim() || profile.cityId || 'deiner Stadt';
  const interests = interestSummary(profile);

  if (hasGeminiApiKey()) {
    try {
      const live = await generateGeminiText(
        buildMasterPrompt({
          userName,
          interests,
          city,
          liveContext,
        }),
        { task: 'generic', maxTokens: 700, temperature: 0.9 },
      );
      const cleaned = live.replace(/\s+/g, ' ').trim();
      if (cleaned.length > 80) return cleaned;
    } catch (err) {
      console.warn('[firstMapWelcome] gemini failed:', err);
    }
  }

  // Parameter-Fallback ohne Stadt-Canned-Facts
  return (
    `Moin ${userName}! Schön, dass du da bist. ${interests ? `Ich merk mir schon: ${interests}. ` : ''}` +
    `Hier in ${city} begleite ich dich ab jetzt. ` +
    `Bevor wir loslegen, kurz die Bedienung: ` +
    `👆 Unten links ist der Action-Button — tippen zum Schreiben, lange drücken zum Sprechen. Frag mich nach dem Wetter, Details vor Ort oder einer Reservierung. ` +
    `📍 Oben links siehst du Ort und Tipps — tippen lädt Tipps. Stempelkarte: Icon unter dem Zahnrad (Erkundungsstand). ` +
    `🗺️ Beim Navigieren wisch zur Seite für den Routen-Modus mit mehreren Stops. ` +
    `⚙️ Oben rechts Kalender und Zahnrad; darunter die Stempelkarte. ` +
    `So, ich bin da — lauf einfach los und melde dich, wenn was ist!`
  );
}

/**
 * Einmalig nach Setup: Welcome sprechen. Gibt false wenn schon erledigt / busy.
 */
export async function maybeSpeakFirstMapWelcome(
  profile: UserProfile,
): Promise<boolean> {
  if (speaking) return false;
  if (profile.firstMapWelcomeDone) {
    doneCache = true;
    return false;
  }
  if (await loadDone()) return false;
  if (!profile.setupComplete) return false;
  if (useFinnusStore.getState().isSimulationMode) return false;

  speaking = true;
  try {
    let liveContext = 'keine besonderen Live-Daten';
    try {
      const { getCachedWeatherSnapshot } = await import('../weatherService');
      const w = getCachedWeatherSnapshot();
      if (w?.summaryLine) {
        liveContext = w.summaryLine.slice(0, 200);
      } else if (w) {
        liveContext = `Wettercode ${w.weatherCode ?? '?'}, Niederschlag ≈${w.precipitationMm ?? 0} mm`;
      }
    } catch {
      /* optional */
    }

    const speech = await composeFirstMapWelcomeSpeech(profile, liveContext);
    useFinnusStore.getState().addChatMessage({
      role: 'assistant',
      content: speech,
    });

    const voice = await getVoiceSettingsForTour();
    await speakAssistantText(speech, {
      voiceId: profile.voiceId || voice.voiceId,
      speechRate: voice.speechRate,
    });

    await markFirstMapWelcomeDone(profile);
    return true;
  } catch (err) {
    console.warn('[firstMapWelcome] failed:', err);
    return false;
  } finally {
    speaking = false;
  }
}

export async function isFirstMapWelcomePending(
  profile: UserProfile | null,
): Promise<boolean> {
  if (!profile?.setupComplete) return false;
  if (profile.firstMapWelcomeDone) return false;
  return !(await loadDone());
}
