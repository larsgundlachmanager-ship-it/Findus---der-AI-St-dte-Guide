from pathlib import Path
import os

src = Path(r"c:\Users\larsf\Findus 2.0\src\screens\SettingsScreen.tsx")
tmp = Path(r"c:\Users\larsf\Findus 2.0\src\screens\SettingsScreen.tsx.new")
t = src.read_text(encoding="utf-8")
needle = "import { colors, spacing } from '../constants/theme';"
ins = needle + "\nimport { PackListsSettingsBlock } from '../components/settings/PackListsSettingsBlock';"
if "PackListsSettingsBlock" not in t:
    if needle not in t:
        raise SystemExit("import anchor missing")
    t = t.replace(needle, ins, 1)

marker = """                <Text style={styles.accordionTitle}>Yorros Reisebüro</Text>
                <Text style={styles.chevron}>▸</Text>
              </View>
            </Pressable>
            </SettingsSlot>"""
repl = """                <Text style={styles.accordionTitle}>Yorros Reisebüro</Text>
                <Text style={styles.chevron}>▸</Text>
              </View>
            </Pressable>
            <PackListsSettingsBlock />
            </SettingsSlot>"""
if "<PackListsSettingsBlock />" not in t:
    if marker not in t:
        raise SystemExit("reisebuero marker missing")
    t = t.replace(marker, repl, 1)

tmp.write_text(t, encoding="utf-8")
os.replace(tmp, src)
print("settings replaced")
