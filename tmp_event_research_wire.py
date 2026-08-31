from pathlib import Path

# --- eventResearchService.ts ---
p = Path(r"C:\Users\larsf\Findus 2.0\src\services\concierge\eventResearchService.ts")
t = p.read_text(encoding="utf-8")

# Fix import of keepFoundEventUrl to also pull helpers
old_imp = None
for needle in [
    "keepFoundEventUrl,",
    "keepFoundEventUrl }",
    "keepFoundEventUrl } from",
]:
    if needle in t:
        break

# Find actual import
import re
m = re.search(r"import\s*\{([^}]+)\}\s*from\s*['\"]\\.\\./research/eventInfoUrl['\"]", t)
if not m:
    m = re.search(r"import\s*\{([^}]+)\}\s*from\s*['\"]\\.\\./research/eventInfoUrl['\"]", t)
# try simpler
if "from '../research/eventInfoUrl'" in t or 'from "../research/eventInfoUrl"' in t:
    t2 = t
    # replace keepFoundEventUrl import block
    old = None
    for line_block in re.finditer(
        r"import\s*\{[^}]*keepFoundEventUrl[^}]*\}\s*from\s*['\"][^'\"]+eventInfoUrl['\"];",
        t,
    ):
        old = line_block.group(0)
        break
    if old:
        new = """import {
  buildNamedPlaceMapsUrl,
  eventUrlMatchesHints,
  isCoordsOnlyMapsUrl,
  keepFoundEventUrl,
  resolveEventInfoUrl,
} from '../research/eventInfoUrl';"""
        t = t.replace(old, new, 1)
        print('import updated')
    else:
        # maybe multi-line
        old_ml = """import {
  keepFoundEventUrl,"""
        if old_ml in t:
            t = t.replace(
                old_ml,
                """import {
  buildNamedPlaceMapsUrl,
  eventUrlMatchesHints,
  isCoordsOnlyMapsUrl,
  keepFoundEventUrl,
  resolveEventInfoUrl,""",
                1,
            )
            print('import multiline updated')
        else:
            print('WARN: import not found, adding after first eventInfoUrl ref')
            # add require-style usage later
else:
    print('no eventInfoUrl import path?')

# asEvents: use resolveEventInfoUrl with matching
old_as = """    const infoUrl = keepFoundEventUrl(rawInfo);
    const rawTicket =
      typeof e.ticketUrl === 'string' && /^https?:\\/\\//i.test(e.ticketUrl)
        ? e.ticketUrl
        : null;
    const ticketUrl = keepFoundEventUrl(rawTicket);"""

new_as = """    const hints = {
      title: title || venue,
      venue: venue || title,
      city: null as string | null,
    };
    const infoUrl = resolveEventInfoUrl({
      candidate: rawInfo,
      hints,
    });
    const rawTicket =
      typeof e.ticketUrl === 'string' && /^https?:\\/\\//i.test(e.ticketUrl)
        ? e.ticketUrl
        : null;
    const ticketKept = keepFoundEventUrl(rawTicket);
    const ticketUrl =
      ticketKept && eventUrlMatchesHints(ticketKept, hints) ? ticketKept : null;"""

if old_as not in t:
    raise SystemExit('asEvents infoUrl block not found')
t = t.replace(old_as, new_as, 1)

# Prompt lines
old_prompt = """    'infoUrl = die EXAKTE Event-DETAILSEITE aus den Suchtreffern 1:1 kopieren (z. B. rausgegangen.de/events/…). Nie Stadt-Kalender. Nie einen Slug erfinden oder umbauen.',"""
new_prompt = """    'infoUrl = die EXAKTE URL aus dem Suchtreffer / Browser-Adresszeile 1:1 kopieren — die Seite, auf der du den Treffer siehst (wie „Link teilen“). Nie Stadt-Kalender, nie Slug erfinden/umbauen, nie thematisch fremde Seiten (z. B. Suchtprävention statt Weinfest). Wenn unsicher: infoUrl=null.',"""
if old_prompt not in t:
    raise SystemExit('prompt line not found')
t = t.replace(old_prompt, new_prompt, 1)

# Maps in eventResearchToActions
old_maps = """    if (briefing && e.lat != null && e.lng != null) {
      actions.push({
        type: 'START_NAVIGATION',
        label: shortenActionLabel('📍 Navigation starten'),
        payload: {
          destName: e.venue,
          destLat: e.lat,
          destLng: e.lng,
        },
      });
    } else if (e.lat != null && e.lng != null) {
      actions.push({
        type: 'OPEN_URL',
        label: shortenActionLabel(`🗺️ Maps ${e.venue}`),
        payload: {
          url: `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}`,
          destName: e.venue,
        },
      });
    } else if (briefing) {
      const q = encodeURIComponent(`${e.venue} ${research.city}`);
      actions.push({
        type: 'OPEN_URL',
        label: shortenActionLabel('🗺️ Maps'),
        payload: {
          url: `https://www.google.com/maps/search/?api=1&query=${q}`,
          destName: e.venue,
        },
      });
    }"""

new_maps = """    if (briefing && e.lat != null && e.lng != null) {
      actions.push({
        type: 'START_NAVIGATION',
        label: shortenActionLabel('📍 Navigation starten'),
        payload: {
          destName: e.venue,
          destLat: e.lat,
          destLng: e.lng,
        },
      });
    } else {
      // Maps nur mit Ortsnamen — nie nackte Koordinaten-Query
      const mapsUrl = buildNamedPlaceMapsUrl({
        placeName: e.venue || e.title,
        city: research.city,
      });
      if (mapsUrl) {
        actions.push({
          type: 'OPEN_URL',
          label: shortenActionLabel(`🗺️ Maps ${e.venue || e.title}`),
          payload: { url: mapsUrl, destName: e.venue || e.title },
        });
      }
    }"""

if old_maps not in t:
    raise SystemExit('maps actions block not found')
t = t.replace(old_maps, new_maps, 1)

# Pitch mapsUrl
old_pitch_maps = """      const mapsUrl =
        lat && lng
          ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              `${e.venue} ${research.city}`,
            )}`;"""

new_pitch_maps = """      const mapsUrl =
        buildNamedPlaceMapsUrl({
          placeName: e.venue || e.title,
          city: research.city,
        }) || '';"""

if old_pitch_maps not in t:
    raise SystemExit('pitch mapsUrl not found')
t = t.replace(old_pitch_maps, new_pitch_maps, 1)

# websiteUrl must match
old_web = """        websiteUrl: e.infoUrl,
        actions: buildPitchActions({
          kind: 'tour',
          name: e.title,
          lat,
          lng,
          mapsUrl,
          ticketUrl: ticket,
          websiteUrl: e.infoUrl,"""

new_web = """        websiteUrl:
          e.infoUrl &&
          eventUrlMatchesHints(e.infoUrl, {
            title: e.title,
            venue: e.venue,
            city: research.city,
          })
            ? e.infoUrl
            : null,
        actions: buildPitchActions({
          kind: 'tour',
          name: e.title,
          lat,
          lng,
          mapsUrl,
          ticketUrl: ticket,
          websiteUrl:
            e.infoUrl &&
            eventUrlMatchesHints(e.infoUrl, {
              title: e.title,
              venue: e.venue,
              city: research.city,
            })
              ? e.infoUrl
              : null,"""

if old_web not in t:
    raise SystemExit('pitch website block not found')
t = t.replace(old_web, new_web, 1)

tmp = p.with_suffix('.ts.tmpwrite')
tmp.write_text(t, encoding='utf-8')
tmp.replace(p)
print('eventResearchService OK')
