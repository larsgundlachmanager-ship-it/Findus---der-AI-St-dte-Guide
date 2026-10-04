from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\pitchActions.ts")
s = p.read_text(encoding="utf-8")
old = """  // Immer mind. ein Link-Button (Speisekarte/Maps) — auch ohne etablierte Place-URL
  if (
    !actions.some((a) => a.type === 'OPEN_URL') &&
    Number.isFinite(opts.lat) &&
    Number.isFinite(opts.lng)
  ) {
"""
# find the return after this block - replace only the last return in buildPitchActions
# Use unique context near end of function before next export
marker = "  return actions.slice(0, 5);\n}\n\n"
# count
print('count', s.count('  return actions.slice(0, 5);\n}'))
# replace second occurrence in buildPitchActions - hotel returns early, final is the one before next function
parts = s.split('  return actions.slice(0, 5);\n}')
print('parts', len(parts))
# Keep hotel early return, change the main one
# Structure: hotel return, then main return, then maybe more
# Safer: replace specific trailing of buildPitchActions
idx = s.rfind('  return actions.slice(0, 5);\n}\n\nexport')
if idx < 0:
    idx = s.find('  return actions.slice(0, 5);\n}\n\nfunction')
if idx < 0:
    raise SystemExit('final return not found')
new_ret = """  try {
    const {
      prioritizeEvidenceButtons,
      dropGenericWebWhenEvidence,
    } = require('./evidenceButtons') as {
      prioritizeEvidenceButtons: <T>(a: T[], o?: { max?: number }) => T[];
      dropGenericWebWhenEvidence: <T>(a: T[]) => T[];
    };
    return prioritizeEvidenceButtons(dropGenericWebWhenEvidence(actions), {
      max: 5,
    });
  } catch {
    return actions.slice(0, 5);
  }
}

"""
# find exact end of buildPitchActions
end_marker_start = s.rfind('  return actions.slice(0, 5);', 0, s.find('function isEstablishedMapsAction') if 'function isEstablishedMapsAction' in s else len(s))
# Actually find return before isEstablishedMapsAction or next export after buildPitchActions
after_build = s.find('export function buildPitchActions')
# second return after after_build
first = s.find('  return actions.slice(0, 5);', after_build)
second = s.find('  return actions.slice(0, 5);', first + 1)
print('first', first, 'second', second)
if second < 0:
    raise SystemExit('second return missing')
s2 = s[:second] + """  try {
    const {
      prioritizeEvidenceButtons,
      dropGenericWebWhenEvidence,
    } = require('./evidenceButtons') as {
      prioritizeEvidenceButtons: <T>(a: T[], o?: { max?: number }) => T[];
      dropGenericWebWhenEvidence: <T>(a: T[]) => T[];
    };
    return prioritizeEvidenceButtons(dropGenericWebWhenEvidence(actions), {
      max: 5,
    });
  } catch {
    return actions.slice(0, 5);
  }""" + s[second + len('  return actions.slice(0, 5);'):]
tmp = p.with_suffix('.ts.patching')
tmp.write_text(s2, encoding='utf-8')
tmp.replace(p)
print('ok')
