# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(r"c:/Users/larsf/Findus 2.0")


def atomic_write(p: Path, text: str) -> None:
    tmp = p.with_suffix(p.suffix + ".tmpwrite")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(p)


def patch_session() -> None:
    p = ROOT / "src/module2/planning/planSessionState.ts"
    t = p.read_text(encoding="utf-8")
    if "isPlanRepitching" not in t:
        old = """export function getActiveTaskOverride(): IngestOpenWish | null {
  return usePlanSessionStore.getState().overrideWish;
}"""
        new = """export function getActiveTaskOverride(): IngestOpenWish | null {
  return usePlanSessionStore.getState().overrideWish;
}

export function isPlanRepitching(): boolean {
  return Boolean(usePlanSessionStore.getState().repitchingStepKey);
}"""
        assert old in t, "getActiveTaskOverride"
        t = t.replace(old, new, 1)
        atomic_write(p, t)
    print("session ok")


def patch_calendar() -> None:
    p = ROOT / "src/module2/timeline/planCalendarUiStore.ts"
    t = p.read_text(encoding="utf-8")
    needle = "websiteUrl?: string | null;\n  walkMinFromPrev"
    if needle not in t:
        old = """  mapsUrl: string;
  menuUrl?: string | null;
  walkMinFromPrev?: number | null;"""
        new = """  mapsUrl: string;
  menuUrl?: string | null;
  websiteUrl?: string | null;
  walkMinFromPrev?: number | null;"""
        assert old in t, "PlanChoiceCard"
        atomic_write(p, t.replace(old, new, 1))
    print("calendar ok")


def patch_types() -> None:
    p = ROOT / "src/module2/planning/planningTypes.ts"
    t = p.read_text(encoding="utf-8")
    needle = "websiteUrl?: string | null;\n    ticketUrl"
    if needle not in t:
        old = """    menuUrl?: string | null;
    ticketUrl?: string | null;
    reserveUrl?: string | null;"""
        new = """    menuUrl?: string | null;
    websiteUrl?: string | null;
    ticketUrl?: string | null;
    reserveUrl?: string | null;"""
        assert old in t, "DeepResearchUiCard"
        atomic_write(p, t.replace(old, new, 1))
    print("types ok")


def patch_orchestrator_wait() -> None:
    p = ROOT / "src/module2/planning/planSessionOrchestrator.ts"
    t = p.read_text(encoding="utf-8")
    if "repitchingStepKey" in t and "hadChoice && !ui.pendingChoice && !repitching" in t:
        print("orchestrator wait already ok")
        return
    old = """async function waitForPickOrAdvance(timeoutMs = 180_000): Promise<void> {
  const start = Date.now();
  let hadChoice = Boolean(usePlanCalendarUiStore.getState().pendingChoice);
  while (Date.now() - start < timeoutMs) {
    const ui = usePlanCalendarUiStore.getState();
    if (hadChoice && !ui.pendingChoice) return;
    if (getActiveTaskOverride()) return;
    const phase = usePlanSessionStore.getState().phase;
    if (phase === 'idle' || phase === 'final') return;
    // Kein Reminder-Speak — User entscheidet selbst, wann weiter
    await new Promise((r) => setTimeout(r, 400));
    hadChoice = hadChoice || Boolean(ui.pendingChoice);
  }
}"""
    new = """async function waitForPickOrAdvance(timeoutMs = 180_000): Promise<void> {
  const start = Date.now();
  let hadChoice = Boolean(usePlanCalendarUiStore.getState().pendingChoice);
  while (Date.now() - start < timeoutMs) {
    const ui = usePlanCalendarUiStore.getState();
    const repitching = Boolean(
      usePlanSessionStore.getState().repitchingStepKey,
    );
    // Reject/Re-Pitch: pending kurz null — nicht als gewaehlt werten
    if (hadChoice && !ui.pendingChoice && !repitching) return;
    if (getActiveTaskOverride() && !repitching) return;
    const phase = usePlanSessionStore.getState().phase;
    if (phase === 'idle' || phase === 'final') return;
    // Kein Reminder-Speak — User entscheidet selbst, wann weiter
    await new Promise((r) => setTimeout(r, 400));
    hadChoice = hadChoice || Boolean(ui.pendingChoice);
  }
}"""
    assert old in t, "waitForPickOrAdvance missing"
    atomic_write(p, t.replace(old, new, 1))
    print("orchestrator wait ok")


def main() -> None:
    patch_session()
    patch_calendar()
    patch_types()
    patch_orchestrator_wait()


if __name__ == "__main__":
    main()
