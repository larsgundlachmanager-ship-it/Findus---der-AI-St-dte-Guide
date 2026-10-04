const fs = require('fs');
const p = 'src/module2/pitch/pitchDeepAppend.ts';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('      const asMenu = (url: string | null | undefined): string | null => {');
const end = s.indexOf('    } catch {\n      /* soft */\n    }\n  })();\n}\n');
if (start < 0 || end < 0) {
  console.error('markers', start, end);
  process.exit(1);
}
const replacement = `      const asMenu = (url: string | null | undefined, label = ''): string | null => {
        const u = String(url ?? '').trim();
        if (!u || !isSafeOfferUrl(u)) return null;
        const lab = String(label || '').toLowerCase();
        if (\\/\\\\b(speisekarte|menü|menue|karte|menu)\\\\b/i.test(lab) && !/maps|google/i.test(lab)) {
          return u;
        }
        try {
          const { isMenuAssetUrl } = require('../planning/offerActionUtils') as {
            isMenuAssetUrl: (x: string) => boolean;
          };
          return isMenuAssetUrl(u) ? u : null;
        } catch {
          return /speisekarte|\\\\/ugd\\\\/|\\\\.pdf|\\\\/menu/i.test(u) ? u : null;
        }
      };

      const { findDeepestMenuLink } = await import(
        '../../services/actionBoard/menuDeepLink'
      );
      const deepKind = opts.req.kind === 'bar' ? 'drinks' : 'food';
      const deepHits = await Promise.all(
        live.options.map(async (opt) => {
          const site = String(opt.websiteUrl || '').trim();
          if (!site) return { id: opt.id, url: null as string | null };
          try {
            const hit = await findDeepestMenuLink({
              websiteUrl: site,
              kind: deepKind,
              signal: opts.req.signal,
            });
            return { id: opt.id, url: hit?.url ?? null };
          } catch {
            return { id: opt.id, url: null };
          }
        }),
      );
      const deepById = new Map(deepHits.map((h) => [h.id, h.url]));

      const pickUrlForVenue = (opt: (typeof live.options)[number], index: number): string | null => {
        const needle = opt.name.toLowerCase().slice(0, 18);
        const byName = namedUrls.find((u) =>
          u.label.toLowerCase().includes(needle),
        );
        const fromBtn = asMenu(byName?.url, byName?.label);
        const fromDeep = deepById.get(opt.id);
        const fromSeed = asMenu(live.options[index]?.menuUrl);
        return fromDeep || fromBtn || fromSeed || null;
      };

      const facts = String(res.draftText ?? '');
      for (let i = 0; i < live.options.length; i++) {
        const opt = live.options[i]!;
        const url = pickUrlForVenue(opt, i);
        const menuOrSite = url || opt.websiteUrl || null;
        menuUrls[opt.id] = url;
        if (menuOrSite) {
          actionUpdates[opt.id] = buildPitchActions({
            kind: opts.req.kind,
            name: opt.name,
            lat: opt.lat,
            lng: opt.lng,
            mapsUrl: opt.mapsUrl,
            menuUrl: url,
            bookingUrl: opt.bookingUrl,
            ticketUrl: opt.ticketUrl,
            websiteUrl: opt.websiteUrl,
            role: opt.role === 'out_of_box' ? 'alternative' : opt.role,
            suppressNav: true,
          });
        }
        const priceRe = new RegExp(
          \`\${opt.name.replace(/[.*+?^\${}()|[\\\\]\\\\\\\\]/g, '\\\\\\\\$&')}[^\\\\n]{0,80}?(\\\\d+[.,]\\\\d{2}\\\\s*€|\\\\d+\\\\s*€)\`,
          'i',
        );
        const dishPriceRe = dishWish
          ? new RegExp(
              \`\${dishWish.replace(/[.*+?^\${}()|[\\\\]\\\\\\\\]/g, '\\\\\\\\$&')}[^\\\\n]{0,40}?(\\\\d+[.,]\\\\d{2}\\\\s*€|\\\\d+\\\\s*€)\`,
              'i',
            )
          : null;
        const pm =
          facts.match(priceRe) ||
          (dishPriceRe ? facts.match(dishPriceRe) : null) ||
          facts.match(/(\\\\d+[.,]\\\\d{2}\\\\s*€)/);
        if (pm?.[1]) {
          const hint = dishWish
            ? \`\${dishWish} ~\${pm[1]}\`
            : \`Preis ~\${pm[1]}\`;
          priceBits.push(\`\${opt.name}: \${hint}\`);
          const kept = opt.bullets.filter(
            (b) =>
              !/^(ambiente|frische\\\\s+gerichte|freundliche\\\\s+bedienung)/i.test(b),
          );
          bulletUpdates[opt.id] = [hint, ...kept].filter(Boolean).slice(0, 3);
        }
      }

      let spokenAppend = '';
      if (priceBits.length) {
        spokenAppend = dishWish
          ? \`Kurz zu \${dishWish}: \${priceBits.join(' · ')}.\`
          : \`Noch zu den Preisen: \${priceBits.join(' · ')}.\`;
      }
      if (!spokenAppend && !Object.keys(actionUpdates).length) return;

      opts.onAppend({
        requestId: opts.req.requestId,
        optionId: live.selectedOptionId,
        spokenAppend,
        bulletUpdates,
        actionUpdates,
        menuUrls,
      });
`;

// The escaping in the script above is a mess. Write the file from a clean template instead.
console.log('use full rewrite approach');
process.exit(2);
