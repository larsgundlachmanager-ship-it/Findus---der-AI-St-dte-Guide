import React from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import {
  AFFILIATE_DISCLOSURE_SHORT,
  AI_TRANSPARENCY_NOTICE,
} from '../../constants/legal';
import { SwipeBackView } from '../SwipeBackView';

type Props = {
  visible: boolean;
  onClose: () => void;
  /**
   * true = kein eigener Modal (z. B. innerhalb Einstellungen).
   * Vermeidet Android-Bug: Nested Modals → nur Abdunkelung, kein Inhalt.
   */
  embedded?: boolean;
};

type Section = {
  title: string;
  body: string;
  keywords?: string[];
};

const SECTIONS: Section[] = [
  {
    title: 'Wer ist Findus?',
    body:
      'Findus ist dein Reise-Concierge vor Ort: erzähl ihm, was du vorhast, und er antwortet im Kontext von Standort und Profil. ' +
      'Er erklärt Wahrzeichen (Modul 1), beantwortet Fragen, navigiert, plant den Tag und warnt bei Regen oder Verspätungen — hands-free mit Kopfhörern.',
    keywords: ['wer', 'persona', 'concierge', 'antworten', 'hands-free'],
  },
  {
    title: 'Modul 1: Vor Ort & Wahrzeichen',
    body:
      'Näherst du dich einem Wahrzeichen oder markanten Ort, springt Findus an: kurze Geschichte (wer, was, warum, heute), ' +
      'Stichpunkte darunter und Action-Buttons (Route, mehr Info, …). ' +
      'Zuerst visuelle Orientierung („das Gebäude da vorne…“), dann der Name.',
    keywords: ['modul 1', 'wahrzeichen', 'poi', 'geschichte', 'stichpunkte', 'action'],
  },
  {
    title: 'Mikrofon & Fragen',
    body:
      'Unten das Mikrofon: tippen zum Schreiben, halten zum Sprechen.\n' +
      'Beispiele:\n' +
      '• „Führ mich zum Hotel.“ / „Bring mich zum Hafen.“\n' +
      '• „Wo gibt’s guten Kaffee?“ / „Tisch für zwei um acht.“\n' +
      '• „Was geht heute Abend?“ / „Brauche ich einen Schirm?“\n' +
      '• „Erzähl mehr über diesen Ort.“\n' +
      'Klare Nav-Befehle starten die Navigation sofort mit kurzer Bestätigung.',
    keywords: [
      'mikrofon',
      'fragen',
      'navigation',
      'reservierung',
      'events',
      'wetter',
    ],
  },
  {
    title: 'Tagesplan & Timeline (📅)',
    body:
      'Oben das Kalender-Symbol öffnet den Tagesplan.\n' +
      '• „Jetzt“ trennt Vergangenheit und Zukunft.\n' +
      '• Darüber: Zeitachse — wo warst du wirklich?\n' +
      '• Darunter: der Plan fürs optimale Stadterlebnis.\n' +
      'Lange Sprachnachrichten („Plan diktieren“): Hotel, Anreise, Orte — Findus baut daraus den Plan. ' +
      'Wetter kann den Plan umbauen; mit „Plan zurück“ stellst du den vorherigen Stand wieder her.',
    keywords: [
      'tagesplan',
      'timeline',
      'kalender',
      'planung',
      'jetzt',
      'zeitachse',
      'plan diktieren',
      'plan zurück',
    ],
  },
  {
    title: 'Live-Anzeige & Stempelkarte (oben links)',
    body:
      'Oben links siehst du, wo du bist und wohin du navigierst — plus kurze Vorschläge. ' +
      'Tippen öffnet die Stempelkarte: entdeckte Orte, Fog-of-War (nur freigeruckelte Fläche zählt), ' +
      'und wie viel Prozent der aktuellen Stadt du schon erkundet hast.',
    keywords: ['live', 'hud', 'stempelkarte', 'fog', 'prozent', 'fläche'],
  },
  {
    title: 'Navigation & Stopp-Queue',
    body:
      'Während der Navigation führt dich der Kompass. ' +
      'Rechts bzw. in der Queue siehst du geplante Stopps — verschieben, löschen, umsortieren. ' +
      'Multi-Stop-Touren laufen Stop für Stop weiter.',
    keywords: ['navigation', 'queue', 'stopps', 'multistopp', 'kompass'],
  },
  {
    title: 'Einstellungen (⚙️)',
    body:
      'Zahnrad oben rechts:\n' +
      '• Einrichtung & Über dich — Stadt, Stimme, Charakter, Interessen\n' +
      '• Sparmodus — weniger Hintergrund-API, längerer Akku\n' +
      '• Stummmodus — z. B. Museum; wacht nach Zeit oder Distanz wieder auf\n' +
      '• Erklärungen — diese Hilfe, immer aktuell gehalten\n' +
      '• Feedback & Probleme — melden, was hakt (hilft allen Findus-Nutzern)',
    keywords: [
      'einstellungen',
      'stimme',
      'charakter',
      'sparmodus',
      'stumm',
      'feedback',
      'erklärungen',
    ],
  },
  {
    title: 'Wetter & Regen',
    body:
      'Findus nutzt OpenWeather (One Call) als Wetter-Quelle. ' +
      'Bei Outdoor-Plänen oder aktiver Navigation warnt er rechtzeitig vor Regen. ' +
      'Nachts im Hotel oder lange still: seltener Check (Sleep), um Kosten und Spam zu sparen.',
    keywords: ['wetter', 'regen', 'openweather', 'warnung'],
  },
  {
    title: 'ÖPNV, Flüge & Leave-by',
    body:
      'Züge/Busse: Live-Daten kurz vor Leave-by (und 24h/4h vorher ein Check). ' +
      'Flüge: adaptive Checks (24h → 4h → ab 2h alle 20 Min), Plan nur bei spürbarer Verspätung oder Gate-Wechsel. ' +
      'Erinnerungen auch bei gesperrtem Bildschirm.',
    keywords: ['öpnv', 'zug', 'flug', 'leave-by', 'verspätung', 'erinnerung'],
  },
  {
    title: 'Offline & Stadt-Pack',
    body:
      'Unter Einrichtung → Stadt lädst du ein Stadt-Pack. Offline: POIs und Pack-Geschichten. ' +
      'Netz für Live-Events, Cloud-Stimme und frische Recherche.',
    keywords: ['offline', 'stadt-pack', 'pack'],
  },
  {
    title: 'KI-Transparenz',
    body: AI_TRANSPARENCY_NOTICE,
    keywords: ['ki', 'transparenz', 'eu ai act', 'llm'],
  },
  {
    title: 'Kurz: Hands-free starten',
    body:
      '1) Kopfhörer rein, Handy in die Tasche.\n' +
      '2) Loslaufen — Findus meldet sich an Wahrzeichen.\n' +
      '3) Fragen? Mikrofon.\n' +
      '4) Tag strukturieren? Kalender / Plan diktieren.\n' +
      '5) Übersicht? Stempelkarte oben links.',
    keywords: ['quickstart', 'hands-free', 'kopfhörer'],
  },
];

export { SECTIONS as HELP_GUIDE_SECTIONS };

/**
 * Nutzer-Anleitung — ohne Entwickler- oder Simulations-Features.
 */
export function HelpGuideView({
  visible,
  onClose,
  embedded = false,
}: Props) {
  if (!visible) return null;

  const body = (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <SwipeBackView enabled={visible} onBack={onClose}>
        <View style={styles.header}>
          <Text style={styles.title}>So funktioniert Findus</Text>
          <Pressable onPress={onClose} accessibilityRole="button">
            <Text style={styles.close}>Schließen</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.lead}>
            Persönliche Begrüßung, dann vor Ort erklären, Fragen beantworten,
            Tagesplan, Navigation und Stempelkarte — hands-free gedacht.
            Diese Erklärungen werden mit neuen Funktionen mitgeführt.
          </Text>

          {SECTIONS.map((s) => (
            <View key={s.title} style={styles.card}>
              <Text style={styles.cardTitle}>{s.title}</Text>
              <Text style={styles.cardBody}>{s.body}</Text>
            </View>
          ))}

          <Text style={styles.affiliate}>{AFFILIATE_DISCLOSURE_SHORT}</Text>
        </ScrollView>
      </SwipeBackView>
    </SafeAreaView>
  );

  if (embedded) {
    return <View style={styles.embedded}>{body}</View>;
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onClose}
    >
      {body}
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  embedded: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  close: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  body: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.md },
  lead: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 15,
    marginBottom: 6,
  },
  cardBody: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  affiliate: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
});
