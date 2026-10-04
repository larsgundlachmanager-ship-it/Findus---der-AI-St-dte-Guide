# -*- coding: utf-8 -*-
from pathlib import Path
import os

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
p = ROOT / "src/services/homeMap/mapPlaceLiveActions.ts"
t = p.read_text(encoding="utf-8")

def safe_write(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmpwrite")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)

old_ids = """export type MapPlaceLiveActionId =
  | 'hours'
  | 'menu'
  | 'book'
  | 'ticket'
  | 'departures'
  | 'cinema_program'
  | 'theater_program';"""

new_ids = """export type MapPlaceLiveActionId =
  | 'hours'
  | 'menu'
  | 'book'
  | 'ticket'
  | 'departures'
  | 'cinema_program'
  | 'theater_program'
  | 'museum_program'
  | 'concert_program';"""

if "museum_program" not in t:
    if old_ids not in t:
        raise SystemExit("ids missing")
    t = t.replace(old_ids, new_ids, 1)

old_re = """const MUSEUM_RE = /museum|ausstellung|galerie|gallery|kunsthalle/i;
const ACTIVITY_RE =
  /kletter|boulder|schwimmbad|freibad|hallenbad|therme|minigolf|bowling|\\bsport\\b|fitness|wasserski|surf|\\bkart\\b|paintball|freizeitpark|zoo|tierpark/i;
const CINEMA_RE = /\\bkino\\b|cinema|filmtheater|lichtspiel/i;
const THEATER_RE =
  /theater|theatre|schauspielhaus|schauspiel|\\boper\\b|opernhaus|bühne|buehne/i;"""

new_re = """const MUSEUM_RE = /museum|ausstellung|galerie|gallery|kunsthalle/i;
const ACTIVITY_RE =
  /kletter|boulder|schwimmbad|freibad|hallenbad|therme|minigolf|bowling|\\bsport\\b|fitness|wasserski|surf|\\bkart\\b|paintball|freizeitpark|zoo|tierpark/i;
const CINEMA_RE = /\\bkino\\b|cinema|filmtheater|lichtspiel/i;
const THEATER_RE =
  /theater|theatre|schauspielhaus|schauspiel|\\boper\\b|opernhaus|bühne|buehne/i;
const CONCERT_RE =
  /konzert|philharmon|konzerthaus|konzertsaal|konzerthalle|musikhalle|elbphil|elphi|symphony|concert\\s*hall|\\barena\\b/i;"""

if "CONCERT_RE" not in t:
    if old_re not in t:
        raise SystemExit("re block missing")
    t = t.replace(old_re, new_re, 1)

old_derive = """  const museum = MUSEUM_RE.test(blob);
  const cinema = CINEMA_RE.test(blob);
  const theater = THEATER_RE.test(blob) && !cinema;
  const activity = ACTIVITY_RE.test(blob);"""

new_derive = """  const museum = MUSEUM_RE.test(blob);
  const cinema = CINEMA_RE.test(blob);
  const theater = THEATER_RE.test(blob) && !cinema;
  const concert =
    CONCERT_RE.test(blob) && !cinema && !theater && !museum;
  const activity = ACTIVITY_RE.test(blob);"""

if "const concert =" not in t:
    if old_derive not in t:
        raise SystemExit("derive vars missing")
    t = t.replace(old_derive, new_derive, 1)

# hours include concert
old_hours = """    (gastro ||
      hotel ||
      museum ||
      cinema ||
      theater ||
      activity ||
      shop ||
      park ||
      toilet)"""
new_hours = """    (gastro ||
      hotel ||
      museum ||
      cinema ||
      theater ||
      concert ||
      activity ||
      shop ||
      park ||
      toilet)"""
if "concert ||" not in t.split("acts.push({ id: 'hours'")[0][-400:]:
    if old_hours in t:
        t = t.replace(old_hours, new_hours, 1)

old_btns = """  if (cinema) acts.push({ id: 'cinema_program', label: 'Kinoprogramm' });
  if (theater) acts.push({ id: 'theater_program', label: 'Theaterprogramm' });
  // Museum/Attraktion: Ticket über Partner-Link (GYG/Musement).
  if (museum || activity) acts.push({ id: 'ticket', label: 'Tickets' });"""

new_btns = """  if (cinema) acts.push({ id: 'cinema_program', label: 'Kinoprogramm' });
  if (theater) acts.push({ id: 'theater_program', label: 'Theaterprogramm' });
  if (museum) acts.push({ id: 'museum_program', label: 'Ausstellung' });
  if (concert) acts.push({ id: 'concert_program', label: 'Konzertprogramm' });
  // Museum/Attraktion/Konzert: Ticket über Partner-Link (GYG/Musement).
  if (museum || activity || concert) acts.push({ id: 'ticket', label: 'Tickets' });"""

if "museum_program" not in t or "Ausstellung" not in t:
    if old_btns not in t:
        raise SystemExit("btns missing")
    t = t.replace(old_btns, new_btns, 1)

# Replace theater runner with shared website program + museum/concert
old_th = """async function runTheaterProgram(
  ctx: MapPlaceLiveActionContext,
): Promise<MapPlaceLiveActionResult> {
  const site = (ctx.websiteUrl || '').trim();
  if (/^https?:\\/\\//i.test(site)) {
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
}"""

new_th = """/** Website/Programm öffnen — fail-closed ohne erfundene Shows. */
async function runWebsiteProgram(
  ctx: MapPlaceLiveActionContext,
  kind: 'theater' | 'museum' | 'concert',
): Promise<MapPlaceLiveActionResult> {
  const site = (ctx.websiteUrl || '').trim();
  const labels = {
    theater: {
      bullet: 'Theaterprogramm auf der Website',
      speak: 'Ich öffne das Theaterprogramm.',
      miss: 'Kein Programm-Link hinterlegt — Website des Theaters später prüfen.',
    },
    museum: {
      bullet: 'Aktuelle Ausstellung auf der Website',
      speak: 'Ich öffne die Ausstellungsinfos.',
      miss: 'Kein Programm-Link hinterlegt — Museum-Website später prüfen.',
    },
    concert: {
      bullet: 'Konzertprogramm auf der Website',
      speak: 'Ich öffne das Konzertprogramm.',
      miss: 'Kein Programm-Link hinterlegt — Venue-Website später prüfen.',
    },
  } as const;
  const L = labels[kind];
  if (/^https?:\\/\\//i.test(site)) {
    return {
      ok: true,
      url: site,
      bullets: [L.bullet],
      speak: L.speak,
    };
  }
  return { ok: false, message: L.miss };
}

async function runTheaterProgram(
  ctx: MapPlaceLiveActionContext,
): Promise<MapPlaceLiveActionResult> {
  return runWebsiteProgram(ctx, 'theater');
}

async function runMuseumProgram(
  ctx: MapPlaceLiveActionContext,
): Promise<MapPlaceLiveActionResult> {
  return runWebsiteProgram(ctx, 'museum');
}

async function runConcertProgram(
  ctx: MapPlaceLiveActionContext,
): Promise<MapPlaceLiveActionResult> {
  return runWebsiteProgram(ctx, 'concert');
}"""

if "runMuseumProgram" not in t:
    if old_th not in t:
        raise SystemExit("theater runner missing")
    t = t.replace(old_th, new_th, 1)

old_sw = """    case 'theater_program':
      return runTheaterProgram(ctx);
    default:"""
new_sw = """    case 'theater_program':
      return runTheaterProgram(ctx);
    case 'museum_program':
      return runMuseumProgram(ctx);
    case 'concert_program':
      return runConcertProgram(ctx);
    default:"""
if "museum_program':" not in t.replace(" ", "") or "runMuseumProgram(ctx)" not in t:
    if old_sw not in t:
        raise SystemExit("switch missing")
    t = t.replace(old_sw, new_sw, 1)

safe_write(p, t)
print("ok live actions")

# smoke
s = ROOT / "src/services/homeMap/mapPlaceLiveActions.smoke.test.ts"
st = s.read_text(encoding="utf-8")
block = """
{
  const m = ids('Heimatmuseum', 'Museum', 'museum ausstellung');
  assert(m.includes('museum_program'), 'Museum hat Ausstellung-Button');
  assert(m.includes('hours'), 'Museum hat Öffnungszeiten');
}
{
  const c = ids('Elbphilharmonie', 'Konzerthaus', 'konzert philharmonie');
  assert(c.includes('concert_program'), 'Konzerthaus hat Konzertprogramm');
  assert(!c.includes('cinema_program'), 'Konzert ohne Kino');
}
"""
if "Museum hat Ausstellung-Button" not in st:
    st = st.replace(
        "console.log('mapPlaceLiveActions.smoke.test.ts OK');",
        block + "\nconsole.log('mapPlaceLiveActions.smoke.test.ts OK');",
        1,
    )
    safe_write(s, st)
    print("ok smoke")
else:
    print("skip smoke")
