const q = `[out:json][timeout:25];
(
  way(around:150,53.6752,9.7602)[building];
  way(around:180,53.6752,9.7602)[railway];
  node(around:150,53.6752,9.7602)[historic];
  way(around:150,53.6752,9.7602)[historic];
);
out tags geom;`;

async function main() {
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(q)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const j = await r.json();
  for (const e of j.elements || []) {
    const t = e.tags || {};
    const name = t.name || t['name:de'] || '';
    const b = t.building || '';
    const rail = t.railway || '';
    const hist = t.historic || '';
    let clat = e.lat;
    let clng = e.lon;
    if (e.geometry?.length) {
      clat = e.geometry.reduce((s, p) => s + p.lat, 0) / e.geometry.length;
      clng = e.geometry.reduce((s, p) => s + p.lon, 0) / e.geometry.length;
    }
    const interesting =
      name ||
      hist ||
      rail ||
      /^(hut|cabin|roof|yes|shed|service)$/i.test(b);
    if (!interesting) continue;
    console.log(
      e.type,
      e.id,
      name || '(no name)',
      `b=${b}`,
      `rail=${rail}`,
      `hist=${hist}`,
      clat?.toFixed(6),
      clng?.toFixed(6),
      'pts',
      e.geometry?.length || 0,
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
