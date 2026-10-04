from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\pitchSpeech.ts")
s = p.read_text(encoding="utf-8")

helper = '''
function fitPitchBullets(raw: string[]): string[] {
  let maxChars = 56;
  let maxCount = 3;
  try {
    const { peekBulletUiBudget } = require('../reboot/pipeline/bulletUiBudget') as {
      peekBulletUiBudget: () => { bulletMaxChars: number; bulletCount: number };
    };
    const b = peekBulletUiBudget();
    maxChars = b.bulletMaxChars || 56;
    maxCount = b.bulletCount || 3;
  } catch {
    /* soft */
  }
  try {
    const { rewriteBulletToFit } = require('../../services/concierge/visualBullets') as {
      rewriteBulletToFit: (t: string, max: number) => string;
    };
    return raw
      .map((t) => rewriteBulletToFit(String(t || '').trim(), maxChars))
      .filter(Boolean)
      .slice(0, maxCount);
  } catch {
    return raw.map((t) => String(t || '').trim().slice(0, maxChars)).filter(Boolean).slice(0, maxCount);
  }
}
'''

if 'function fitPitchBullets' not in s:
    # insert before first export or after imports - find a good spot
    marker = '/** Zwei Optionen: erste Stichpunkte sollen sich unterscheiden (Entscheidungshilfe). */'
    if marker not in s:
        raise SystemExit('marker missing')
    s = s.replace(marker, helper + '\n' + marker, 1)

# replace .slice(0, 3) as string[] return bullets
old1 = '''    .slice(0, 3) as string[];
  return { speechPitch: withLook, bullets };
}'''
new1 = '''    .slice(0, 6) as string[];
  return { speechPitch: withLook, bullets: fitPitchBullets(bullets) };
}'''
if old1 not in s:
    raise SystemExit('old1 missing')
s = s.replace(old1, new1, 1)

old2 = '''          .filter((b, i, arr) => arr.indexOf(b) === i)
          .slice(0, 3);
        next.push({ candidate: c, speechPitch: speech, bullets });'''
new2 = '''          .filter((b, i, arr) => arr.indexOf(b) === i)
          .slice(0, 6);
        next.push({
          candidate: c,
          speechPitch: speech,
          bullets: fitPitchBullets(bullets),
        });'''
if old2 not in s:
    raise SystemExit('old2 missing')
s = s.replace(old2, new2, 1)

tmp = p.with_suffix('.ts.patching')
tmp.write_text(s, encoding='utf-8')
tmp.replace(p)
print('pitchSpeech ok')
