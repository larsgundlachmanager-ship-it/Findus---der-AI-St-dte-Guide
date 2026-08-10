/**
 * Nach der Onboarding-Erklärung: gewählter Hilfe-Chip → echte Recherche auf dem Home-Screen.
 */

let pending: string | null = null;

export function queuePostTourQuestion(prompt: string): void {
  const q = prompt.trim();
  pending = q.length > 0 ? q : null;
}

export function peekPostTourQuestion(): string | null {
  return pending;
}

export function takePostTourQuestion(): string | null {
  const q = pending;
  pending = null;
  return q;
}

export function clearPostTourQuestion(): void {
  pending = null;
}
