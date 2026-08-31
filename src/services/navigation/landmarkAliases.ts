/**
 * Landmark / STT-Aliase — ohne RN-Deps (auch in Smoke-Tests).
 */

export function canonicalizeLandmarkQuery(raw: string): {
  query: string;
  preferredCityId: string | null;
  matchedLandmark: boolean;
} {
  const t = (raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return { query: t, preferredCityId: null, matchedLandmark: false };

  // Elphi: inkl. STT „A Harmonie“ / „A-Harmonie“ (nicht bare „A“)
  if (
    /\belphi\b|\belbphil\w*|\belphi[-\s]?harmonie\b|\ba[-\s]?harmonie\b|\bzur\s+a[-\s]?harmonie\b/iu.test(
      t,
    )
  ) {
    return {
      query: 'Elbphilharmonie Hamburg',
      preferredCityId: 'hamburg',
      matchedLandmark: true,
    };
  }

  if (
    /\b(?:hamburger\s+)?michel(?:-frage)?\b|\bst\.?\s*michaelis(?:kirche)?\b/iu.test(
      t,
    )
  ) {
    return {
      query: 'Michel Hamburg',
      preferredCityId: 'hamburg',
      matchedLandmark: true,
    };
  }

  // Fechtclub Lübeck — STT oft „Fühling-Club“ / „Fühlingclub“
  if (
    /\b(?:l[üu]becker?\s+)?f[üu]h?lings?[-\s]?club\b|\b(?:l[üu]becker?\s+)?fecht(?:er)?[-\s]?club\b|\bfechtclub\s+l[üu]beck\b/iu.test(
      t,
    )
  ) {
    return {
      query: 'Fechtclub Lübeck',
      preferredCityId: 'luebeck',
      matchedLandmark: true,
    };
  }

  if (/\bholstentor\b/iu.test(t)) {
    return {
      query: 'Holstentor Lübeck',
      preferredCityId: 'luebeck',
      matchedLandmark: true,
    };
  }

  if (
    /\b(?:lbv\s+phoe?nix|lbv\s+ph[öo]nix|tennisclub\s+phoe?nix|tennisclub\s+ph[öo]nix|tennis\s+phoe?nix|tennis\s+ph[öo]nix|tennis\s+lbv|phoe?nix\s+l[üu]beck|ph[öo]nix\s+l[üu]beck)\b/iu.test(
      t,
    )
  ) {
    return {
      query: 'Tennis LBV Phönix Lübeck',
      preferredCityId: 'luebeck',
      matchedLandmark: true,
    };
  }

  if (
    /\b(?:st\.?\s*)?marienkirche\b|\bst\.?\s*marien\b/iu.test(t) &&
    !/\b(dresden|münchen|muenchen|köln|koeln)\b/iu.test(t)
  ) {
    return {
      query: 'Marienkirche Lübeck',
      preferredCityId: 'luebeck',
      matchedLandmark: true,
    };
  }
  if (
    /\bfrauenkirche\b/iu.test(t) &&
    !/\b(dresden|münchen|muenchen)\b/iu.test(t)
  ) {
    return {
      query: 'Marienkirche Lübeck',
      preferredCityId: 'luebeck',
      matchedLandmark: true,
    };
  }

  return { query: t, preferredCityId: null, matchedLandmark: false };
}

export function foldCityKey(s: string | null | undefined): string {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function slugCityHint(hint: string | null | undefined): string | null {
  const h = (hint || '').trim().toLowerCase();
  if (!h) return null;
  if (/hamburg|hafen\s*city|hafencity/.test(h)) return 'hamburg';
  if (/prisdorf/.test(h)) return 'prisdorf';
  if (/lübeck|luebeck/.test(h)) return 'luebeck';
  if (/berlin/.test(h)) return 'berlin';
  if (/lissabon|lisbon/.test(h)) return 'lissabon';
  const slug = foldCityKey(h).slice(0, 40);
  return slug.length >= 3 ? slug : null;
}
