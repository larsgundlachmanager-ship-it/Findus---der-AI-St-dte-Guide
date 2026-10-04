from pathlib import Path
p = Path('src/services/discovery/cityExploreProgress.ts')
s = p.read_text(encoding='utf-8')
s2 = s.replace('return poiSpotKeyMatchesCity(p, cityId);', 'return spotKeyBelongsToCity(p.spot_key, cityId);')
# also remove dead lowercasing on key if unused - keep as is
if s2 == s:
    raise SystemExit('no change - check file')
tmp = Path('.cursor/_fix_explore_call.ts')
tmp.write_text(s2, encoding='utf-8')
tmp.replace(p)
print('fixed call')
