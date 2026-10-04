from pathlib import Path
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\router\analyzeTurn.ts")
t = p.read_text(encoding="utf-8")

# Inject toolbox after think frame
old = '''    require('./call1ThinkFrame').FINDUS_CALL1_THINK_FRAME as string,
    require('./call1OpenWorldContract').FINDUS_CALL1_OPEN_WORLD_BLOCK as string,'''
new = '''    require('./call1ThinkFrame').FINDUS_CALL1_THINK_FRAME as string,
    require('./call1OrderTicket').FINDUS_CALL1_TOOLBOX_BLOCK as string,
    require('./call1OpenWorldContract').FINDUS_CALL1_OPEN_WORLD_BLOCK as string,'''
if old not in t:
    raise SystemExit("think frame inject not found")
t = t.replace(old, new, 1)

# Add order fields after mustHaves line
old_fields = '''    '- mustHaves: Hard-Filter aus DIESEM Satz (max 8) — keine erfundenen Orte',
    '- criteria: Array {key, role: must|nice|soft, weight: 1-30} — du setzt Prioritäten zur Frage. Keine Venue-Namen/Punkte. Shortlist Top-5 → Speak Top-2.','''
new_fields = '''    '- mustHaves: Hard-Filter aus DIESEM Satz (max 8) — Legacy; bevorzugt order.must',
    '- order: { must:[], avoid:[], search:{mode:hard|normal,stages,maxRadiusKm,forbidSoftFill}, need:{menuUrl,prices,openHours,eta,maps,ticket,bookingLink}, ui:{openPitch,startNav,openTimeline,openCalendar,delayMs?}, bulletBudget:{max,maxLines,maxChars} } — SSOT für Backend+Call2. Soft-Fill gegen must VERBOTEN.',
    '- criteria: Array {key, role: must|nice|soft, weight: 1-30} — du setzt Prioritäten zur Frage. Keine Venue-Namen/Punkte. Shortlist Top-5 → Speak Top-2.','''
if old_fields not in t:
    raise SystemExit("mustHaves fields not found")
t = t.replace(old_fields, new_fields, 1)

# Remove topicCut override that fights Call-1 session SSOT
old_cut = '''    // Compound / topicCut: neues Thema → keine Chat-Historie (Call1-Vertrag)
    try {
      const { getCall1AnswerContract } = require('../reboot/pipeline/call1AnswerContract') as {
        getCall1AnswerContract: (t: string) => { topicCut: boolean };
      };
      if (getCall1AnswerContract(userText).topicCut) {
        topicScope = {
          mode: 'new',
          turnsForCall2: 0,
          inheritLiveInventory: false,
        };
        session = 'new';
        threadMatchId = null;
      }
    } catch {
      /* soft */
    }
    // Call-1 LLM ist SSOT für session/topicScope — kein Keyword-Override danach.
    // Manager-LLM entscheidet session selbst — keine Heuristik-Überschreibung.'''
new_cut = '''    // Call-1 LLM ist SSOT für session/topicScope — kein Keyword-/AnswerContract-Override.
    // (Früher: getCall1AnswerContract.topicCut überschrieb continue — dem Plan entgegen.)'''
if old_cut not in t:
    raise SystemExit("topicCut block not found")
t = t.replace(old_cut, new_cut, 1)

# Parse order ticket before return attachTurnFrame — inject after authorIntent
old_auth = '''    const needsBlockingChoice = parsed.needsBlockingChoice === true;
    const authorIntent =
      typeof parsed.authorIntent === 'string' && parsed.authorIntent.trim()
        ? parsed.authorIntent.trim().slice(0, 200)
        : null;

    let session = asSession(parsed.session);'''
new_auth = '''    const needsBlockingChoice = parsed.needsBlockingChoice === true;
    const authorIntent =
      typeof parsed.authorIntent === 'string' && parsed.authorIntent.trim()
        ? parsed.authorIntent.trim().slice(0, 200)
        : null;

    let order: import('./call1OrderTicket').Call1OrderTicket | undefined;
    let mustHavesResolved = mustHaves;
    try {
      const {
        parseCall1OrderTicket,
        orderTicketToMustHaves,
      } = require('./call1OrderTicket') as {
        parseCall1OrderTicket: (
          p: Record<string, unknown>,
          o?: { mustHaves?: string[] | null; criteria?: ManagerAnalysis['criteria'] },
        ) => import('./call1OrderTicket').Call1OrderTicket;
        orderTicketToMustHaves: (t: import('./call1OrderTicket').Call1OrderTicket) => string[];
      };
      order = parseCall1OrderTicket(parsed as Record<string, unknown>, {
        mustHaves,
        criteria,
      });
      const fromOrder = orderTicketToMustHaves(order);
      if (fromOrder.length) {
        mustHavesResolved = fromOrder.slice(0, 8);
      }
    } catch {
      order = undefined;
    }

    let session = asSession(parsed.session);'''
if old_auth not in t:
    raise SystemExit("authorIntent block not found")
t = t.replace(old_auth, new_auth, 1)

# Fix return to use mustHavesResolved + order
old_ret = '''        festTypeHint,
        bookingPlatformHint,
        mustHaves,
        criteria,
        needsBlockingChoice,
        authorIntent,
      },'''
new_ret = '''        festTypeHint,
        bookingPlatformHint,
        mustHaves: mustHavesResolved,
        order,
        criteria,
        needsBlockingChoice,
        authorIntent,
      },'''
if old_ret not in t:
    raise SystemExit("return mustHaves block not found")
t = t.replace(old_ret, new_ret, 1)

p.write_text(t, encoding="utf-8")
print("analyzeTurn.ts OK")
