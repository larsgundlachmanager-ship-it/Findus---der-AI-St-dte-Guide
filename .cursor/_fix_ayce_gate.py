from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\hardMatchVerify.ts")
s = p.read_text(encoding="utf-8")
bad = """    const ayceMust =
      musts.some((w) => isAyceWishText(w.text)) ||
      isAyceWishText(${opts.req.title} ) ||
      (() => {
        try {
          const { looksLikeAyceQuery } = require('./ayceIntent') as {
            looksLikeAyceQuery: (s: string) => boolean;
          };
          return looksLikeAyceQuery(${opts.req.title} );
        } catch {
          return false;
        }
      })();"""
good = """    const ayceReqBlob = `${opts.req.title} ${opts.req.context}`;
    let ayceMust = musts.some((w) => isAyceWishText(w.text)) || isAyceWishText(ayceReqBlob);
    if (!ayceMust) {
      try {
        const { looksLikeAyceQuery } = require('./ayceIntent') as {
          looksLikeAyceQuery: (s: string) => boolean;
        };
        ayceMust = looksLikeAyceQuery(ayceReqBlob);
      } catch {
        /* soft */
      }
    }"""
# If already broken differently, find by marker
if bad not in s:
    idx = s.find("const ayceMust =")
    print("bad block missing, around:", repr(s[idx:idx+280]))
    # try replace from isAyceWishText const through })();
    start = s.find("    const isAyceWishText = (t: string) =>")
    end = s.find("    // AYCE: nie Soft-Fill", start)
    if start < 0 or end < 0:
        raise SystemExit("markers missing")
    mid = """    const isAyceWishText = (t: string) =>
      /all_you_can_eat|must_ayce|\\bayce\\b|schlemmer|all[\\s_-]*you[\\s_-]*can[\\s_-]*eat|unbegrenzt\\s+essen|unlimited\\s+buffet|flatrate\\s+(?:essen|buffet|sushi)|rodiz/i.test(
        t || '',
      );
    const ayceReqBlob = `${opts.req.title} ${opts.req.context}`;
    let ayceMust = musts.some((w) => isAyceWishText(w.text)) || isAyceWishText(ayceReqBlob);
    if (!ayceMust) {
      try {
        const { looksLikeAyceQuery } = require('./ayceIntent') as {
          looksLikeAyceQuery: (s: string) => boolean;
        };
        ayceMust = looksLikeAyceQuery(ayceReqBlob);
      } catch {
        /* soft */
      }
    }
"""
    s = s[:start] + mid + s[end:]
else:
    s = s.replace(bad, good, 1)

tmp = p.with_suffix(".ts.patching")
tmp.write_text(s, encoding="utf-8")
tmp.replace(p)
print("fixed", "ayceReqBlob" in p.read_text(encoding="utf-8"))
