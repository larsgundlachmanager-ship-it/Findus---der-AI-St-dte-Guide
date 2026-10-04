from pathlib import Path
import os

src = Path(r"c:\Users\larsf\Findus 2.0\src\services\logistics\logisticsGuardian.ts")
tmp = src.with_suffix(".ts.new")
t = src.read_text(encoding="utf-8")
old = """  if (!event || event.status !== 'active') return;

  // Reiner Wecker:"""
new = """  if (!event || event.status !== 'active') return;

  if (event.meta?.packRemind === true) {
    const listId = String(event.meta.packListId || '');
    const itemId = String(event.meta.packItemId || '');
    try {
      const { usePackListStore } = require('../../store/usePackListStore') as {
        usePackListStore: {
          getState: () => {
            getList: (id: string) => {
              items: Array<{ id: string; done: boolean }>;
            } | null;
          };
        };
      };
      const item = usePackListStore
        .getState()
        .getList(listId)
        ?.items.find((i) => i.id === itemId);
      if (item?.done) return;
    } catch {
      /* speak anyway */
    }
    const speech = (event.detail || trigger.title || '').trim();
    if (!speech) return;
    await presentConciergeResponse({
      speechText: speech,
      cardTitle: 'Packliste',
      visualBullets: [trigger.title],
      quickActions: [],
    });
    return;
  }

  // Reiner Wecker:"""
if old not in t:
    raise SystemExit("guardian anchor missing")
if "packRemind" not in t:
    t = t.replace(old, new, 1)
tmp.write_text(t, encoding="utf-8")
os.replace(tmp, src)
print("guardian ok")
