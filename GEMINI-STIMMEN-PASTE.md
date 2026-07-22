# Kontext für Gemini — Findus Stimmen-System (React Native / Expo / Kokoro TTS)

Bitte lies den folgenden Projektkontext. Am Ende stelle ich meine Frage.

---

## Was ist das?

Findus ist ein Offline-First Audio-Tourguide (React Native + Expo).
TTS läuft lokal mit **Kokoro Martin-ONNX** (deutsch), nicht Cloud-TTS.

**Studio-Design (v4 / `de-kokoro-studio-v4`):**
- 8 UI-Rollen (`VoiceId`) mappen auf nur **3** native deutsche Style-Packs
- Charakter kommt **nur** über LLM-Textstil (Wortwahl, Interpunktion)
- **Kein** Pitch-/Speed-Manipulieren der Stimme
- Sprechtempo systemweit fest: `FIXED_SPEECH_RATE = 1.0`
- Modell immer: Martin-ONNX + `langCode = 'd'`

### Mapping

| VoiceId | Pack |
|---|---|
| standard_m | de_thorsten |
| standard_w | de_eva |
| prinzessin | de_eva |
| erzaehler | de_thorsten |
| dorfaeltester | de_karl |
| historiker | de_karl |
| gen_z | de_thorsten |
| energisch | de_eva |

Pack-Dateien: `de_thorsten.bin`, `de_eva.bin`, `de_karl.bin` (Style-Vektoren 510×256 float32).

### Architektur

```
UI VoiceId
  → voices.ts / kokoroVoicePacks.ts
  → AudioVoiceService (ONNX + Style im RAM)
  → Hörproben: Metro-WAVs (src/assets/audio/samples/)
  → Live: G2P (espeak) → Tokens → ONNX → WAV → AudioPlayQueue
  → Persona: LLM System-Prompt färbt Textstil
```

### Build-Workflow

```bash
npm run prepare:voices       # HF Download + GGUF/NPZ → .bin nach native-assets/kokoro/voices/
npm run preRender:audio      # Offline-Render intro.wav + 8 Sample-WAVs (braucht espeak-ng)
node scripts/validate-studio-voices.cjs
npm run prebuild             # fetch:kokoro + fetch:espeak + generate:voice-assets + expo prebuild
```

### Wichtige Dateien

- `src/constants/voices.ts` — 8 Rollen + Sample-Texte
- `src/constants/kokoroVoicePacks.ts` — Packs + URLs + Mapping
- `src/constants/voiceSampleAssets.ts` — require() der WAVs
- `src/services/AudioVoiceService.ts` — Runtime (~1960 Zeilen)
- `src/services/ttsService.ts` — öffentliche API (Re-Exports)
- `scripts/prepare-german-voices.cjs` — Asset-Prep
- `scripts/preRenderAudio.ts` — Hörproben-Bake
- `src/services/ai/promptBuilder.ts` — PERSONALITY_FROM_VOICE
- `src/constants/prompts.ts` — „Stimm-Persona (Audio): …“

### Env (optional)

```
EXPO_PUBLIC_KOKORO_MODEL_URL=
EXPO_PUBLIC_KOKORO_VOICE_URL=
EXPO_PUBLIC_KOKORO_VOICE_URL_DE_THORSTEN=
EXPO_PUBLIC_KOKORO_VOICE_URL_DE_EVA=
EXPO_PUBLIC_KOKORO_VOICE_URL_DE_KARL=
```

Fallback-Modell:
`https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin/resolve/main/kokoro-martin.onnx`

GGUF-Quellen (cstr): dm_martin → de_thorsten, df_victoria → de_eva, dm_bernd → de_karl.

---

## CODE: voices.ts (komplett)

```typescript
import type { AppLanguage, VoiceId } from '../types/userProfile';
import {
  resolveKokoroPackId,
  type KokoroVoicePackId,
} from './kokoroVoicePacks';

export type VoiceDefinition = {
  id: VoiceId;
  emoji: string;
  kokoroPackId: KokoroVoicePackId;
  pitch: number;
  baseSpeed: number;
  sample: string;
};

export const DEFAULT_VOICE_ID: VoiceId = 'standard_m';
export const FIXED_SPEECH_RATE = 1.0;
export const MIN_SPEECH_RATE = FIXED_SPEECH_RATE;

export const EAGER_SAMPLE_VOICE_IDS: readonly VoiceId[] = [
  'standard_m', 'standard_w', 'prinzessin', 'erzaehler',
  'dorfaeltester', 'historiker', 'gen_z', 'energisch',
] as const;

export const VOICES: VoiceDefinition[] = [
  {
    id: 'standard_m', emoji: '👨', kokoroPackId: 'de_thorsten', pitch: 1.0, baseSpeed: FIXED_SPEECH_RATE,
    sample: 'Moin! Ich bin Findus. Mit mir erlebst du jeden Ort ganz entspannt und auf den Punkt gebracht. Ein ehrlicher, verlässlicher Begleiter für deine Tour.',
  },
  {
    id: 'standard_w', emoji: '👩', kokoroPackId: 'de_eva', pitch: 1.0, baseSpeed: FIXED_SPEECH_RATE,
    sample: 'Hallo! Ich freue mich darauf, gemeinsam mit dir die schönsten Ecken und Geheimnisse dieser Gegend zu entdecken. Lass uns einfach losgehen!',
  },
  {
    id: 'prinzessin', emoji: '👑', kokoroPackId: 'de_eva', pitch: 1.0, baseSpeed: FIXED_SPEECH_RATE,
    sample: 'Trete näher, werter Gast. Lass dich von mir in eine Welt voller Zauber und verborgener Geschichten entführen. Wir wandeln gemeinsam auf königlichen Pfaden.',
  },
  {
    id: 'erzaehler', emoji: '📖', kokoroPackId: 'de_thorsten', pitch: 1.0, baseSpeed: FIXED_SPEECH_RATE,
    sample: 'Lehn dich zurück. Wenn du diese Gegend erleben willst wie in einem epischen Blockbuster-Film, dann bist du bei mir genau richtig. Geschichte wird lebendig.',
  },
  {
    id: 'dorfaeltester', emoji: '🧓', kokoroPackId: 'de_karl', pitch: 1.0, baseSpeed: FIXED_SPEECH_RATE,
    sample: 'Na, mein Kind. Über achtzig Jahre lebe ich schon hier. Ich kenne jeden Winkel und all die alten Geschichten aus der guten alten Zeit. Setz dich kurz zu mir.',
  },
  {
    id: 'historiker', emoji: '📜', kokoroPackId: 'de_karl', pitch: 1.0, baseSpeed: FIXED_SPEECH_RATE,
    sample: 'Willkommen. Präzise Fakten, historische Zusammenhänge und fundiertes Wissen – wenn du die Geschichte tiefgründig verstehen willst, bin ich dein perfekter Guide.',
  },
  {
    id: 'gen_z', emoji: '✌️', kokoroPackId: 'de_thorsten', pitch: 1.0, baseSpeed: FIXED_SPEECH_RATE,
    sample: "Yo Bro! Wenn dir der ganze alte Kram zu langweilig ist und du Bock auf 'nen richtig freshen Vibe hast – safe, dann bin ich dein Mann! Let's go!",
  },
  {
    id: 'energisch', emoji: '⚡', kokoroPackId: 'de_eva', pitch: 1.0, baseSpeed: FIXED_SPEECH_RATE,
    sample: 'Hey! Bist du bereit für ein richtiges Abenteuer? Pack die Sachen ein, wir erkunden diesen Ort mit voller Power und bester Laune!',
  },
];

export const VOICE_PROFILES = VOICES;
export function getVoice(id: VoiceId): VoiceDefinition {
  return VOICES.find((v) => v.id === id) ?? VOICES[0];
}
export function kokoroPackForVoice(id: VoiceId): KokoroVoicePackId {
  return getVoice(id).kokoroPackId ?? resolveKokoroPackId(id);
}
export function voicesForLanguage(_lang?: AppLanguage): VoiceDefinition[] { return VOICES; }
export function defaultVoiceForLanguage(_lang?: AppLanguage): VoiceId { return DEFAULT_VOICE_ID; }
export function speechLocaleForLanguage(_lang?: AppLanguage): string { return 'de-DE'; }
export function clampSpeechRate(_rate?: number): number { return FIXED_SPEECH_RATE; }
```

---

## CODE: kokoroVoicePacks.ts (komplett)

```typescript
import { env } from '../config/env';
import type { VoiceId } from '../types/userProfile';

export type KokoroVoicePackId = 'de_eva' | 'de_karl' | 'de_thorsten';
export type KokoroModelId = 'martin';

export type KokoroVoicePack = {
  id: KokoroVoicePackId;
  label: string;
  fileName: string;
  modelId: KokoroModelId;
  defaultUrl: string;
  fallbackUrls: string[];
  urlEnvKey?: string;
  npzKey?: string;
};

const HF_MARTIN_PT = 'https://huggingface.co/kikiri-tts/kikiri-german-martin/resolve/main/voices/martin.pt';
const HF_VICTORIA_PT = 'https://huggingface.co/kikiri-tts/kikiri-german-victoria/resolve/main/voices/victoria.pt';
const HF_BERND_GGUF = 'https://huggingface.co/cstr/kokoro-voices-GGUF/resolve/main/kokoro-voice-dm_bernd.gguf';
const HF_EVA_GGUF = 'https://huggingface.co/cstr/kokoro-voices-GGUF/resolve/main/kokoro-voice-df_eva.gguf';
const HF_MARTIN_NPZ = 'https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin/resolve/main/voices-martin.npz';

export const DEFAULT_KOKORO_PACK: KokoroVoicePackId = 'de_thorsten';
export const BASE_VOICE_PACK_IDS: readonly KokoroVoicePackId[] = ['de_thorsten', 'de_eva', 'de_karl'] as const;

export const KOKORO_VOICE_PACKS: Record<KokoroVoicePackId, KokoroVoicePack> = {
  de_eva: {
    id: 'de_eva', label: 'Eva (weiblich)', fileName: 'de_eva.bin', modelId: 'martin',
    defaultUrl: HF_VICTORIA_PT, fallbackUrls: [HF_EVA_GGUF],
    urlEnvKey: 'EXPO_PUBLIC_KOKORO_VOICE_URL_DE_EVA',
  },
  de_karl: {
    id: 'de_karl', label: 'Karl (männlich)', fileName: 'de_karl.bin', modelId: 'martin',
    defaultUrl: HF_BERND_GGUF, fallbackUrls: [HF_MARTIN_PT, HF_MARTIN_NPZ],
    urlEnvKey: 'EXPO_PUBLIC_KOKORO_VOICE_URL_DE_KARL', npzKey: 'martin',
  },
  de_thorsten: {
    id: 'de_thorsten', label: 'Thorsten (männlich)', fileName: 'de_thorsten.bin', modelId: 'martin',
    defaultUrl: HF_MARTIN_PT, fallbackUrls: [HF_MARTIN_NPZ],
    urlEnvKey: 'EXPO_PUBLIC_KOKORO_VOICE_URL_DE_THORSTEN', npzKey: 'martin',
  },
};

export const VOICE_ID_TO_KOKORO_PACK: Record<VoiceId, KokoroVoicePackId> = {
  standard_m: 'de_thorsten',
  standard_w: 'de_eva',
  prinzessin: 'de_eva',
  erzaehler: 'de_thorsten',
  dorfaeltester: 'de_karl',
  historiker: 'de_karl',
  gen_z: 'de_thorsten',
  energisch: 'de_eva',
};

export function getKokoroVoicePack(id: KokoroVoicePackId): KokoroVoicePack {
  return KOKORO_VOICE_PACKS[id];
}
export function resolveKokoroPackId(voiceId?: VoiceId | null): KokoroVoicePackId {
  if (!voiceId) return DEFAULT_KOKORO_PACK;
  return VOICE_ID_TO_KOKORO_PACK[voiceId] ?? DEFAULT_KOKORO_PACK;
}
export function modelIdForPack(_packId: KokoroVoicePackId): KokoroModelId { return 'martin'; }
export function resolveKokoroPackUrls(pack: KokoroVoicePack): string[] {
  const urls: string[] = [];
  const push = (u: string) => { const t = u.trim(); if (t && !urls.includes(t)) urls.push(t); };
  if (pack.urlEnvKey) push(env.get(pack.urlEnvKey));
  if (pack.id === 'de_thorsten' || pack.id === 'de_karl') push(env.kokoroVoiceUrl());
  push(pack.defaultUrl);
  for (const u of pack.fallbackUrls) push(u);
  return urls;
}
```

---

## CODE: voiceSampleAssets.ts

```typescript
import type { VoiceId } from '../types/userProfile';

export const VOICE_SAMPLE_MODULES: Record<VoiceId, number> = {
  standard_m: require('../assets/audio/samples/standard_m.wav'),
  standard_w: require('../assets/audio/samples/standard_w.wav'),
  prinzessin: require('../assets/audio/samples/prinzessin.wav'),
  erzaehler: require('../assets/audio/samples/erzaehler.wav'),
  dorfaeltester: require('../assets/audio/samples/dorfaeltester.wav'),
  historiker: require('../assets/audio/samples/historiker.wav'),
  gen_z: require('../assets/audio/samples/gen_z.wav'),
  energisch: require('../assets/audio/samples/energisch.wav'),
};

export const INTRO_WAV_MODULE = require('../assets/audio/intro.wav');
```

---

## CODE: prepare-german-voices.cjs (Kernlogik)

- Download: `kokoro-martin.onnx`, `voices-martin.npz`, GGUFs `dm_martin`, `df_victoria`, `dm_bernd`
- Mapping GGUF → bin:
  - `dm_martin.gguf` → `de_thorsten.bin`
  - `df_victoria.gguf` → `de_eva.bin`
  - `dm_bernd.gguf` → `de_karl.bin`
- Style: letzte `510 * 256 * 4` Bytes aus GGUF (= Float32 Style-Tensor)
- Output: `native-assets/kokoro/voices/*.bin`
- Fallback: `de_thorsten.bin` aus NPZ wenn GGUF fehlt

---

## CODE: AudioVoiceService — wichtige Stellen

Version-Marker: `VOICE_SYSTEM_VERSION = 'de-kokoro-studio-v4'`

```typescript
function resolveSpeakOptions(options?: SpeakVoiceOptions) {
  const profile = getCachedUserProfile();
  const voiceId = options?.voiceId ?? profile?.voiceId ?? 'standard_m';
  const voice = getVoice(voiceId);
  const speed = FIXED_SPEECH_RATE; // immer 1.0
  const pitch = 1;
  const packId = voice.kokoroPackId ?? resolveKokoroPackId(voiceId);
  return { speed, pitch, voiceId, packId, modelId: 'martin' as const };
}
```

API-Highlights:
- `warmupKokoro()` — Martin + 3 Packs → RAM
- `speakWithKokoro(text, { voiceId })` — Live-Inferenz
- `speakSentenceStream(sentences, …)` — LLM→TTS Fließband
- `speakTwoPhase({ introText, bodySentenceStream, voice })`
- `playVoiceSample({ voiceId })` — zuerst Metro-WAV, sonst Synth
- `startVoiceBuffer()` — Boot-Purge + Warmup
- `purgeLegacyVoiceAssets()` — EN/Victoria/af_/am_/bm_ löschen
- Aussprache 3-Tier: Stadt-Map → pronunciations.json → espeak-G2P

Öffentliche Fassade: `src/services/ttsService.ts` re-exportiert diese Funktionen.

---

## Persona (Charakter über Text, nicht Audio-FX)

```typescript
const PERSONALITY_FROM_VOICE = {
  gen_z: 'gen_z',
  historiker: 'historiker',
  energisch: 'party',
  dorfaeltester: 'dorfaeltester',
  erzaehler: 'erzaehler',
  prinzessin: 'prinzessin',
};
```

System-Prompt-Zeile:
`Stimm-Persona (Audio): ${voice.id} — Stilsteuerung über Text/Interpunktion, nicht über Tempo-Drosselung.`

---

## Meine Frage an dich

[HIER DEINE FRAGE EINTIPPEN — z.B. Qualität, Latenz, neues Pack, Bug, Architektur-Review, …]


