from pathlib import Path

root = Path(r"c:\Users\larsf\Findus 2.0")

bg = root / "src/services/concierge/backgroundTasks.ts"
t = bg.read_text(encoding="utf-8")
old = "      quickActions: actions,\n    },\n    alarmResults,"
new = """      quickActions: actions,
      cardTitle:
        alarmResults.some((r) => r.ok) && response.cardTitle !== 'Timer'
          ? 'Wecker'
          : response.cardTitle,
    },
    alarmResults,"""
if old not in t:
    raise SystemExit("backgroundTasks pattern missing")
bg.write_text(t.replace(old, new, 1), encoding="utf-8")

bul = root / "src/components/liveStage/BulletsSlot.tsx"
t2 = bul.read_text(encoding="utf-8")
old2 = """            <Text style={styles.title} numberOfLines={1}>
              {card.cardTitle?.trim() || 'Spickzettel'}
            </Text>"""
new2 = """            <Text style={styles.title} numberOfLines={1}>
              {(() => {
                const raw = card.cardTitle?.trim() ?? '';
                if (!raw || /^[\\[\\]{}]+$/u.test(raw)) return 'Spickzettel';
                return raw;
              })()}
            </Text>"""
if old2 not in t2:
    raise SystemExit("BulletsSlot pattern missing")
bul.write_text(t2.replace(old2, new2, 1), encoding="utf-8")
print("patched ok")
