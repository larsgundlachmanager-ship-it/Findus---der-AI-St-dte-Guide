/**
 * Cartesia sonic-3.5 — Yorro-Personas.
 * Alina + Sebastian = Original-UUIDs (native de-DE), unverändert.
 */
import type { VoiceId } from '../types/userProfile';

export const CARTESIA_MODEL_ID = 'sonic-3.5';
export const CARTESIA_TTS_URL = 'https://api.cartesia.ai/tts/bytes';
export const CARTESIA_API_VERSION = '2025-04-16';
/**
 * Cartesia Pro-Overage: 65 $ / 1M Credits ≈ 1 Credit/Zeichen.
 * USD≈EUR für Diagnostik (kein FX). In-Plan (erste 100k) wäre ~0,05 — wir
 * rechnen mit Overage, weil Produktion das Kontingent regelmäßig überschreitet.
 */
export const CARTESIA_EUR_PER_1K_CHARS = 0.065;

export type CartesiaVoiceDefinition = {
  id: VoiceId;
  /** Cartesia Voice UUID */
  cartesiaVoiceId: string;
  /** Anzeigename (Persona) */
  name: string;
  label: string;
  subtitle: string;
  emoji: string;
  /** Text für Live-Hörprobe / Preview-Generator */
  sample: string;
  /** Cartesia native locale (de-DE / de-CH) — Audit */
  nativeLocale: 'de-DE' | 'de-CH';
  /** Interner Cartesia-Library-Name (Debug) */
  libraryName: string;
};

/**
 * Exakte Sortierung — Index 0 = Alina, Index 1 = Sebastian.
 * Samples: kurzer Name + Yorro-Moment im Golden-Stil der Persona.
 */
export const CARTESIA_VOICES: readonly CartesiaVoiceDefinition[] = [
  {
    id: 'alina',
    cartesiaVoiceId: '38aabb6a-f52b-4fb0-a3d1-988518f4dc06',
    name: 'Alina',
    label: 'Alina',
    subtitle: 'Standard Weiblich — Klar & Warm',
    emoji: '🌸',
    nativeLocale: 'de-DE',
    libraryName: 'Alina - Engaging Assistant',
    sample:
      'Hallo, ich bin Alina. Schau dich kurz um — ich zeig dir, was hier wirklich zählt: klar, warm, ohne Umwege. Lass uns einfach losgehen.',
  },
  {
    id: 'sebastian',
    cartesiaVoiceId: 'b7187e84-fe22-4344-ba4a-bc013fcb533e',
    name: 'Sebastian',
    label: 'Sebastian',
    subtitle: 'Standard Männlich — Sympathisch',
    emoji: '🎙️',
    nativeLocale: 'de-DE',
    libraryName: 'Sebastian - Orator',
    sample:
      'Moin — Sebastian. Mit mir erlebst du jeden Ort entspannt und auf den Punkt. Ehrlich, verlässlich, ohne Theater. Los, wenn du soweit bist.',
  },
  {
    id: 'klaus',
    // war Archivist ohne natives Locale → Henrik (native de-DE)
    cartesiaVoiceId: 'd1cbea67-e4d3-47cd-be2a-2bd4e646b002',
    name: 'Klaus',
    label: 'Klaus',
    subtitle: 'Kompakt & Klar',
    emoji: '📋',
    nativeLocale: 'de-DE',
    libraryName: 'Henrik - Steady Analyst',
    sample:
      'Klaus hier. Kurz und gut: das lohnt sich. Ich sag dir, was du brauchst — den Rest lassen wir weg. Weiter.',
  },
  {
    id: 'leander',
    // war „Mit Akzent“ / ohne natives Locale → Nico (native de-DE)
    cartesiaVoiceId: 'afa425cf-5489-4a09-8a3f-d3cb1f82150d',
    name: 'Leander',
    label: 'Leander',
    subtitle: 'Warm & nahbar',
    emoji: '🌍',
    nativeLocale: 'de-DE',
    libraryName: 'Nico - Friendly Agent',
    sample:
      'Hallo, Leander. Hier liegt mehr, als die Fassade verrät — komm, wir nehmen den Weg mit Charakter. Hör genau hin.',
  },
  {
    id: 'lukas',
    cartesiaVoiceId: 'e00dd3df-19e7-4cd4-827a-7ff6687b6954',
    name: 'Lukas',
    label: 'Lukas',
    subtitle: 'Tiefer Erzähler',
    emoji: '📖',
    nativeLocale: 'de-DE',
    libraryName: 'Lukas - Professional',
    sample:
      'Lukas. Warte — siehst du das Detail da oben? Genau sowas macht den Ort besonders. Ich erklär dir warum, ohne zu langweilen.',
  },
  {
    id: 'varson',
    cartesiaVoiceId: '384b625b-da5d-49e8-a76d-a2855d4f31eb',
    name: 'Varson',
    label: 'Varson',
    subtitle: 'Junger Typ',
    emoji: '✌️',
    nativeLocale: 'de-DE',
    libraryName: 'Thomas - Anchor',
    sample:
      'Hey, Varson hier. Kein Museumsgelaber — ich zeig dir den Ort, wie einem Kumpel. Locker, ehrlich, ab geht’s.',
  },
  {
    id: 'alexander',
    // war ohne natives Locale → Andreas (native de-DE)
    cartesiaVoiceId: 'db229dfe-f5de-4be4-91fd-7b077c158578',
    name: 'Alexander',
    label: 'Alexander',
    subtitle: 'Cool & Markant',
    emoji: '🕶️',
    nativeLocale: 'de-DE',
    libraryName: 'Andreas - Recorder',
    sample:
      'Na, mein Kind — Alexander. Setz dich kurz. Ich kenn die alten Geschichten hier und erzähl sie dir gemütlich, Stück für Stück.',
  },
  {
    id: 'daniel',
    // war en-US Modern Assistant → Moritz (native de-DE)
    cartesiaVoiceId: '4ad22058-7cb6-402c-a115-196cbfc25dce',
    name: 'Daniel',
    label: 'Daniel',
    subtitle: 'Dynamisch',
    emoji: '⚡',
    nativeLocale: 'de-DE',
    libraryName: 'Moritz - Modern Communicator',
    sample:
      'Daniel! Bist du bereit? Wir nehmen den Ort mit Tempo und guter Energie — Augen auf, es wird spannend.',
  },
  {
    id: 'jaqcline',
    // war en-US Jacqueline → Klara (native de-DE, empathisch)
    cartesiaVoiceId: '2578354e-4b18-4d28-832c-5943344b7085',
    name: 'Jaqcline',
    label: 'Jaqcline',
    subtitle: 'Freundlich',
    emoji: '😊',
    nativeLocale: 'de-DE',
    libraryName: 'Klara - Empathetic Voice',
    sample:
      'Treten Sie näher. Ich bin Jaqcline. Gestatten Sie — wir wandeln hier mit Haltung. Ich führe Sie gepflegt und präzise.',
  },
  {
    id: 'lea',
    cartesiaVoiceId: '4ab1ff51-476d-42bb-8019-4d315f7c0c05',
    name: 'Lea',
    label: 'Lea',
    subtitle: 'Angenehm',
    emoji: '🌷',
    nativeLocale: 'de-DE',
    libraryName: 'Lena - Muse',
    sample:
      'Hallo, Lea. Schön, dass du da bist. Wir nehmen es ruhig — ich führ dich weich durch das, was hier wirklich schön ist.',
  },
  {
    id: 'rena',
    // war ohne natives Locale (starker EN-Akzent) → Lea Breezy (native de-DE, jung)
    cartesiaVoiceId: '1ade29fc-6b82-4607-9e70-361720139b12',
    name: 'Rena',
    label: 'Rena',
    subtitle: 'Kind — jung & neugierig',
    emoji: '🌟',
    nativeLocale: 'de-DE',
    libraryName: 'Lea - Breezy Voice',
    sample:
      'Hallo! Ich bin Rena. Oh, schau mal — ist das nicht riesig? Komm mit, ich will mit dir staunen und alles entdecken!',
  },
  {
    id: 'katie',
    // war en-US → Sabine (native de-DE)
    cartesiaVoiceId: '6d4b1416-8d54-4d94-a788-8a802c086544',
    name: 'Katie',
    label: 'Katie',
    subtitle: 'Lebhaft',
    emoji: '✨',
    nativeLocale: 'de-DE',
    libraryName: 'Sabine - Firm Newscaster',
    sample:
      'Hey, Katie! Hier wird’s lebendig — ich steck dich mit guter Laune an, und wir entdecken den Ort richtig fröhlich.',
  },
  {
    id: 'skylar',
    // war en-US → Vreni (native de-CH, immer noch Muttersprachen-Deutsch)
    cartesiaVoiceId: '40e0f496-a220-46bb-975a-7ef465b3d92b',
    name: 'Skylar',
    label: 'Skylar',
    subtitle: 'Modern',
    emoji: '💫',
    nativeLocale: 'de-CH',
    libraryName: 'Vreni - Diligent Advisor',
    sample:
      'Hey, Skylar. Klar und nah am Alltag: ich sag dir, was hier gerade lohnt — ohne Pathos. Los geht’s.',
  },
  {
    id: 'verini',
    cartesiaVoiceId: '3f4ade23-6eb4-4279-ab05-6a144947c4d5',
    name: 'Verini',
    label: 'Verini',
    subtitle: 'Warm & Charakter',
    emoji: '🗣️',
    nativeLocale: 'de-DE',
    libraryName: 'Karin - Companion',
    sample:
      'Hallo, Verini. Mit Wärme und Charakter führ ich dich durch — hör zu, hier steckt eine eigene Melodie drin.',
  },
  {
    id: 'viktoria',
    cartesiaVoiceId: 'b9de4a89-2257-424b-94c2-db18ba68c81a',
    name: 'Viktoria',
    label: 'Viktoria',
    subtitle: 'Reporterin / Ausdrucksstark',
    emoji: '📰',
    nativeLocale: 'de-DE',
    libraryName: 'Viktoria - Phone Conversationalist',
    sample:
      'Viktoria. Direkt und präsent: was du hier siehst, steckt voller Geschichte. Ich bring’s auf den Punkt — wie eine gute Reportage.',
  },
  {
    id: 'marlene',
    cartesiaVoiceId: '9b4d08b6-0494-4301-ab92-9150f4ee2718',
    name: 'Marlene',
    label: 'Marlene',
    subtitle: 'Historische Erzählerin',
    emoji: '🏛️',
    nativeLocale: 'de-DE',
    libraryName: 'Marlene - Elegant Speaker',
    sample:
      'Marlene. Lehn dich zurück. Hier beginnt eine Geschichte, die bleibt — elegant erzählt, mit dem Blick aufs Damals und Heute.',
  },
] as const;

const BY_ID = new Map(CARTESIA_VOICES.map((v) => [v.id, v]));

export function getCartesiaVoice(
  id?: VoiceId | null,
): CartesiaVoiceDefinition {
  if (id && BY_ID.has(id)) return BY_ID.get(id)!;
  return CARTESIA_VOICES[0];
}

export function cartesiaVoiceUuid(id?: VoiceId | null): string {
  return getCartesiaVoice(id).cartesiaVoiceId;
}

/** Default = Alina (Position 1). */
export const DEFAULT_CARTESIA_VOICE_ID: VoiceId = 'alina';

/** Dev/CI: alle Personas müssen native DE sein. */
export function assertAllVoicesNativeGerman(): void {
  for (const v of CARTESIA_VOICES) {
    if (v.nativeLocale !== 'de-DE' && v.nativeLocale !== 'de-CH') {
      throw new Error(
        `[cartesiaVoices] ${v.id} ist nicht native Deutsch (${v.nativeLocale})`,
      );
    }
  }
}
