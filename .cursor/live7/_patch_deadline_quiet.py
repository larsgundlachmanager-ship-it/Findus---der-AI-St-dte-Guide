from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\planning\tickDeadlineWatcher.ts")
text = p.read_text(encoding="utf-8")

old = """export async function tickDeadlineWatcher(): Promise<void> {
  const now = Date.now();
  if (now - lastTickMs < TICK_GAP_MS) return;
  lastTickMs = now;
  if (firing) return;"""

new = """export async function tickDeadlineWatcher(): Promise<void> {
  const now = Date.now();
  if (now - lastTickMs < TICK_GAP_MS) return;
  try {
    const { isOpenQuietActive } = require('../navigation/modulePriorityPolicy') as {
      isOpenQuietActive: (n?: number) => boolean;
    };
    if (isOpenQuietActive(now)) return;
  } catch {
    /* soft */
  }
  lastTickMs = now;
  if (firing) return;"""

if "isOpenQuietActive" in text and "tickDeadlineWatcher" in text:
    # may already be patched
    if "Open Quiet" in text or "isOpenQuietActive(now)" in text:
        print("deadline already patched")
    elif old not in text:
        raise SystemExit("pattern not found")
    else:
        text = text.replace(old, new, 1)
        p.write_text(text, encoding="utf-8")
        print("deadline patched")
else:
    if old not in text:
        raise SystemExit("pattern not found")
    text = text.replace(old, new, 1)
    p.write_text(text, encoding="utf-8")
    print("deadline patched")
