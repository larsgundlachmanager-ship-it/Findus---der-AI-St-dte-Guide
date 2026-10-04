from pathlib import Path

src = Path(r"C:\Users\larsf\Findus 2.0\src\constants\onboardingOptions.ts")
tmp = Path(r"C:\Users\larsf\Findus 2.0\src\constants\onboardingOptions.ts.new")
ot = src.read_text(encoding="utf-8")
ot2 = ot.replace(
    "    yesLabelDe: 'Zeig mir',\n    yesLabelEn: 'Show me',\n    midLabelDe: 'Gerne',\n    midLabelEn: 'Gladly',\n  },\n  {\n    id: 'barriere_care',",
    "    yesLabelDe: 'Zeig mir',\n    yesLabelEn: 'Show me',\n  },\n  {\n    id: 'barriere_care',",
)
for a, b in [
    ("emoji: '🥳',\n        labelDe: 'Partyurlaub'", "emoji: '🎉',\n        labelDe: 'Partyurlaub'"),
    ("emoji: '🏖️',\n        labelDe: 'Urlaub'", "emoji: '🏖',\n        labelDe: 'Urlaub'"),
    ("emoji: '✈️',\n        labelDe: 'Kurztrip'", "emoji: '✈',\n        labelDe: 'Kurztrip'"),
    ("emoji: '🗓️',\n        labelDe: 'Wochenendtrip'", "emoji: '📅',\n        labelDe: 'Wochenendtrip'"),
]:
    ot2 = ot2.replace(a, b)
tmp.write_text(ot2, encoding="utf-8")
print("wrote", tmp, "changed", ot2 != ot)
