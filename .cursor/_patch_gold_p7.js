const fs = require('fs');
const p = 'src/module2/blueprints/ownerGold.pack.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const situations = j.situations || j;
const list = Array.isArray(situations) ? situations : situations.situations || [];
const keys = new Set(list.map((x) => x.situationKey).filter(Boolean));
const add = [];
if (!keys.has('dining::dish_verify_need_v1')) {
  add.push({
    intentFamily: 'dining',
    situationKey: 'dining::dish_verify_need_v1',
    tags: ['dining', 'dish', 'specialty', 'menu', 'dish_verify'],
    expect: ['concrete_place', 'menu', 'prices', 'answer_first', 'route_button'],
    avoid: ['vague_filler', 'permission_questions', 'long_history', 'fake_promises'],
    summary:
      'Gericht/Need-Ask: Speisekarte/Preis belegen wenn möglich, Open-now beachten, Tourist-Trap nicht bevorzugen; Route + Speisekarte-Button nur mit URL.',
  });
}
if (!keys.has('dining::budget_per_person_v1')) {
  add.push({
    intentFamily: 'dining',
    situationKey: 'dining::budget_per_person_v1',
    tags: ['dining', 'budget', 'price'],
    expect: ['prices', 'concrete_place', 'answer_first', 'alternatives'],
    avoid: ['vague_filler', 'permission_questions', 'fake_promises'],
    summary:
      'Budget pro Person genannt: zuerst Optionen im Rahmen, Soft-Replan wenn nichts passt — ehrlich, keine erfundenen Preise.',
  });
}
if (!keys.has('general::weather_rain_vs_info_v1')) {
  add.push({
    intentFamily: 'general',
    situationKey: 'general::weather_rain_vs_info_v1',
    tags: ['weather', 'rain', 'weather_rain', 'weather_info'],
    expect: ['rain_timing', 'answer_first', 'casual_tone'],
    avoid: ['clothing_tip', 'dry_list', 'permission_questions', 'nav_auto_start'],
    summary:
      'Regen-Frage vs. allgemeine Wetter-Info: Regen-Timing zuerst; Outfit nur bei Anziehen-Frage. Keine Touren-Buttons.',
  });
}
if (!add.length) {
  console.log('gold already has P7 keys');
  process.exit(0);
}
if (Array.isArray(j.situations)) {
  j.situations.push(...add);
} else if (Array.isArray(j)) {
  j.push(...add);
} else {
  console.error('unknown gold shape');
  process.exit(1);
}
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
console.log('added', add.map((a) => a.situationKey).join(', '));
