from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\router\types.ts")
t = p.read_text(encoding="utf-8")
old = "import type { Module2ActionButton } from '../types';\nimport type { TurnFrame } from './turnFrame';"
new = "import type { Module2ActionButton } from '../types';\nimport type { Call1OrderTicket } from './call1OrderTicket';\nimport type { TurnFrame } from './turnFrame';"
if old not in t:
    raise SystemExit("import block not found")
t = t.replace(old, new, 1)
old2 = """  mustHaves?: string[];
  /**
   * Call-1 Ranking-Kriterien (key/role/weight) — keine Venue-Punkte.
   * Backend rankt Shortlist Top-5 danach.
   */
  criteria?: Array<{"""
new2 = """  mustHaves?: string[];
  /**
   * Order-Ticket SSOT — must/avoid/search/need/ui/bulletBudget.
   * Backend + Call 2 lesen nur das; Soft-Fill gegen must verboten.
   */
  order?: Call1OrderTicket;
  /**
   * Call-1 Ranking-Kriterien (key/role/weight) — keine Venue-Punkte.
   * Backend rankt Shortlist Top-5 danach.
   */
  criteria?: Array<{"""
if old2 not in t:
    raise SystemExit("mustHaves block not found")
t = t.replace(old2, new2, 1)
p.write_text(t, encoding="utf-8")
print("types.ts OK")
