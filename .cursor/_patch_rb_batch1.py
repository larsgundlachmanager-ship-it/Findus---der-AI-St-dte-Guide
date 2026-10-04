# noqa: multi-file reisebüro fixes
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")

# --- store: garbage + was war die Frage + origin hard keep ---
store = ROOT / "src/reisebuero/store.ts"
st = store.read_text(encoding="utf-8")
if "looksLikeGarbageFact" not in st:
    st = st.replace(
        "import { isBriefComplete } from './completeness';",
        "import { isBriefComplete } from './completeness';\n"
        "import { looksLikeGarbageFact, parseBriefSlots, applyAskedContext, applyLedgerCorrections } from './parseBriefSlots';",
    )
    # may already import parseBriefSlots elsewhere — check
if "from './parseBriefSlots'" in st and st.count("from './parseBriefSlots'") > 1:
    # clean duplicate — read imports
    pass

# Better: surgically insert after existing parseBriefSlots import
if "looksLikeGarbageFact" not in st.split("from './parseBriefSlots'")[0] + st.split("from './parseBriefSlots'")[1][:200]:
    st = st.replace(
        "parseBriefSlots",
        "parseBriefSlots, looksLikeGarbageFact",
        1,
    )
store.write_text(st, encoding="utf-8")
print("store import touch")
