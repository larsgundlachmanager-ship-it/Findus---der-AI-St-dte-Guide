"""SSOT: welches Handy für Live-QA vs. Unterwegs-APK.

Override via Env:
  FINDUS_QA_SERIAL      — Desktop Live-QA Gerät
  FINDUS_TRAVEL_SERIAL  — Nothing Phone (nur frische APK)
  ANDROID_SERIAL        — falls gesetzt und FINDUS_QA_SERIAL fehlt, für QA nutzen
"""
from __future__ import annotations

import os

# Nothing Phone (A059 / Asteroids) — nur frische APK zum Unterwegstesten.
TRAVEL_SERIAL = (os.environ.get("FINDUS_TRAVEL_SERIAL") or "00143157P001105").strip()

# Neues Desktop-Testgerät (Samsung Galaxy S7 / herolte).
# KEIN Speech Services → Live-QA immer tippen (askServer / Tippfeld), nie Mic-Hold.
_QA_DEFAULT = "ce12171cccf9c0810c"
QA_TYPE_ONLY = True  # Spracherkennung fehlt auf diesem Gerät

QA_SERIAL = (
    os.environ.get("FINDUS_QA_SERIAL")
    or os.environ.get("ANDROID_SERIAL")
    or _QA_DEFAULT
).strip()


def require_qa_serial() -> str:
    # Explicit FINDUS_QA_SERIAL always wins (incl. temporary Travel reuse for a job).
    explicit = (os.environ.get("FINDUS_QA_SERIAL") or "").strip()
    if explicit:
        return explicit
    if not QA_SERIAL:
        raise RuntimeError(
            "Kein QA-Gerät konfiguriert. Neues Handy per USB verbinden, "
            "Serial in scripts/deviceQa/_device_ids.py (_QA_DEFAULT) oder "
            "Env FINDUS_QA_SERIAL setzen. Nothing (TRAVEL) nicht für Live-QA nutzen."
        )
    if QA_SERIAL == TRAVEL_SERIAL:
        raise RuntimeError(
            f"QA-Serial darf nicht Nothing/Travel sein ({TRAVEL_SERIAL}). "
            "Live-Tests nur auf dem neuen Handy. "
            "Override: FINDUS_QA_SERIAL=<serial> setzen."
        )
    return QA_SERIAL
