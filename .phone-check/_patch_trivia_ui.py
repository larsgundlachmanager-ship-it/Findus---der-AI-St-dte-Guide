from pathlib import Path

# speakModuleWaitBridge — scrub trivia clarify early
p = Path("src/module2/router/runConciergeTurn.ts")
t = p.read_text(encoding="utf-8")
old = """    const { sanitizeBridgeText, scrubBridgeCityLeak } = require('../chat/butlerOfferBus') as {
      sanitizeBridgeText: (s: string | null) => string | null;
      scrubBridgeCityLeak: (o: {
        bridge: string;
        userText: string;
        gpsCities?: Array<string | null | undefined> | null;
      }) => string;
    };
    t = sanitizeBridgeText(t) || '';
"""
new = """    const { sanitizeBridgeText, scrubBridgeCityLeak, scrubTriviaClarifyBridge } = require('../chat/butlerOfferBus') as {
      sanitizeBridgeText: (s: string | null) => string | null;
      scrubBridgeCityLeak: (o: {
        bridge: string;
        userText: string;
        gpsCities?: Array<string | null | undefined> | null;
      }) => string;
      scrubTriviaClarifyBridge: (o: {
        bridge: string;
        userText: string;
      }) => string | null;
    };
    t = sanitizeBridgeText(t) || '';
    if (t && opts?.userText) {
      t = scrubTriviaClarifyBridge({ bridge: t, userText: opts.userText }) || '';
    }
"""
if old not in t:
    raise SystemExit("speakModuleWaitBridge import block missing")
t = t.replace(old, new, 1)

# Expand post-analyze trivia scrub patterns
old2 = """        /\\b(wen|was|welche[rn]?)\\s+(genau\\s+)?meinst\\b|\\bwie\\s+alt\\s+ist\\s+wer\\b/iu.test(
          br,
        ) ||
        /\\b(finde\\s+(gerne\\s+)?heraus|schau\\s+mal\\s+wer|recherchier|gute\\s+frage[,.]?\\s+aber|spannende\\s+frage)\\b/iu.test(
          br,
        )"""
new2 = """        /\\b(wen|was|welche[rn]?)\\s+(genau\\s+)?meinst\\b|\\bwen\\s+genau\\b|\\bwie\\s+alt\\s+ist\\s+wer\\b/iu.test(
          br,
        ) ||
        /\\b(finde\\s+(gerne\\s+)?heraus|schau\\s+mal\\s+wer|recherchier|gute\\s+frage[,.]?\\s+aber|spannende\\s+frage)\\b/iu.test(
          br,
        )"""
if old2 not in t:
    raise SystemExit("trivia scrub pattern missing")
t = t.replace(old2, new2, 1)
p.write_text(t, encoding="utf-8")
print("runConciergeTurn ok")

# spickzettelTitle — trivia before weather
sp = Path("src/services/concierge/spickzettelTitle.ts")
st = sp.read_text(encoding="utf-8")
# Insert trivia block before weather if not already ordered
marker = """  if (
    /\\b(wetter|regen|schauer|regenschirm|bewölkt|bewoelkt|sonnig|wechselhaft|niederschlag|temperaturen?\\b|\\d+\\s*°)/iu.test(
      blob,
    )
  ) {
    return city ? `Wetter in ${city}` : 'Wetter';
  }"""
trivia_first = """  // Trivia/Wer-ist/Wie-heißt ZUERST — nie Wetter-Titel von GPS/HUD kleben
  if (/\\bwie\\s+alt\\b/iu.test(u) || /\\bwie\\s+alt\\b/iu.test(s)) {
    const who =
      u.match(
        /\\bwie\\s+alt\\s+ist\\s+(?:(?:der|die|das)\\s+)?(.+?)(?:\\s*\\?|$)/iu,
      )?.[1]?.trim() || '';
    const person = who.replace(/\\?+$/, '').trim();
    if (person && person.length >= 2 && person.length <= 40 && !/^namen$/iu.test(person)) {
      return person.slice(0, 48);
    }
    return 'Alter';
  }
  if (/\\b(?:wie\\s+(?:heißt|heisst|nennt)|wer\\s+(?:ist|war|heißt|heisst))\\b/iu.test(u)) {
    const topic =
      u
        .match(
          /\\b(?:wie\\s+(?:heißt|heisst|nennt(?:\\s+man)?)|wer\\s+(?:ist|war|heißt|heisst))\\s+(?:(?:die|der|das)\\s+)?(?:aktuelle[rn]?\\s+|jetzige[rn]?\\s+)?(.+?)(?:\\s*\\?|$)/iu,
        )?.[1]
        ?.replace(/\\?+$/, '')
        .replace(/\\s+/g, ' ')
        .trim() || '';
    if (topic.length >= 3 && topic.length <= 48 && !/^(das|es|er|sie)$/iu.test(topic)) {
      return topic.slice(0, 48);
    }
    return 'Person';
  }

""" + marker

# Remove duplicate age/who blocks later
if "Trivia/Wer-ist/Wie-heißt ZUERST" not in st:
    if marker not in st:
        raise SystemExit("weather marker missing")
    st = st.replace(marker, trivia_first, 1)
    # Remove old age + who-is blocks that are now duplicated
    import re
    st = re.sub(
        r"\n  // Alter-/Personen-Trivia:.*?return 'Person';\n  \}\n",
        "\n",
        st,
        count=1,
        flags=re.S,
    )
    sp.write_text(st, encoding="utf-8")
    print("spickzettel ok")
else:
    print("spickzettel already")

# visualBullets — reject orphan year/paren crumbs
vb = Path("src/services/concierge/visualBullets.ts")
vt = vb.read_text(encoding="utf-8")
if "orphan year crumb" not in vt:
    vt = vt.replace(
        """  if (/[:：]\\s*(\\.\\.\\.|…)?\\s*$/u.test(b)) return true;""",
        """  if (/[:：]\\s*(\\.\\.\\.|…)?\\s*$/u.test(b)) return true;
  // Orphan year / \"23)\" crumbs from rewrite
  if (/^(?:\\d{1,4}\\)?|\\d{4}\\s*[·\\-]\\s*\\)?)$/u.test(b)) return true;
  if (/^[)\\]\\}.,;:·\\-–—]+$/u.test(b)) return true;""",
        1,
    )
    # Soften year-first rewrite when core is junk
    old_year = """  const year = b.match(/\\b((?:1[0-9]{3}|20[0-2]\\d))\\b/);
  if (year) {
    const rest = b
      .replace(year[0], ' ')
      .replace(BULLET_FLUFF_RE, ' ')
      .replace(/\\s+/g, ' ')
      .replace(/^[\\s·,\\-–—]+|[\\s·,\\-–—]+$/g, '')
      .trim();
    const budget = limit - year[0].length - 3;
    if (budget >= 8) {
      const core = compressPhrase(rest || b, budget);
      if (core) return stripDanglingTail(`${year[0]} · ${core}`);
    }
  }"""
    new_year = """  const year = b.match(/\\b((?:1[0-9]{3}|20[0-2]\\d))\\b/);
  if (year) {
    const rest = b
      .replace(year[0], ' ')
      .replace(BULLET_FLUFF_RE, ' ')
      .replace(/\\s+/g, ' ')
      .replace(/^[\\s·,\\-–—)+\\]]+|[\\s·,\\-–—)+\\]]+$/g, '')
      .trim();
    const budget = limit - year[0].length - 3;
    if (budget >= 8 && rest.length >= 6 && /[A-Za-zÄÖÜäöüß]/u.test(rest)) {
      const core = compressPhrase(rest, budget);
      if (core && /[A-Za-zÄÖÜäöüß]/u.test(core) && core.length >= 4) {
        return stripDanglingTail(`${year[0]} · ${core}`);
      }
    }
  }"""
    if old_year not in vt:
        raise SystemExit("year block missing")
    vt = vt.replace(old_year, new_year, 1)
    vb.write_text(vt, encoding="utf-8")
    print("visualBullets ok")
else:
    print("visualBullets already")

print("all patches applied")
