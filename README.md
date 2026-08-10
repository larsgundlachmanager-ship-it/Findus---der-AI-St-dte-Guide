# Findus – Intelligenter Audio-Tourguide

React Native (Expo) Kernmodul: Offline-First (SQLite + Supabase-Sync), Geofencing, Two-Tier-KI, Cartesia-TTS.

## Ordnerstruktur

```
src/
  components/     # UI (Header, Chat, Mic, Simulation, Wave)
  constants/      # Prompts & Theme
  db/             # SQLite + Seed
  hooks/          # Geofencing, TTS-Listener, Voice-Input
  screens/        # HomeScreen
  services/       # Location, Sync, Supabase, Gemini, STT, Cartesia TTS
  store/          # Zustand
supabase/
  schema.sql      # Master-Tabellen für Supabase
```

## Quick Start

```bash
npm install
cp .env.example .env   # Supabase, Gemini, Cartesia, …
npx expo run:android
```

## Offline-First Sync

Beim App-Start (wenn Online): `syncPOIsFromSupabase()` → SQLite.  
Geofencing liest **nur** aus SQLite.

## TTS

Primär: **Cartesia sonic-3.5** (Cloud). Offline/Fail: native Systemstimme (`expo-speech`).
