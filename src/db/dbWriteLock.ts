/**
 * Global SQLite write serialization (expo-sqlite nested-tx / lock guard).
 * Chain lives on globalThis so Fast Refresh does not start a parallel writer.
 */

type FindusWriteGlobal = typeof globalThis & {
  __findusDbWriteChain?: Promise<unknown>;
};

const g = globalThis as FindusWriteGlobal;

function getWriteChain(): Promise<unknown> {
  return g.__findusDbWriteChain ?? Promise.resolve();
}

function setWriteChain(p: Promise<unknown>): void {
  g.__findusDbWriteChain = p;
}

function isDbLockedError(err: unknown): boolean {
  const msg = String(err ?? '');
  return /database is locked|finalizeAsync|SQLITE_BUSY|Error code 5/i.test(msg);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function runWithBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isDbLockedError(err) || attempt === 4) throw err;
      await sleep(40 * (attempt + 1) * (attempt + 1));
    }
  }
  throw last;
}

/** Serializes writers; retries briefly on SQLITE_BUSY. */
export function runExclusiveDbWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = getWriteChain().then(
    () => runWithBusyRetry(fn),
    () => runWithBusyRetry(fn),
  );
  setWriteChain(
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
