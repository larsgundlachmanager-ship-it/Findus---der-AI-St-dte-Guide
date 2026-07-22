# Findus – Intelligenter Audio-Tourguide

React Native (Expo) Kernmodul: Offline-First (SQLite + Supabase-Sync), Geofencing, Two-Tier-KI, Kokoro-TTS.

## Ordnerstruktur

```
src/
  components/     # UI (Header, Chat, Mic, Simulation, Wave)
  constants/      # Prompts & Theme
  db/             # SQLite + Seed (Prisdorf)
  hooks/          # Geofencing, TTS-Listener, Voice-Input
  screens/        # HomeScreen
  services/       # Location, Sync, Supabase, Local AI, OpenAI, STT, Kokoro TTS
  store/          # Zustand
supabase/
  schema.sql      # Master-Tabellen für Supabase
```

## Quick Start

```bash
npm install
cp .env.example .env   # Supabase, OpenAI, Kokoro-URLs
npx expo run:android
```

## Offline-First Sync

Beim App-Start (wenn Online): `syncPOIsFromSupabase()` → SQLite.  
Geofencing liest **nur** aus SQLite.

## Kokoro TTS

Assistant-Nachrichten → lokales `kokoro.onnx` (Download beim ersten Start) → `expo-av`.  
Kein `expo-speech` / kein Cloud-TTS.
