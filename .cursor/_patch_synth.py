from pathlib import Path

# --- synthesizeReboot: order block + skip parallel answer contract ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\reboot\synthesizeReboot.ts")
t = p.read_text(encoding="utf-8")

old_opts = '''  /** Voller Task-Brief-Block für Call 2. */
  call1TaskBriefBlock?: string | null;
}): Promise<SynthesisPayload> {'''
new_opts = '''  /** Voller Task-Brief-Block für Call 2. */
  call1TaskBriefBlock?: string | null;
  /** Call-1 Order-Ticket (must/avoid/search/need/ui/bullets). */
  call1OrderBlock?: string | null;
  /** Stichpunkt-Budget aus Call-1 Order. */
  bulletBudgetMax?: number | null;
}): Promise<SynthesisPayload> {'''
if old_opts not in t:
    raise SystemExit("synth opts not found")
t = t.replace(old_opts, new_opts, 1)

old_fin = '''      bullets: humanizeBullets(bulletsIn, 3),'''
new_fin = '''      bullets: humanizeBullets(bulletsIn, opts.bulletBudgetMax ?? 3),'''
if old_fin not in t:
    raise SystemExit("humanizeBullets not found")
t = t.replace(old_fin, new_fin, 1)

old_bb = '''    opts.rucksack
      ? `BULLET_BUDGET: 3 × max ${opts.rucksack.ui.bulletMaxChars} Zeichen`
      : '','''
new_bb = '''    opts.call1OrderBlock?.trim() || '',
    opts.rucksack
      ? `BULLET_BUDGET: ${opts.bulletBudgetMax ?? 3} × max ${opts.rucksack.ui.bulletMaxChars} Zeichen — Call 2 schreibt Stichpunkte, keine Meta-Chips`
      : opts.bulletBudgetMax
        ? `BULLET_BUDGET: max ${opts.bulletBudgetMax}`
        : '','''
if old_bb not in t:
    raise SystemExit("BULLET_BUDGET not found")
t = t.replace(old_bb, new_bb, 1)

old_ac = '''    (() => {
      try {
        const {
          getCall1AnswerContract,
          formatCall1AnswerContractForPrompt,
        } = require('./pipeline/call1AnswerContract') as {
          getCall1AnswerContract: (t: string, o?: { correction?: boolean }) => unknown;
          formatCall1AnswerContractForPrompt: (c: unknown) => string;
        };
        const reject =
          /\\b(mag\\s+ich\\s+nicht|gefällt\\s+mir\\s+nicht|gefaellt\\s+mir\\s+nicht|nee|nö|nein|was\\s+noch|andere)\\b/iu.test(
            opts.userText,
          );
        return formatCall1AnswerContractForPrompt(
          getCall1AnswerContract(opts.userText, { correction: reject }),
        );
      } catch {
        return '';
      }
    })(),'''
new_ac = '''    // Call-1 Brief/Order schlägt paralleles AnswerContract-Re-Detect
    (() => {
      if (opts.call2Brief?.trim() || opts.call1OrderBlock?.trim()) return '';
      try {
        const {
          getCall1AnswerContract,
          formatCall1AnswerContractForPrompt,
        } = require('./pipeline/call1AnswerContract') as {
          getCall1AnswerContract: (t: string, o?: { correction?: boolean }) => unknown;
          formatCall1AnswerContractForPrompt: (c: unknown) => string;
        };
        const reject =
          /\\b(mag\\s+ich\\s+nicht|gefällt\\s+mir\\s+nicht|gefaellt\\s+mir\\s+nicht|nee|nö|nein|was\\s+noch|andere)\\b/iu.test(
            opts.userText,
          );
        return formatCall1AnswerContractForPrompt(
          getCall1AnswerContract(opts.userText, { correction: reject }),
        );
      } catch {
        return '';
      }
    })(),'''
if old_ac not in t:
    raise SystemExit("answer contract block not found")
t = t.replace(old_ac, new_ac, 1)

p.write_text(t, encoding="utf-8")
print("synthesizeReboot.ts OK")
