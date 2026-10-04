# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def patch(path, old, new, label):
    t = path.read_text(encoding="utf-8")
    if old not in t:
        raise SystemExit(f"MISSING: {label}")
    path.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("ok", label)


live = ROOT / "src/services/homeMap/mapPlaceLiveActions.ts"
patch(
    live,
    """export type MapPlaceLiveActionId =
  | 'hours'
  | 'menu'
  | 'book'
  | 'ticket'
  | 'departures';""",
    """export type MapPlaceLiveActionId =
  | 'hours'
  | 'menu'
  | 'book'
  | 'ticket'
  | 'departures'
  | 'cinema_program'
  | 'theater_program';""",
    "action ids",
)

patch(
    live,
    """const ACTIVITY_RE =
  /kletter|boulder|schwimmbad|freibad|hallenbad|therme|minigolf|bowling|kino|theater|\\bsport\\b|fitness|wasserski|surf|\\bkart\\b|paintball|freizeitpark|zoo|tierpark/i;
const SHOP_RE =
  /shop|laden|gesch[aä]ft|supermarkt|apotheke|drogerie|markt|store|kiosk|buchhandlung|metzger|fleischer/i;""",
    """const ACTIVITY_RE =
  /kletter|boulder|schwimmbad|freibad|hallenbad|therme|minigolf|bowling|\\bsport\\b|fitness|wasserski|surf|\\bkart\\b|paintball|freizeitpark|zoo|tierpark/i;
const CINEMA_RE = /\\bkino\\b|cinema|filmtheater|lichtspiel/i;
const THEATER_RE =
  /theater|theatre|schauspielhaus|schauspiel|\\boper\\b|opernhaus|bühne|buehne/i;
const SHOP_RE =
  /shop|laden|gesch[aä]ft|supermarkt|supermarket|apotheke|drogerie|markt|store|kiosk|buchhandlung|metzger|fleischer|edeka|rewe|aldi|lidl|food\\s*plus|mcdonald|burger\\s*king/i;""",
    "cinema theater regex",
)

patch(
    live,
    """  const transit = isRealTransitStop(blob);
  const gastro = !transit && GASTRO_RE.test(blob);
  const hotel = HOTEL_RE.test(blob);
  const museum = MUSEUM_RE.test(blob);
  const activity = ACTIVITY_RE.test(blob);
  const shop = SHOP_RE.test(blob);
  const park =
    /\\bpark\\b|garten|spielplatz|grünanlage|gruenanlage|wald|picknick|hundewiese/i.test(
      blob,
    );
  const toilet = /toilette|\\bwc\\b|restroom|bathroom/i.test(blob);

  const acts: MapPlaceLiveActionDef[] = [];
  // Öffnungszeiten für Orte mit plausiblen Zeiten (kein reiner Halt).
  if (
    !transit &&
    (gastro || hotel || museum || activity || shop || park || toilet)
  ) {
    acts.push({ id: 'hours', label: 'Öffnungszeiten' });
  }
  if (gastro) acts.push({ id: 'menu', label: 'Speisekarte' });
  // Hotel: Affiliate-Buchen (Stay22) — kein externes Maps daneben.
  if (hotel) acts.push({ id: 'book', label: 'Buchen' });
  // Museum/Attraktion: Ticket über Partner-Link (GYG/Musement).
  if (museum || activity) acts.push({ id: 'ticket', label: 'Tickets' });
  // ÖPNV bleibt in-app (Abfahrten), kein externes Maps.
  if (transit) acts.push({ id: 'departures', label: 'Abfahrten' });
  return acts;
}""",
    """  const transit = isRealTransitStop(blob);
  const gastro = !transit && GASTRO_RE.test(blob);
  const hotel = HOTEL_RE.test(blob);
  const museum = MUSEUM_RE.test(blob);
  const cinema = CINEMA_RE.test(blob);
  const theater = THEATER_RE.test(blob) && !cinema;
  const activity = ACTIVITY_RE.test(blob);
  const shop = SHOP_RE.test(blob);
  const park =
    /\\bpark\\b|garten|spielplatz|grünanlage|gruenanlage|wald|gehege|picknick|hundewiese/i.test(
      blob,
    );
  const toilet = /toilette|\\bwc\\b|restroom|bathroom/i.test(blob);

  const acts: MapPlaceLiveActionDef[] = [];
  // Öffnungszeiten für Orte mit plausiblen Zeiten (kein reiner Halt).
  if (
    !transit &&
    (gastro ||
      hotel ||
      museum ||
      cinema ||
      theater ||
      activity ||
      shop ||
      park ||
      toilet)
  ) {
    acts.push({ id: 'hours', label: 'Öffnungszeiten' });
  }
  if (gastro) acts.push({ id: 'menu', label: 'Speisekarte' });
  // Hotel: Affiliate-Buchen (Stay22) — kein externes Maps daneben.
  if (hotel) acts.push({ id: 'book', label: 'Buchen' });
  if (cinema) acts.push({ id: 'cinema_program', label: 'Kinoprogramm' });
  if (theater) acts.push({ id: 'theater_program', label: 'Theaterprogramm' });
  // Museum/Attraktion: Ticket über Partner-Link (GYG/Musement).
  if (museum || activity) acts.push({ id: 'ticket', label: 'Tickets' });
  // ÖPNV bleibt in-app (Abfahrten), kein externes Maps.
  if (transit) acts.push({ id: 'departures', label: 'Abfahrten' });
  return acts;
}""",
    "derive live actions",
)

# Insert runCinemaProgram / runTheaterProgram before runMapPlaceLiveAction
old_run = """/** Führt eine Live-Aktion aus (Google-frei). */
export async function runMapPlaceLiveAction(
  action: MapPlaceLiveActionId,
  ctx: MapPlaceLiveActionContext,
): Promise<MapPlaceLiveActionResult> {
  if (!Number.isFinite(ctx.lat) || !Number.isFinite(ctx.lng)) {
    return { ok: false, message: 'Für den Ort fehlen gültige Koordinaten.' };
  }
  switch (action) {
    case 'hours':
      return runHours(ctx);
    case 'menu':
      return runMenu(ctx);
    case 'book':
      return runBook(ctx);
    case 'ticket':
      return runTicket(ctx);
    case 'departures':
      return runDepartures(ctx);
    default:
      return { ok: false, message: 'Aktion nicht verfügbar.' };
  }
}"""

new_run = r'''async function runCinemaProgram(
  ctx: MapPlaceLiveActionContext,
): Promise<MapPlaceLiveActionResult> {
  try {
    const { researchCinemaAndShowtimes } = await import(
      '../research/cinemaShowtimeResearch'
    );
    const research = await researchCinemaAndShowtimes({
      userText: `Kinoprogramm und Spielzeiten heute im ${ctx.name}`,
      lat: ctx.lat,
      lng: ctx.lng,
      venuesOnly: false,
      phase: 'showtimes',
      showtimeBudgetMs: 10_000,
    });
    const needle = ctx.name
      .toLowerCase()
      .replace(/[^a-zäöüß0-9]/giu, '')
      .slice(0, 10);
    const matchVenue = (label: string) => {
      const a = label
        .toLowerCase()
        .replace(/[^a-zäöüß0-9]/giu, '')
        .slice(0, 10);
      if (!a || !needle) return false;
      return a.includes(needle.slice(0, 6)) || needle.includes(a.slice(0, 6));
    };
    const shows = research.showtimes.filter((s) => matchVenue(s.cinemaName));
    const todayish = shows.filter((s) => /heute/i.test(s.whenLabel));
    const use = (todayish.length ? todayish : shows).slice(0, 4);
    if (!use.length) {
      return {
        ok: false,
        message: 'Gerade kein Kinoprogramm für diesen Ort gefunden.',
      };
    }
    const bullets = use.map((s) => {
      const price =
        s.priceEur != null && Number.isFinite(s.priceEur)
          ? ` · ab ${Math.round(s.priceEur)} €`
          : '';
      return `${s.filmTitle}: ${s.whenLabel}${price}`.slice(0, 72);
    });
    return {
      ok: true,
      bullets,
      speak: `Hier das aktuelle Programm in ${ctx.name}.`,
    };
  } catch {
    return {
      ok: false,
      message: 'Kinoprogramm gerade nicht abrufbar.',
    };
  }
}

async function runTheaterProgram(
  ctx: MapPlaceLiveActionContext,
): Promise<MapPlaceLiveActionResult> {
  const site = (ctx.websiteUrl || '').trim();
  if (/^https?:\/\//i.test(site)) {
    return {
      ok: true,
      url: site,
      bullets: ['Theaterprogramm auf der Website'],
      speak: 'Ich öffne das Theaterprogramm.',
    };
  }
  return {
    ok: false,
    message:
      'Kein Programm-Link hinterlegt — Website des Theaters später prüfen.',
  };
}

/** Führt eine Live-Aktion aus (Google-frei wo möglich). */
export async function runMapPlaceLiveAction(
  action: MapPlaceLiveActionId,
  ctx: MapPlaceLiveActionContext,
): Promise<MapPlaceLiveActionResult> {
  if (!Number.isFinite(ctx.lat) || !Number.isFinite(ctx.lng)) {
    return { ok: false, message: 'Für den Ort fehlen gültige Koordinaten.' };
  }
  switch (action) {
    case 'hours':
      return runHours(ctx);
    case 'menu':
      return runMenu(ctx);
    case 'book':
      return runBook(ctx);
    case 'ticket':
      return runTicket(ctx);
    case 'departures':
      return runDepartures(ctx);
    case 'cinema_program':
      return runCinemaProgram(ctx);
    case 'theater_program':
      return runTheaterProgram(ctx);
    default:
      return { ok: false, message: 'Aktion nicht verfügbar.' };
  }
}'''

patch(live, old_run, new_run, "run cinema theater")

# HomeMapPlacePopup rating
popup = ROOT / "src/components/homeMap/HomeMapPlacePopup.tsx"
pt = popup.read_text(encoding="utf-8")
if "placeRatingLabel" not in pt:
    # add import - find a good import line
    if "from '../../services/homeMap/mapPlaceLiveActions'" in pt:
        pt = pt.replace(
            "from '../../services/homeMap/mapPlaceLiveActions'",
            "from '../../services/homeMap/mapPlaceLiveActions';\nimport { placeRatingLabel } from '../../services/homeMap/placeRatingLabel'",
            1,
        )
    else:
        # try alternate
        m = re.search(r"import .+ from '../../services/homeMap/", pt)
        raise SystemExit("no import anchor for popup")
    pt = pt.replace(
        """  const ratingLine = ratingValue
    ? `★ ${ratingValue.toFixed(1)}${
        place.ratingCount && place.ratingCount > 0
          ? ` · ${place.ratingCount} Bewertungen`
          : ''
      }`
    : null;""",
        """  const ratingLine = placeRatingLabel(
    ratingValue,
    place.ratingCount,
  );""",
        1,
    )
    popup.write_text(pt, encoding="utf-8")
    print("ok popup rating")
else:
    print("skip popup rating")

print("batch2 done")
