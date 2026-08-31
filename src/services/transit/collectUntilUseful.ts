/**
 * Sobald der erste Provider Ergebnisse hat: kurze Gnade für den zweiten,
 * dann weiter — nicht auf lange Timeouts warten.
 */
export async function collectUntilUseful<T>(
  jobs: Array<Promise<T[]>>,
  opts: { graceMs: number; hardMs: number },
): Promise<T[]> {
  const bag: T[] = [];
  let remaining = jobs.length;
  let settled = false;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;

  return await new Promise((resolve) => {
    const finish = () => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      clearTimeout(hard);
      resolve(bag);
    };
    const hard = setTimeout(finish, Math.max(200, opts.hardMs));
    if (!jobs.length) {
      finish();
      return;
    }
    for (const job of jobs) {
      Promise.resolve(job)
        .then((rows) => {
          if (settled) return;
          if (Array.isArray(rows) && rows.length) bag.push(...rows);
          remaining -= 1;
          if (bag.length > 0 && !graceTimer) {
            graceTimer = setTimeout(finish, Math.max(0, opts.graceMs));
          }
          if (remaining === 0) finish();
        })
        .catch(() => {
          if (settled) return;
          remaining -= 1;
          if (remaining === 0) finish();
        });
    }
  });
}
