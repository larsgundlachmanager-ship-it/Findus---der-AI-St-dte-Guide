from pathlib import Path

ROOT = Path(r"c:\\Users\\larsf\\Findus 2.0")

p = ROOT / 'src/screens/SettingsScreen.tsx'
t = p.read_text(encoding='utf-8')
if 'unstable_batchedUpdates' not in t[:5000]:
    t = t.replace("} from 'react-native';", "  unstable_batchedUpdates,\n} from 'react-native';", 1)
print('import-check'∞Äùunstable_batchedUpdates' in t[:5000])
tmp = p.with_suffix('.tsx.tmp')
tmp.write_text(t, encoding='utf-8')
tmp.replace(p)
print('Settings import OK')
