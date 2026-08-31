/** Names roughly equal for speech↔button invariant. */
export function namesAlign(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/^📍\s*/u, '')
      .replace(/^route:\s*/iu, '')
      .replace(/^route\s+zu\s+/iu, '')
      .replace(/^restaurant\s+/iu, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}
