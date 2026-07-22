# findus-espeak

Natives **espeak-ng** G2P für Findus (Android / Expo Dev Client).

## Aufbau

- `libttsespeak.so` — offizielles espeak-ng Android Release (JNI C-API)
- `findus_espeak.so` — dünne Expo-JNI-Bridge (`textToPhonemes`, voice=`de`)
- `espeak-ng-data` — Stimmdaten inkl. Deutsch (`de`)

## Setup

```bash
npm run fetch:espeak
npx expo prebuild
npx expo run:android
```

## API (JS)

```ts
import {
  nativeEspeakInitialize,
  nativeEspeakTextToPhonemes,
} from 'findus-espeak';

await nativeEspeakInitialize('assets', 'de');
const ipa = await nativeEspeakTextToPhonemes('Willkommen bei Findus.', 'de');
```

Lizenz: espeak-ng ist **GPL-3.0** — das betrifft die native Library.
