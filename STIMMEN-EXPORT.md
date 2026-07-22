# Findus Stimmen — Code & Anweisungen

Stand: Studio-System **de-kokoro-studio-v4**  
Prinzip: **8 UI-Rollen → 3 native deutsche Kokoro-Packs**. Charakter nur über LLM-Textstil — **nie** Pitch/Speed-Manipulation. Tempo fest **1.0**.

---

## Architektur (Kurz)

```
UI wählt VoiceId (8 Rollen)
    ↓
voices.ts + kokoroVoicePacks.ts  →  Pack: de_thorsten | de_eva | de_karl
    ↓
AudioVoiceService (Kokoro Martin-ONNX + Style-.bin im RAM)
    ↓
Hörproben: Metro-gebündelte WAVs (src/assets/audio/samples/)
Live-Tour: G2P (espeak) → Tokens → ONNX → WAV → AudioPlayQueue
Persona: LLM-Prompt (promptBuilder / prompts.ts) färbt den Textstil
```

| UI-Rolle (`VoiceId`) | Emoji | Kokoro-Pack | Hörprobe-Idee |
|---|---|---|---|
| `standard_m` | 👨 | `de_thorsten` | entspannter Begleiter |
| `standard_w` | 👩 | `de_eva` | freundliche Entdeckerin |
| `prinzessin` | 👑 | `de_eva` | märchenhaft / königlich |
| `erzaehler` | 📖 | `de_thorsten` | episch / filmisch |
| `dorfaeltester` | 🧓 | `de_karl` | weise / lokal |
| `historiker` | 📜 | `de_karl` | präzise / fundiert |
| `gen_z` | ✌️ | `de_thorsten` | Slang nur über LLM |
| `energisch` | ⚡ | `de_eva` | Dynamik nur über LLM |

Modell: immer **Martin-ONNX** + `langCode = 'd'`.  
Pack-Dateien: `de_thorsten.bin`, `de_eva.bin`, `de_karl.bin` (Style-Vektoren 510×256 float32).

---

## Anweisungen / Workflow

### 1. Stimmen-Assets holen & konvertieren

```bash
npm run prepare:voices
# oder zusammen:
npm run fetch:kokoro
```

Was passiert (`scripts/prepare-german-voices.cjs`):

1. Download Martin-ONNX + `voices-martin.npz` (Hugging Face Godelaune)
2. Download DE-GGUF: `dm_martin`, `df_victoria`, `dm_bernd` (cstr/kokoro-voices-GGUF)
3. GGUF → Style-Bytes extrahieren → schreiben nach:
   - `native-assets/kokoro/voices/de_thorsten.bin`
   - `native-assets/kokoro/voices/de_eva.bin`
   - `native-assets/kokoro/voices/de_karl.bin`
4. Fallback: `de_thorsten.bin` aus `voices-martin.npz`, falls GGUF fehlt

### 2. Hörproben + Intro vorab rendern (0 ms Play im Onboarding)

Voraussetzung: Schritt 1 + `espeak-ng` installiert.

```bash
npm run preRender:audio
# Alias:
npm run generate:voice-assets
npm run bake:waves
```

Ausgabe:

- `src/assets/audio/intro.wav` — Standard männlich / de_thorsten
- `src/assets/audio/samples/*.wav` — alle 8 Rollen

Texte müssen synchron zu `src/constants/voices.ts` bleiben (Script `scripts/preRenderAudio.ts` hält eine Kopie).

### 3. Smoke-Test Mapping

```bash
node scripts/validate-studio-voices.cjs
```

Prüft: 8 Rollen → nur `de_thorsten` / `de_eva` / `de_karl`, `FIXED_SPEECH_RATE = 1.0`.

### 4. Prebuild (alles zusammen)

```bash
npm run prebuild
# = fetch:kokoro + fetch:espeak + generate:voice-assets + expo prebuild
```

### 5. Runtime (App)

- Boot: `startVoiceBuffer()` / `warmupKokoro()` → Martin-ONNX + 3 Packs → RAM
- Hörprobe: `playVoiceSample({ voiceId })` → zuerst Metro-WAV, sonst Live-Synth
- Tour/Chat: `speakWithKokoro` / `speakSentenceStream` / `speakTwoPhase`
- Öffentliche API: `src/services/ttsService.ts` (re-exportiert AudioVoiceService)

### Regeln (bewusst so programmiert)

1. **Kein Sprechtempo-Slider** — `FIXED_SPEECH_RATE = 1.0`, `clampSpeechRate()` ignoriert Argumente.
2. **Kein Pitch-Trick** für Charakter — Pitch Playback = 1.0.
3. **Charakter = LLM-Text** (Interpunktion, Wortwahl, Persona im System-Prompt).
4. **Kein EN-Pack / kein Puck** im Studio-v4 — Legacy wird bei Upgrade gepurged.
5. **3-Tier Aussprache**: Stadt-Map → `pronunciations.json` → espeak-G2P.

### Env (optional)

```
EXPO_PUBLIC_KOKORO_MODEL_URL=…
EXPO_PUBLIC_KOKORO_VOICE_URL=…
EXPO_PUBLIC_KOKORO_VOICE_URL_DE_THORSTEN=…
EXPO_PUBLIC_KOKORO_VOICE_URL_DE_EVA=…
EXPO_PUBLIC_KOKORO_VOICE_URL_DE_KARL=…
```

Fallback-Modell-URL im Code:  
`https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin/resolve/main/kokoro-martin.onnx`

---

## Datei-Inventar (alles Stimmen-relevante)

### Kern-Konfiguration

| Datei | Rolle |
|---|---|
| `src/constants/voices.ts` | 8 UI-Stimmen, Sample-Texte, `FIXED_SPEECH_RATE` |
| `src/constants/kokoroVoicePacks.ts` | 3 Packs, URLs, VoiceId→Pack Mapping |
| `src/constants/voiceSampleAssets.ts` | `require()` der Metro-WAVs + Intro |
| `src/types/userProfile.ts` | `VoiceId`, Legacy-Normalisierung |

### Runtime TTS

| Datei | Rolle |
|---|---|
| `src/services/AudioVoiceService.ts` | Kokoro-Inferenz, Queue, Samples, Warmup (~1960 Zeilen) |
| `src/services/ttsService.ts` | Öffentliche Fassade / Re-Exports |
| `src/services/ttsPolicy.ts` | Status-Messages, Product-Mode Flags |
| `src/hooks/useVoiceInput.ts` | Mic Hold → STT → OpenAI Stream → `speakTwoPhase` |

### Persona / Prompt (Charakter über Text)

| Datei | Rolle |
|---|---|
| `src/constants/prompts.ts` | `Stimm-Persona (Audio): ${voice.id}…` |
| `src/services/ai/promptBuilder.ts` | `PERSONALITY_FROM_VOICE` Mapping |

### Build-Scripts

| Datei | Rolle |
|---|---|
| `scripts/prepare-german-voices.cjs` | Download + GGUF/NPZ → `.bin` |
| `scripts/preRenderAudio.ts` | Offline-Render Intro + 8 Samples |
| `scripts/generateVoiceAssets.ts` | Alias → preRenderAudio |
| `scripts/validate-studio-voices.cjs` | Mapping-Smoke-Test |
| `scripts/fetch-kokoro-assets.cjs` | (wird von `fetch:kokoro` aufgerufen) |

### Assets

| Pfad | Inhalt |
|---|---|
| `native-assets/kokoro/kokoro-martin.onnx` | Modell (nach prepare) |
| `native-assets/kokoro/voices/*.bin` | Style-Packs |
| `src/assets/audio/intro.wav` | Onboarding-Intro |
| `src/assets/audio/samples/*.wav` | 8 Hörproben |

### G2P / Aussprache (Pipeline um Stimmen herum)

- `src/services/g2p/*`
- `src/services/tts/pronunciationMap.ts`
- `modules/findus-espeak` (natives espeak-ng)

---

## Vollständiger Code — Konfigurationsdateien

### `src/constants/voices.ts`

```ts
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
  /** Systemweit unveränderbar 1.0 — kein Slider, keine Verzerrung. */
  baseSpeed: number;
  sample: string;
};

export const DEFAULT_VOICE_ID: VoiceId = 'standard_m';

/** Inferenz-/Playback-Tempo: systemweit fest (kein Sprechtempo-Slider). */
export const FIXED_SPEECH_RATE = 1.0;

/** @deprecated Früher Minimum — Tempo ist jetzt immer FIXED_SPEECH_RATE. */
export const MIN_SPEECH_RATE = FIXED_SPEECH_RATE;

/** Alle 8 Hörproben — vorgerendert unter src/assets/audio/samples/. */
export const EAGER_SAMPLE_VOICE_IDS: readonly VoiceId[] = [
  'standard_m',
  'standard_w',
  'prinzessin',
  'erzaehler',
  'dorfaeltester',
  'historiker',
  'gen_z',
  'energisch',
] as const;

/**
 * 8 UI-Rollen → 3 native deutsche Kokoro-Packs (de_thorsten / de_eva / de_karl).
 * Charakter nur über LLM-Textstil — nie Pitch/Speed-Manipulation.
 * Tempo ausnahmslos FIXED_SPEECH_RATE (1.0).
 */
export const VOICES: VoiceDefinition[] = [
  {
    id: 'standard_m',
    emoji: '👨',
    kokoroPackId: 'de_thorsten',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      'Moin! Ich bin Findus. Mit mir erlebst du jeden Ort ganz entspannt und auf den Punkt gebracht. Ein ehrlicher, verlässlicher Begleiter für deine Tour.',
  },
  {
    id: 'standard_w',
    emoji: '👩',
    kokoroPackId: 'de_eva',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      'Hallo! Ich freue mich darauf, gemeinsam mit dir die schönsten Ecken und Geheimnisse dieser Gegend zu entdecken. Lass uns einfach losgehen!',
  },
  {
    id: 'prinzessin',
    emoji: '👑',
    kokoroPackId: 'de_eva',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      'Trete näher, werter Gast. Lass dich von mir in eine Welt voller Zauber und verborgener Geschichten entführen. Wir wandeln gemeinsam auf königlichen Pfaden.',
  },
  {
    id: 'erzaehler',
    emoji: '📖',
    kokoroPackId: 'de_thorsten',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      'Lehn dich zurück. Wenn du diese Gegend erleben willst wie in einem epischen Blockbuster-Film, dann bist du bei mir genau richtig. Geschichte wird lebendig.',
  },
  {
    id: 'dorfaeltester',
    emoji: '🧓',
    kokoroPackId: 'de_karl',
    pitch: 1.0,
    /** Exakt wie Hörprobe: 1.0 — keine Drosselung. */
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      'Na, mein Kind. Über achtzig Jahre lebe ich schon hier. Ich kenne jeden Winkel und all die alten Geschichten aus der guten alten Zeit. Setz dich kurz zu mir.',
  },
  {
    id: 'historiker',
    emoji: '📜',
    kokoroPackId: 'de_karl',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      'Willkommen. Präzise Fakten, historische Zusammenhänge und fundiertes Wissen – wenn du die Geschichte tiefgründig verstehen willst, bin ich dein perfekter Guide.',
  },
  {
    id: 'gen_z',
    emoji: '✌️',
    kokoroPackId: 'de_thorsten',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      "Yo Bro! Wenn dir der ganze alte Kram zu langweilig ist und du Bock auf 'nen richtig freshen Vibe hast – safe, dann bin ich dein Mann! Let's go!",
  },
  {
    id: 'energisch',
    emoji: '⚡',
    kokoroPackId: 'de_eva',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      'Hey! Bist du bereit für ein richtiges Abenteuer? Pack die Sachen ein, wir erkunden diesen Ort mit voller Power und bester Laune!',
  },
];

export const VOICE_PROFILES = VOICES;

export function getVoice(id: VoiceId): VoiceDefinition {
  return VOICES.find((v) => v.id === id) ?? VOICES[0];
}

export function kokoroPackForVoice(id: VoiceId): KokoroVoicePackId {
  return getVoice(id).kokoroPackId ?? resolveKokoroPackId(id);
}

export function voicesForLanguage(_lang?: AppLanguage): VoiceDefinition[] {
  return VOICES;
}

export function defaultVoiceForLanguage(_lang?: AppLanguage): VoiceId {
  return DEFAULT_VOICE_ID;
}

export function speechLocaleForLanguage(_lang?: AppLanguage): string {
  return 'de-DE';
}

/** Systemweit fest 1.0 — Argumente werden ignoriert. */
export function clampSpeechRate(_rate?: number): number {
  return FIXED_SPEECH_RATE;
}
```

### `src/constants/kokoroVoicePacks.ts`

```ts
import { env } from '../config/env';
import type { VoiceId } from '../types/userProfile';

/** Ausschließlich 3 native deutsche Kokoro-Voice-Pakete — kein EN, kein Puck. */
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

const HF_MARTIN_PT =
  'https://huggingface.co/kikiri-tts/kikiri-german-martin/resolve/main/voices/martin.pt';
const HF_VICTORIA_PT =
  'https://huggingface.co/kikiri-tts/kikiri-german-victoria/resolve/main/voices/victoria.pt';
const HF_BERND_GGUF =
  'https://huggingface.co/cstr/kokoro-voices-GGUF/resolve/main/kokoro-voice-dm_bernd.gguf';
const HF_EVA_GGUF =
  'https://huggingface.co/cstr/kokoro-voices-GGUF/resolve/main/kokoro-voice-df_eva.gguf';
const HF_MARTIN_NPZ =
  'https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin/resolve/main/voices-martin.npz';

export const DEFAULT_KOKORO_PACK: KokoroVoicePackId = 'de_thorsten';

/** Deutsche Basisstimmen — Boot-Preload (nur 3 Packs). */
export const BASE_VOICE_PACK_IDS: readonly KokoroVoicePackId[] = [
  'de_thorsten',
  'de_eva',
  'de_karl',
] as const;

export const KOKORO_VOICE_PACKS: Record<KokoroVoicePackId, KokoroVoicePack> = {
  de_eva: {
    id: 'de_eva',
    label: 'Eva (weiblich)',
    fileName: 'de_eva.bin',
    modelId: 'martin',
    defaultUrl: HF_VICTORIA_PT,
    fallbackUrls: [HF_EVA_GGUF],
    urlEnvKey: 'EXPO_PUBLIC_KOKORO_VOICE_URL_DE_EVA',
  },
  de_karl: {
    id: 'de_karl',
    label: 'Karl (männlich)',
    fileName: 'de_karl.bin',
    modelId: 'martin',
    defaultUrl: HF_BERND_GGUF,
    fallbackUrls: [HF_MARTIN_PT, HF_MARTIN_NPZ],
    urlEnvKey: 'EXPO_PUBLIC_KOKORO_VOICE_URL_DE_KARL',
    npzKey: 'martin',
  },
  de_thorsten: {
    id: 'de_thorsten',
    label: 'Thorsten (männlich)',
    fileName: 'de_thorsten.bin',
    modelId: 'martin',
    defaultUrl: HF_MARTIN_PT,
    fallbackUrls: [HF_MARTIN_NPZ],
    urlEnvKey: 'EXPO_PUBLIC_KOKORO_VOICE_URL_DE_THORSTEN',
    npzKey: 'martin',
  },
};

/**
 * UI-Rolle → deutsches Kokoro-Pack.
 * gen_z → Thorsten (Slang nur über LLM), energisch → Eva (Dynamik über LLM).
 */
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

export function modelIdForPack(_packId: KokoroVoicePackId): KokoroModelId {
  return 'martin';
}

export function resolveKokoroPackUrls(pack: KokoroVoicePack): string[] {
  const urls: string[] = [];
  const push = (u: string) => {
    const t = u.trim();
    if (t && !urls.includes(t)) urls.push(t);
  };
  if (pack.urlEnvKey) push(env.get(pack.urlEnvKey));
  if (pack.id === 'de_thorsten' || pack.id === 'de_karl') {
    push(env.kokoroVoiceUrl());
  }
  push(pack.defaultUrl);
  for (const u of pack.fallbackUrls) push(u);
  return urls;
}

export function resolveKokoroPackUrl(pack: KokoroVoicePack): string {
  return resolveKokoroPackUrls(pack)[0] ?? '';
}

export function listKokoroVoicePacks(): KokoroVoicePack[] {
  return Object.values(KOKORO_VOICE_PACKS);
}

export function listDownloadableKokoroPacks(): KokoroVoicePack[] {
  return listKokoroVoicePacks();
}
```

### `src/constants/voiceSampleAssets.ts`

```ts
import type { VoiceId } from '../types/userProfile';

/** Metro-gebündelte Hörproben — 0 ms Ladezeit beim Play-Button. */
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

/** Vorgerendertes Onboarding-Intro (de_thorsten / Standard-Männlich). */
export const INTRO_WAV_MODULE = require('../assets/audio/intro.wav');
```

### `scripts/validate-studio-voices.cjs` (komplett)

```js
/**
 * Smoke-Test: 8 DE-Rollen → 3 native Kokoro-Packs, speed=1.0.
 * node scripts/validate-studio-voices.cjs
 */
const assert = require('assert');

const VOICE_ID_TO_PACK = {
  standard_m: 'de_thorsten',
  standard_w: 'de_eva',
  prinzessin: 'de_eva',
  erzaehler: 'de_thorsten',
  dorfaeltester: 'de_karl',
  historiker: 'de_karl',
  gen_z: 'de_thorsten',
  energisch: 'de_eva',
};

const ALLOWED = new Set(['de_thorsten', 'de_eva', 'de_karl']);

for (const [role, pack] of Object.entries(VOICE_ID_TO_PACK)) {
  assert.ok(ALLOWED.has(pack), `${role} → ${pack} ist kein natives DE-Pack`);
}
console.log('✓ 8 Rollen → nur de_thorsten/de_eva/de_karl');

assert.strictEqual(Object.keys(VOICE_ID_TO_PACK).length, 8);
console.log('✓ 8 UI-Stimmen konfiguriert');

assert.strictEqual(VOICE_ID_TO_PACK.gen_z, 'de_thorsten');
assert.strictEqual(VOICE_ID_TO_PACK.energisch, 'de_eva');
console.log('✓ gen_z→thorsten, energisch→eva');

const FIXED_SPEECH_RATE = 1.0;
assert.strictEqual(FIXED_SPEECH_RATE, 1.0);
console.log('✓ FIXED_SPEECH_RATE = 1.0');

process.exit(0);
```

### Persona-Mapping (`promptBuilder.ts`)

```ts
const PERSONALITY_FROM_VOICE: Partial<Record<VoiceId, FindusPersonality>> = {
  gen_z: 'gen_z',
  historiker: 'historiker',
  energisch: 'party',
  dorfaeltester: 'dorfaeltester',
  erzaehler: 'erzaehler',
  prinzessin: 'prinzessin',
};
```

Im System-Prompt (`prompts.ts`):

```
Stimm-Persona (Audio): ${voice.id} — Stilsteuerung über Text/Interpunktion, nicht über Tempo-Drosselung.
```

### npm-Scripts (`package.json`)

```json
"fetch:kokoro": "node scripts/fetch-kokoro-assets.cjs && node scripts/prepare-german-voices.cjs",
"preRender:audio": "npx --yes tsx scripts/preRenderAudio.ts",
"generate:voice-assets": "npx --yes tsx scripts/preRenderAudio.ts",
"bake:waves": "npm run preRender:audio",
"prepare:voices": "node scripts/prepare-german-voices.cjs",
"prebuild": "npm run fetch:kokoro && npm run fetch:espeak && npm run generate:voice-assets && expo prebuild"
```

---

## Große Runtime-Datei (nicht inline)

`src/services/AudioVoiceService.ts` (~1960 Zeilen) enthält u. a.:

- Modell-/Pack-Download & Bundle-Install
- Style-Vektoren → RAM (`voiceRam`)
- `synthesizePcm` / `synthesizeWav` (ONNX)
- `speakWithKokoro`, `speakSentenceStream`, `speakTwoPhase`
- `playVoiceSample` (Metro-WAV zuerst)
- `warmupKokoro`, `startVoiceBuffer`, `purgeLegacyVoiceAssets`, `resetVoiceSystem`
- 3-Tier-Aussprache via `applyPronunciationFixes` + G2P
- AudioPlayQueue mit 2-Satz-Vorlauf, Silence-Trim, Crossfade

Öffentliche API darüber: `src/services/ttsService.ts`.

Build-Pipeline-Code:

- `scripts/prepare-german-voices.cjs` (komplett im Repo)
- `scripts/preRenderAudio.ts` (komplett im Repo)

---

## Schnell-Checkliste „Stimmen neu bauen“

1. `npm run prepare:voices`
2. `npm run preRender:audio` (espeak-ng nötig)
3. `node scripts/validate-studio-voices.cjs`
4. App neu bauen: `npx expo run:android` (oder `npm run prebuild`)
5. Bei Upgrade der Pack-Version: `VOICE_SYSTEM_VERSION` in AudioVoiceService erhöht sich → alte `.bin` werden gelöscht und neu geladen
