const fs = require('fs');
const p = 'src/services/research/activitySportResearch.ts';
let s = fs.readFileSync(p, 'utf8');
if (s.includes("promptBlock: 'ACTIVITY_SPORT empty',\n    activityFit: false,\n    alternativeOffered: false,\n    priceEur: null,")) {
  console.log('already ok');
  process.exit(0);
}
const a = `    promptBlock: 'ACTIVITY_SPORT empty',
    activityFit: false,
    alternativeOffered: false,
  };
}`;
const b = `    promptBlock: 'ACTIVITY_SPORT empty',
    activityFit: false,
    alternativeOffered: false,
    priceEur: null,
  };
}`;
if (!s.includes(a)) {
  console.error('NO_MATCH');
  process.exit(1);
}
fs.writeFileSync(p, s.replace(a, b));
console.log('OK');
