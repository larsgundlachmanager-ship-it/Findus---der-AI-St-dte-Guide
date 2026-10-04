from pathlib import Path

# --- landmarkNavCoach latch ---
p = Path(r"src/services/navigation/landmarkNavCoach.ts")
t = p.read_text(encoding="utf-8")
if "navOpeningSpokenLatch" not in t:
    t = t.replace(
        "let session: CoachSession | null = null;\nlet enrichEpoch = 0;",
        "let session: CoachSession | null = null;\nlet enrichEpoch = 0;\n/** Überlebt Session-Reset bis Route ready — verhindert Doppel-ETA. */\nlet navOpeningSpokenLatch = false;",
        1,
    )
    t = t.replace(
        """export function beginLandmarkNavCoach(opts: {
  destinationName: string;
  destLat: number;
  destLng: number;
}): void {
  const myEpoch = ++enrichEpoch;
  session = {
    destinationName: opts.destinationName,
    destLat: opts.destLat,
    destLng: opts.destLng,
    openingSpoken: false,
    routeReady: false,""",
        """export function beginLandmarkNavCoach(opts: {
  destinationName: string;
  destLat: number;
  destLng: number;
}): void {
  const myEpoch = ++enrichEpoch;
  session = {
    destinationName: opts.destinationName,
    destLat: opts.destLat,
    destLng: opts.destLng,
    openingSpoken: navOpeningSpokenLatch,
    routeReady: false,""",
        1,
    )
    t = t.replace(
        "export function resetLandmarkNavCoach(): void {\n  session = null;\n  enrichEpoch += 1;",
        "export function resetLandmarkNavCoach(): void {\n  session = null;\n  navOpeningSpokenLatch = false;\n  enrichEpoch += 1;",
        1,
    )
    t = t.replace(
        "export async function speakNavOpeningIfNeeded(\n  destinationName: string,\n): Promise<void> {\n  if (!session || session.openingSpoken) return;",
        "export async function speakNavOpeningIfNeeded(\n  destinationName: string,\n): Promise<void> {\n  if (!session || session.openingSpoken || navOpeningSpokenLatch) return;",
        1,
    )
    t = t.replace(
        "  session.openingSpoken = true;\n\n  const explain = await shouldExplainHandsFreeNav();",
        "  session.openingSpoken = true;\n  navOpeningSpokenLatch = true;\n\n  const explain = await shouldExplainHandsFreeNav();",
        1,
    )
    t = t.replace(
        "export function markNavOpeningSpoken(): void {\n  if (session) session.openingSpoken = true;\n}",
        "export function markNavOpeningSpoken(): void {\n  navOpeningSpokenLatch = true;\n  if (session) session.openingSpoken = true;\n}",
        1,
    )
    Path(r".cursor/_landmarkNavCoach_new.ts").write_text(t, encoding="utf-8")
    print("coach patched")
else:
    print("coach already has latch")

# --- runConciergeTurn bridgeAlreadySpoken ---
rt = Path(r"src/module2/router/runConciergeTurn.ts")
tt = rt.read_text(encoding="utf-8")
old = """              bridgeAlreadySpoken:
                (bridgeSpokenDuringAnalyze || analysis.bridgeSpokenEarly) &&
                /starte die Navigation|Navigation (zum|nach|zu)\\b/i.test(
                  String(analysis.bridge || ''),
                ),"""
new = """              // Call-1 Nav-Zusage schon gesprochen → Call-2 nur Dauer
              bridgeAlreadySpoken: Boolean(
                bridgeSpokenDuringAnalyze || analysis.bridgeSpokenEarly,
              ),"""
if old not in tt:
    raise SystemExit("bridgeAlreadySpoken block not found")
Path(r".cursor/_turn_bridge_new.ts").write_text(tt.replace(old, new, 1), encoding="utf-8")
print("turn bridge patched")

# dining smoke
dp = Path(r"src/module2/pitch/diningPitch.smoke.test.ts")
dt = dp.read_text(encoding="utf-8")
old_d = """assert(
  scoreSpecializedFoodWish('grillhaus fleischerei', {
    text: 'steak',
    hardness: 'must',
    kind: 'dish',
  }) === 1,
  'grillhaus is category-only for steak',
);"""
new_d = """assert(
  scoreSpecializedFoodWish('grillhaus', {
    text: 'steak',
    hardness: 'must',
    kind: 'dish',
  }) === 1,
  'grillhaus is category-only for steak',
);
assert(
  scoreSpecializedFoodWish('Beisser Steak und Grill Fleischerei', {
    text: 'steak',
    hardness: 'must',
    kind: 'dish',
  }) === 0,
  'metzgerei/fleischerei never steak dining',
);"""
if old_d not in dt:
    raise SystemExit("dining smoke old not found")
Path(r".cursor/_dining_smoke_new.ts").write_text(dt.replace(old_d, new_d, 1), encoding="utf-8")
print("dining smoke patched")
