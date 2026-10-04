/**
 * Gigsberg API smoke — braucht GIGSBERG_API_KEY in .env (kein RN-Import).
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/affiliate/gigsbergAffiliate.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const k = m[1]!;
    let v = m[2]!.trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] == null) process.env[k] = v;
  }
}

const KEY = String(
  process.env.GIGSBERG_API_KEY || process.env.EXPO_PUBLIC_GIGSBERG_API_KEY || '',
).trim();
assert.ok(KEY.length >= 8, 'GIGSBERG_API_KEY fehlt in .env');

async function main(): Promise<void> {
  const url =
    'https://integration2.gigsberg.com/v2/event/search?city=Hamburg&country=Germany&per_page=3&sort_by=date';
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'x-api-key': KEY },
  });
  assert.equal(res.status, 200, `HTTP ${res.status}`);
  const data = (await res.json()) as {
    items?: Array<{ name?: string; url?: string; venue?: string }>;
  };
  assert.ok(Array.isArray(data.items) && data.items.length >= 1, 'keine items');
  const first = data.items[0]!;
  assert.ok(first.name && first.url, 'item unvollständig');
  assert.match(String(first.url), /aff=Yorro|gigsberg/i);

  console.log(
    'gigsbergAffiliate.smoke.test.ts: ok',
    first.name,
    first.venue || '',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
