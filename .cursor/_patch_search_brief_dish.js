const fs = require('fs');
const p = 'src/module2/pitch/searchBrief.ts';
let s = fs.readFileSync(p, 'utf8');
if (s.includes('diningDishNeedFromText')) {
  console.log('already patched');
  process.exit(0);
}
const needle = `  const fromText = parseWishesFromText(opts.userText);
  let wishes = mergeWishLists(
    mergeWishLists(opts.baseWishes, fromText),
    mergeWishLists(fromCall1, fromCriteria),
  );
  // Call-1-Gewichte auf bestehende Wishes spiegeln`;
const insert = `  const fromText = parseWishesFromText(opts.userText);
  let wishes = mergeWishLists(
    mergeWishLists(opts.baseWishes, fromText),
    mergeWishLists(fromCall1, fromCriteria),
  );
  // P9: Dish-Need aus Specialty/Craving → must wish
  try {
    const { diningDishNeedFromText } = require('./diningHarden') as {
      diningDishNeedFromText: (s: string) => string | null;
    };
    const dish = diningDishNeedFromText(opts.userText);
    if (
      dish &&
      (opts.kind === 'food' || opts.kind === 'bar') &&
      !wishes.some((w) => w.text.toLowerCase() === dish.toLowerCase())
    ) {
      wishes = [
        ...wishes,
        {
          kind: 'dish',
          text: dish,
          hardness: 'must',
          weight: 24,
        },
      ];
    }
  } catch {
    /* soft */
  }
  // Call-1-Gewichte auf bestehende Wishes spiegeln`;
if (!s.includes(needle)) {
  console.error('needle missing');
  process.exit(1);
}
fs.writeFileSync(p, s.replace(needle, insert));
console.log('patched searchBrief');
