const fs = require('fs');
const p = 'src/module2/pitch/wishFilterRank.ts';
let s = fs.readFileSync(p, 'utf8');
const a = `        const { isCrediblePizzaVenue } = require('./pizzaVenueGate') as {
          isCrediblePizzaVenue: (b: string) => boolean;
        };
        return isCrediblePizzaVenue(blob);`;
const b = `        const { isCrediblePizzaVenue } = require('./pizzaVenueGate') as {
          isCrediblePizzaVenue: (b: string, name?: string) => boolean;
        };
        return isCrediblePizzaVenue(blob, c.name);`;
if (!s.includes(a)) {
  console.error('NO_MATCH');
  process.exit(1);
}
fs.writeFileSync(p, s.replace(a, b));
console.log('OK');
