# -*- coding: utf-8 -*-
from pathlib import Path

# hollow test assertions
test_path = Path(r"c:\Users\larsf\Findus 2.0\src\services\affiliate\hollowPartnerUrl.test.ts")
t = test_path.read_text(encoding="utf-8")
needle = "assert(isHollowPartnerUrl('https://www.stay22.com/'), 'stay22 home');\n"
insert = """assert(isHollowPartnerUrl('https://www.stay22.com/'), 'stay22 home');
assert(isHollowPartnerUrl('https://www.airbnb.de/'), 'airbnb home');
assert(isHollowPartnerUrl('https://www.airbnb.com/'), 'airbnb.com home');
assert(
  !isHollowPartnerUrl('https://www.airbnb.de/s/Berlin/homes?checkin=2026-08-01'),
  'airbnb search',
);
assert(
  !isHollowPartnerUrl('https://www.airbnb.de/rooms/12345'),
  'airbnb rooms',
);
"""
if "airbnb home" not in t:
    if needle not in t:
        raise SystemExit("needle not found in hollow test")
    t = t.replace(needle, insert, 1)
    tmp = test_path.with_suffix(".ts.tmp")
    tmp.write_text(t, encoding="utf-8")
    tmp.replace(test_path)
    print("hollow test patched")
else:
    print("hollow test already has airbnb")

# soften label
hp = Path(r"c:\Users\larsf\Findus 2.0\src\services\affiliate\hollowPartnerUrl.ts")
h = hp.read_text(encoding="utf-8")
old = """  if (/expedia|stay22|booking\\.com|hotels\\.com|vrbo/i.test(blob)) {
    label = '🏨 Hotels suchen';
  } else if (/getyourguide|tiqets|musement|viator|klook|kkday/i.test(blob)) {"""
new = """  if (/expedia|stay22|booking\\.com|hotels\\.com|vrbo/i.test(blob)) {
    label = '🏨 Hotels suchen';
  } else if (/airbnb\\./i.test(blob)) {
    label = '🔑 Airbnb suchen';
  } else if (/getyourguide|tiqets|musement|viator|klook|kkday/i.test(blob)) {"""
if "Airbnb suchen" not in h:
    if old not in h:
        raise SystemExit("soften old not found")
    h = h.replace(old, new, 1)
    tmp2 = hp.with_suffix(".ts.tmp")
    tmp2.write_text(h, encoding="utf-8")
    tmp2.replace(hp)
    print("soften patched")
else:
    print("soften already patched")
