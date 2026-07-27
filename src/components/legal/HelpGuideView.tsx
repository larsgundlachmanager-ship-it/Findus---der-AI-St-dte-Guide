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
};

const SECTIONS: Section[] = [
  {
    title: 'Navigation & Bedienung',
    body:
      'Auf dem Hauptbildschirm siehst du deine Tour. Über das Zahnrad öffnest du die Einstellungen. ' +
      'Das Mikrofon unten ist dein direkter Draht zu Findus: kurz tippen zum Tippen einer Frage, ' +
      'gedrückt halten und sprechen für Spracheingabe.',
  },
  {
    title: 'Rückfragen & Alternativen',
    body:
      'Während einer Erklärung oder danach: Mikrofon tippen oder halten und z. B. fragen „Erzähl mehr“, ' +
      '„Gibt es eine Alternative?“, „Was ist in der Nähe?“ oder „Wie komme ich hin?“. ' +
      'Findus antwortet im Kontext deines Ortes und deiner Präferenzen.',
  },
  {
    title: 'Routenplanung',
    body:
      'Bitte Findus um eine Route oder Navigation zu einem Ziel. ' +
      'Du erhältst Distanz, Richtungshinweise und kannst die Navigation starten oder wechseln.',
  },
  {
    title: 'Aktivitäten & Touren',
    body:
      'Empfehlungen für Erlebnisse und Tickets kommen u. a. über Partner wie GetYourGuide und Viator. ' +
      'In der Concierge-Karte kannst du passende Angebote öffnen und buchen.',
  },
  {
    title: 'Unterkünfte',
    body:
      'Hotel- und Unterkunftsvorschläge können über Stay22 geöffnet werden — passend zu Stadt und Zeitraum.',
  },
  {
    title: 'Mietwagen',
    body:
      'Brauchst du ein Auto vor Ort, zeigt Findus Optionen über Mietwagen-Partner und leitet dich zur Buchung weiter.',
  },
  {
    title: 'Gepäckaufbewahrung',
    body:
      'Über Bounce findest du Schließfächer und Gepäckaufbewahrung in der Nähe — praktisch zwischen Check-out und Abreise.',
  },
  {
    title: 'Taxi & Fahrten',
    body:
      'Für kurze Strecken kann Findus eine Fahrt (z. B. Uber) vorschlagen und den Buchungslink öffnen.',
  },
  {
    title: 'Persönliches Profil',
    body:
      'Unter Einstellungen → Einrichtung passt du Stimme, Charakter, Interessen und Stadt an. ' +
      'Je genauer dein Profil, desto treffsicherer die Empfehlungen.',
  },
  {
    title: 'KI-Transparenz',
    body: AI_TRANSPARENCY_NOTICE,
  },
];

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
            Findus ist dein KI-Reise-Concierge: vor Ort erzählen, Fragen
            beantworten und passende Buchungen vorschlagen.
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
    return <View style={styles.embeddedRoot}>{body}</View>;
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent={Platform.OS === 'android'}
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>{body}</View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  embeddedRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    zIndex: 40,
    elevation: 40,
  },
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
    marginRight: spacing.sm,
  },
  close: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  body: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
    gap: spacing.sm,
  },
  lead: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  card: {
    borderRadius: 12,
    padding: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(196, 163, 90, 0.28)',
  },
  cardTitle: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  cardBody: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  affiliate: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontStyle: 'italic',
  },
});
