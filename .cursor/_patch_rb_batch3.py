from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\store.ts")
t = p.read_text(encoding="utf-8")
start = t.find("// Meta: Frage wiederholen")
end = t.find("if (looksLikeGarbageFact(t)", start)
if start < 0 or end < 0:
    raise SystemExit(f"markers {start} {end}")
new = """// Meta: Frage wiederholen — kein Slot-Schreiben
    if (/\\b(was\\s+war\\s+die\\s+frage|welche\\s+frage|nochmal\\s+die\\s+frage|hab(?:e)?\\s+(?:die\\s+)?frage\\s+vergessen)\\b/iu.test(t)) {
      const q =
        (trip.questionHint || '').trim() ||
        (lastAsk ? `Noch einmal zu ${lastAsk}` : '') ||
        'Sag kurz nochmal, worauf ich gerade hinauswollte';
      const turn: ChatTurn = { id: nid(), role: 'user', text: t, atMs: Date.now() };
      const speech = `Klar — die Frage war: ${q.replace(/\\?+$/, '')}?`;
      set({
        trip: {
          ...trip,
          chat: [
            ...trip.chat,
            turn,
            { id: nid(), role: 'assistant', text: speech, atMs: Date.now() },
          ],
          questionHint: q,
          updatedAtMs: Date.now(),
        },
      });
      return;
    }
    """
p.write_text(t[:start] + new + t[end:], encoding="utf-8")
print("store meta ok")

# TripStoryScroll diy reference
p = Path(r"c:\Users\larsf\Findus 2.0\src\components\reisebuero\TripStoryScroll.tsx")
t = p.read_text(encoding="utf-8")
if "const nights = ledger.stayNights" in t and "const diy =" not in t:
    t = t.replace(
        "  const nights = ledger.stayNights?.value ?? null;",
        "  const diy = !opt.packageBookUrl;\n  const nights = ledger.stayNights?.value ?? null;",
        1,
    )
# Filter booking checklist: one stay + flights, drop check24 without concrete package
old = """          {(opt.bookingChecklist ?? []).length ? (
            (opt.bookingChecklist as BookingCheckItem[]).map((item) => (
"""
new = """          {(() => {
            const raw = (opt.bookingChecklist ?? []) as BookingCheckItem[];
            const selectedStay = (opt.stays ?? []).find((s) => s.id === opt.selectedStayId) || (opt.stays ?? [])[0];
            const filtered = raw.filter((item) => {
              if (!item.url) return false;
              if (/check24|ab-in-den|pauschal/i.test(item.label) && !opt.packageBookUrl) return false;
              if (item.kind === 'stay' && selectedStay) {
                return item.label.includes(selectedStay.name.slice(0, 12)) || item.url === selectedStay.bookUrl;
              }
              return true;
            });
            const list = filtered.length ? filtered : raw.filter((i) => Boolean(i.url)).slice(0, 3);
            return list.length ? (
            list.map((item) => (
"""
if old in t:
    t = t.replace(old, new, 1)
    # close the IIFE - find the else after map
    old_close = """          ) : (
            <Text style={styles.muted}>Noch keine Buchungs-Links belegt.</Text>
          )}
"""
    new_close = """          ) : (
            <Text style={styles.muted}>Noch keine Buchungs-Links belegt.</Text>
          );
          })()}
"""
    if old_close in t:
        t = t.replace(old_close, new_close, 1)
    else:
        print("WARN close not found")
else:
    print("WARN book filter not applied")

# sticky: unter dem Strich wording
t = t.replace(
    "{diy ? 'Bei Partnern buchbar' : 'Pauschal vergleichen'}",
    "'Unter dem Strich'",
)
p.write_text(t, encoding="utf-8")
print("scroll ok")

# buildCoverHeadline — memorable title
p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\research\storyMagazine.ts")
t = p.read_text(encoding="utf-8")
# find function
idx = t.find("export function buildCoverHeadline")
print("headline at", idx)
snip = t[idx:idx+500]
print(snip[:400])
