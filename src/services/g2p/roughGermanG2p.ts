import type { GermanG2PProvider } from './types';

/**
 * Legacy-Fallback (ASCII-artig). Produktion nutzt `germanIpaG2P` (echtes IPA).
 * Nur behalten für Debug / A-B-Vergleiche — nicht für Produkt-TTS.
 */
export const roughGermanG2P: GermanG2PProvider = {
  id: 'rough-de-v3',
  productionReady: false,

  phonemize(text: string): string {
    let s = text.toLowerCase().normalize('NFKC');

    s = s.replace(/\u00df/g, 'ss');

    // Digraphen (wichtig für DE)
    s = s.replace(/tsch/g, 't\u0283'); // tʃ ≈ t+ʃ
    s = s.replace(/sch/g, '\u0283'); // ʃ
    s = s.replace(/chs/g, 'ks');
    s = s.replace(/ch/g, '\u00e7'); // ç
    s = s.replace(/ck/g, 'k');
    s = s.replace(/tz/g, 'ts');
    s = s.replace(/ph/g, 'f');
    s = s.replace(/qu/g, 'kv');
    s = s.replace(/ng/g, 'n');
    s = s.replace(/pf/g, 'pf');

    // Diphthonge / Umlaute
    s = s.replace(/ie/g, 'i');
    s = s.replace(/ei|ai|ey|ay/g, 'ai');
    s = s.replace(/eu|\u00e4u/g, 'oi');
    s = s.replace(/au/g, 'au');
    s = s.replace(/\u00f6/g, 'oe');
    s = s.replace(/\u00fc/g, 'ue');
    s = s.replace(/\u00e4/g, 'ae');
    s = s.replace(/ah|aa/g, 'a');
    s = s.replace(/eh|ee/g, 'e');
    s = s.replace(/oh|oo/g, 'o');
    s = s.replace(/uh/g, 'u');

    // w = /v/ im Deutschen
    s = s.replace(/w/g, 'v');
    s = s.replace(/y/g, 'i');
    s = s.replace(/x/g, 'ks');
    s = s.replace(/c(?=[eiy])/g, 'ts');
    s = s.replace(/c/g, 'k');
    s = s.replace(/z/g, 'ts');
    s = s.replace(/j/g, 'j');

    // Satzzeichen behalten, Rest säubern
    s = s.replace(/[^a-z\s.,!?\u00e7\u0283]/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  },
};
