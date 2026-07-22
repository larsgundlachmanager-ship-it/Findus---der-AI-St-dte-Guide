# -*- coding: utf-8 -*-
"""Bake German onboarding WAVs via Windows SAPI (bootstrap until Kokoro-Martin replaces them)."""
from __future__ import annotations

import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "tts" / "de"
OUT.mkdir(parents=True, exist_ok=True)


def speak_to_wav(text: str, path: Path, rate: int = 0) -> None:
    import win32com.client  # type: ignore

    voice = win32com.client.Dispatch("SAPI.SpVoice")
    stream = win32com.client.Dispatch("SAPI.SpFileStream")
    # SSFMCreateForWrite = 3
    if path.exists():
        path.unlink()
    stream.Open(str(path), 3)
    voice.AudioOutputStream = stream
    voice.Rate = rate
    # Prefer German voice
    try:
        for v in voice.GetVoices():
            desc = v.GetDescription()
            if "German" in desc or "Deutsch" in desc or "Hedda" in desc or "Stefan" in desc:
                voice.Voice = v
                break
    except Exception:
        pass
    voice.Speak(text)
    stream.Close()
    print(f"OK {path.name} ({path.stat().st_size} bytes)")


SAMPLES = {
    "intro-head": "Hallo und herzlich willkommen. Ich bin Findus.",
    "intro-body": (
        "Ich bin kein normaler Audioguide, der einfach nur Texte vorliest. "
        "Ich bin das, was du aus mir machst. Gleich darfst du entscheiden, wie ich klingen soll, "
        "ob als weiser Historiker, als lockerer Kumpel oder als die gute Seele des Ortes. "
        "Lass uns gemeinsam dein Profil anlegen, damit ich dir die Stadt genauso erklaeren kann, "
        "wie es perfekt zu dir passt. Ich freue mich auf dich."
    ),
    "sample-martin": (
        "Hallo, ich bin Martin, die Standardstimme von Findus. "
        "Klar, warm und gut verstaendlich. Ich begleite dich ruhig durch die Stadt."
    ),
    "sample-historiker": (
        "Guten Tag. Ich bin der Historiker. Mit Bedacht und Respekt erzaehle ich "
        "von Menschen, Orten und Jahrhunderten."
    ),
    "sample-erzaehler": (
        "Ich bin der Erzaehler. Stell dir vor, die Strassen sind Seiten "
        "und wir blaettern gemeinsam."
    ),
    "sample-genz": "Yo, ich bin so Gen-Z Vibes. Kurz, ehrlich, ohne Beamtendeutsch.",
    "sample-aufgedreht": (
        "Heyyy! Ich bin die aufgedrehte Stimme! Energie, Tempo, grosse Augen!"
    ),
    "sample-ruhig": (
        "Ich bin ruhig und besonnen. Langsam atmen. Die Stadt kommt zu dir."
    ),
    "sample-weiblich": (
        "Hallo, ich spreche mit einer weiblichen Stimme, offen, nahbar und mit einem Laecheln."
    ),
    "sample-maennlich": (
        "Moin. Maennliche Stimme, klar und bodenstaendig. "
        "Ich erklaere dir die Stadt ohne Schnoerkel."
    ),
    "sample-neutral": (
        "Ich bin die neutrale Stimme. Sachlich, ausgewogen, ohne Drama."
    ),
    "sample-prinzessin": (
        "Seid gegruesst! Ich bin die Prinzessin. Sanft, ein wenig maerchenhaft "
        "und trotzdem ehrlich."
    ),
}


def main() -> int:
    try:
        import win32com.client  # noqa: F401
    except ImportError:
        print("pip install pywin32  (needed for SAPI)", file=sys.stderr)
        return 1

    for name, text in SAMPLES.items():
        speak_to_wav(text, OUT / f"{name}.wav")
    print(f"Done -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
