from pathlib import Path

# store methods
p = Path(r"c:\Users\larsf\Findus 2.0\src\store\usePackListStore.ts")
t = p.read_text(encoding="utf-8")
old = """  upsertList: (list: PackList) => void;
  toggleItem: (listId: string, itemId: string) => void;
  openOverlay: (listId?: string | null) => void;"""
new = """  upsertList: (list: PackList) => void;
  toggleItem: (listId: string, itemId: string) => void;
  addItems: (listId: string, items: PackListItem[]) => void;
  removeMatching: (listId: string, query: string) => string[];
  setItemDone: (listId: string, query: string, done: boolean) => string | null;
  deleteList: (listId: string) => void;
  openOverlay: (listId?: string | null) => void;"""
if old not in t:
    raise SystemExit("store type missing")
t = t.replace(old, new, 1)

impl = '''
  addItems: (listId, items) => {
    if (!items.length) return;
    set((s) => {
      const lists = s.lists.map((l) => {
        if (l.id !== listId) return l;
        const seen = new Set(l.items.map((it) => it.label.toLowerCase()));
        const extra = items.filter((it) => !seen.has(it.label.toLowerCase()));
        return { ...l, items: [...l.items, ...extra] };
      });
      void persist(lists);
      return { lists };
    });
  },

  removeMatching: (listId, query) => {
    const q = query.toLowerCase().trim();
    const removed: string[] = [];
    set((s) => {
      const lists = s.lists.map((l) => {
        if (l.id !== listId) return l;
        const keep = l.items.filter((it) => {
          const hit =
            q &&
            (it.label.toLowerCase().includes(q) ||
              q.includes(it.label.toLowerCase().replace(/^\\d+×\\s*/u, '')));
          if (hit) removed.push(it.label);
          return !hit;
        });
        return { ...l, items: keep };
      });
      void persist(lists);
      return { lists };
    });
    return removed;
  },

  setItemDone: (listId, query, done) => {
    const q = query.toLowerCase().trim();
    let hitLabel: string | null = null;
    set((s) => {
      const lists = s.lists.map((l) => {
        if (l.id !== listId) return l;
        return {
          ...l,
          items: l.items.map((it) => {
            const match =
              q &&
              (it.label.toLowerCase().includes(q) ||
                it.label.toLowerCase().replace(/^\\d+×\\s*/u, '').includes(q));
            if (match && !hitLabel) {
              hitLabel = it.label;
              return { ...it, done };
            }
            return it;
          }),
        };
      });
      void persist(lists);
      return { lists };
    });
    return hitLabel;
  },

  deleteList: (listId) => {
    set((s) => {
      const lists = s.lists.filter((l) => l.id !== listId);
      void persist(lists);
      const activeListId = s.activeListId === listId ? lists.at(-1)?.id ?? null : s.activeListId;
      return { lists, activeListId };
    });
  },

'''
anchor = "  toggleItem: (listId, itemId) => {"
if "addItems:" not in t:
    if anchor not in t:
        raise SystemExit("toggle impl missing")
    t = t.replace(anchor, impl + anchor, 1)
p.write_text(t, encoding="utf-8")
print("store OK")
