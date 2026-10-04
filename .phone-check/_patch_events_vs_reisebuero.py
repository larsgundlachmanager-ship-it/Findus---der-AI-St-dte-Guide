from pathlib import Path

p = Path(r"c:/Users/larsf/Findus 2.0/src/module2/router/call1Dispatch.ts")
t = p.read_text(encoding="utf-8")
old = """  try {
    const { detectCall1Situation } = require('../reboot/pipeline/call1AnswerContract') as {
      detectCall1Situation: (
        t: string,
        o?: { correction?: boolean },
      ) => string;
    };
    const family = detectCall1Situation(userText);
    if (family === 'reisebuero_collect') {
      return 'reisebuero';
    }
    if (family === 'stay_day_interactive') {
      const resolved = resolveCall1Execution(analysis);
      if (resolved === 'reisebuero' || resolved === 'chat_lane') {
        return 'plan_walkthrough';
      }
      return resolved;
    }
  } catch {
    /* soft */
  }
"""

new = """  try {
    const { detectCall1Situation } = require('../reboot/pipeline/call1AnswerContract') as {
      detectCall1Situation: (
        t: string,
        o?: { correction?: boolean },
      ) => string;
    };
    // Datum + Stadt + was geht/Events → events_research (nie Reisebüro)
    try {
      const { looksLikeDateWindowWhatsOnAsk } = require('../../services/concierge/eventDateWindow') as {
        looksLikeDateWindowWhatsOnAsk: (s: string) => boolean;
      };
      const { isEventResearchQuery } = require('../../services/concierge/eventResearchService') as {
        isEventResearchQuery: (s: string) => boolean;
      };
      if (
        looksLikeDateWindowWhatsOnAsk(userText) ||
        (isEventResearchQuery(userText) &&
          !/\\b(flug|fliegen|mietwagen|hotel\\s+suchen|plane\\s+mir|reisebüro|reisebuero)\\b/iu.test(
            userText,
          ))
      ) {
        return 'events_research';
      }
    } catch {
      /* soft */
    }
    const family = detectCall1Situation(userText);
    if (family === 'reisebuero_collect') {
      return 'reisebuero';
    }
    if (family === 'stay_day_interactive') {
      try {
        const { looksLikeDateWindowWhatsOnAsk } = require('../../services/concierge/eventDateWindow') as {
          looksLikeDateWindowWhatsOnAsk: (s: string) => boolean;
        };
        const { isEventResearchQuery } = require('../../services/concierge/eventResearchService') as {
          isEventResearchQuery: (s: string) => boolean;
        };
        if (
          looksLikeDateWindowWhatsOnAsk(userText) ||
          isEventResearchQuery(userText)
        ) {
          return 'events_research';
        }
      } catch {
        /* soft */
      }
      const resolved = resolveCall1Execution(analysis);
      if (resolved === 'reisebuero' || resolved === 'chat_lane') {
        return 'plan_walkthrough';
      }
      return resolved;
    }
  } catch {
    /* soft */
  }
"""

if old not in t:
    raise SystemExit("old block missing")
tmp = Path(r"c:/Users/larsf/Findus 2.0/.phone-check/_call1_dispatch_events.tmp.ts")
tmp.write_text(t.replace(old, new, 1), encoding="utf-8")
tmp.replace(p)
print("patched")
