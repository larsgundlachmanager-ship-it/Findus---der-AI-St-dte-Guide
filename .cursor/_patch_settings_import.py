from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\screens\SettingsScreen.tsx")
text = p.read_text(encoding="utf-8")

old = """import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';"""

new = """import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  unstable_batchedUpdates,
} from 'react-native';"""

if "unstable_batchedUpdates," in text and "from 'react-native'" in text:
    # Check if already in the RN import block
    start = text.find("import {\n  ActivityIndicator")
    end = text.find("} from 'react-native';", start)
    block = text[start:end] if start >= 0 and end > start else ""
    if "unstable_batchedUpdates" in block:
        print("import already present")
    elif old in text:
        text2 = text.replace(old, new, 1)
        tmp = p.with_suffix(".tsx.tmp")
        tmp.write_text(text2, encoding="utf-8")
        tmp.replace(p)
        print("import patched ok")
    else:
        raise SystemExit("cannot locate RN import block to patch")
elif old in text:
    text2 = text.replace(old, new, 1)
    tmp = p.with_suffix(".tsx.tmp")
    tmp.write_text(text2, encoding="utf-8")
    tmp.replace(p)
    print("import patched ok")
else:
    raise SystemExit("OLD IMPORT BLOCK NOT FOUND and no existing import")

t = p.read_text(encoding="utf-8")
assert "unstable_batchedUpdates" in t
assert "Ein Batch" in t
assert "Mute/Prefetch nach Paint" in t
# hydrateMuteSession should be inside rAF
raf = t.find("requestAnimationFrame(() => {")
hyd = t.find("void hydrateMuteSession()")
assert raf >= 0 and hyd > raf, "hydrateMuteSession must be inside rAF"
print("settings verify ok")
