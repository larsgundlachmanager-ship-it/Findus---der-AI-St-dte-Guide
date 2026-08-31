/**
 * Echte Gabel: max 2 Optionen. Tap erbt Inventar (kein neues Search).
 */

export type ForkChoice = {
  id: string;
  label: string;
  inventory?: Record<string, string | number | boolean | null>;
};

export type OptionFork = {
  question: string;
  choices: [ForkChoice, ForkChoice];
  shortAnswers: true;
};

export function buildOptionFork(
  question: string,
  a: ForkChoice,
  b: ForkChoice,
): OptionFork {
  return {
    question,
    choices: [
      { id: a.id, label: a.label.slice(0, 28), inventory: a.inventory },
      { id: b.id, label: b.label.slice(0, 28), inventory: b.inventory },
    ],
    shortAnswers: true,
  };
}

export function inheritInventoryOnTap(
  fork: OptionFork,
  selectedId: string,
): ForkChoice | null {
  const hit = fork.choices.find((c) => c.id === selectedId);
  return hit ?? null;
}

export function isTrueForkNotPermission(question: string): boolean {
  return !/\b(soll\s+ich|darf\s+ich\s+suchen|soll\s+ich\s+(?:mal\s+)?(?:schauen|suchen))\b/iu.test(
    question,
  );
}
