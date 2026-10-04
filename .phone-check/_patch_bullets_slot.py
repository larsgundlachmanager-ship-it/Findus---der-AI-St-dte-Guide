import pathlib

p = pathlib.Path(r"c:\Users\larsf\Findus 2.0\src\components\liveStage\BulletsSlot.tsx")
text = p.read_text(encoding="utf-8")
old = "{card.cardTitle?.trim() || 'Spickzettel'}"
new = """{(() => {
                const raw = card.cardTitle?.trim() ?? '';
                if (!raw || /^[\\[\\]{}]+$/u.test(raw)) {
                  const wake = card.visualBullets?.some((b) =>
                    /\\bwecker\\b|⏰/iu.test(b),
                  );
                  return wake ? 'Wecker' : 'Spickzettel';
                }
                return raw;
              })()}"""
if old not in text:
    raise SystemExit("OLD NOT FOUND")
p.write_text(text.replace(old, new, 1), encoding="utf-8")
print("OK")
