import type { Module2Agent } from './types';
import { agentPromptLaws } from '../laws/lawLayers';
import { anchorCoords } from '../rucksack/rucksackStore';
import { handleEmergencyConcierge } from '../../services/concierge/emergencyConcierge';
import { resolveCountryEmergencyInfo } from '../../services/concierge/emergencyNumbersByCountry';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';

/**
 * Notfall-/Arzt-Agent — echte Nähe-Suche (Praxis/Klinik/Apotheke),
 * keine Navigation zum eigenen GPS, landestypische Notruf-tel:-Ziele.
 */
export const emergencyAgent: Module2Agent = {
  id: 'emergency',
  intents: ['emergency'],
  async run({ task, rucksack }) {
    void agentPromptLaws('emergency');
    const a = anchorCoords(rucksack);
    const isToilet = /\b(toilette|wc|klo)\b/i.test(task.rewrittenText);

    const origin =
      Number.isFinite(a.lat) && Number.isFinite(a.lng)
        ? { lat: a.lat, lng: a.lng }
        : null;

    if (isToilet) {
      const info = await resolveCountryEmergencyInfo({
        lat: origin?.lat,
        lng: origin?.lng,
      });
      const sos = info.primary.number;
      return {
        agent: 'emergency',
        ok: true,
        draftText: `Ruhig bleiben — ich priorisiere die nächste Toilette. Bei Notfall bleibt ${sos}. Ich rufe nicht selbst an.`,
        bullets: [
          `Notruf ${info.countryLabel}: ${sos}`,
          'Nächste Toilette priorisiert',
        ].slice(0, 3),
        buttons: [
          {
            id: 'dial_sos',
            label: shortenActionLabel(`📞 Notruf ${sos}`),
            payload: { kind: 'dial', phone: sos },
          },
        ],
        meta: { bypass: true },
      };
    }

    // Gleiche SSOT wie Intent-Frühpfad — konkrete Orte + Buttons
    const em = await handleEmergencyConcierge(task.rewrittenText, origin);
    const info = await resolveCountryEmergencyInfo({
      lat: origin?.lat,
      lng: origin?.lng,
    });
    const sos = info.primary.number;
    const speech =
      em.concierge?.speechText?.trim() ||
      em.reply?.trim() ||
      `Ruhig bleiben. Bei Lebensgefahr ${sos}. Ich suche den nächsten Arzt.`;

    const bullets = (em.concierge?.visualBullets ?? []).slice(0, 3);
    if (!bullets.length) {
      bullets.push(`Notruf ${info.countryLabel}: ${sos}`);
      if (info.medicalAdvice) {
        bullets.push(
          `${info.medicalAdvice.label}: ${info.medicalAdvice.number}`,
        );
      }
    }

    const buttons =
      em.concierge?.quickActions?.slice(0, 4).map((qa, i) => {
        if (qa.type === 'DIAL_PHONE' && qa.payload.phoneNumber) {
          return {
            id: `dial_${i}`,
            label: qa.label,
            payload: { kind: 'dial' as const, phone: qa.payload.phoneNumber },
          };
        }
        if (
          qa.type === 'START_NAVIGATION' &&
          qa.payload.destLat != null &&
          qa.payload.destLng != null
        ) {
          return {
            id: `nav_${i}`,
            label: qa.label,
            payload: {
              kind: 'navigate' as const,
              lat: qa.payload.destLat,
              lng: qa.payload.destLng,
              label: qa.payload.destName ?? qa.label,
              keepCard: true,
              skipClosingGate: true,
            },
          };
        }
        return {
          id: `act_${i}`,
          label: qa.label,
          payload: { kind: 'deep_link' as const, url: qa.payload.url ?? '' },
        };
      }) ?? [
        {
          id: 'dial_sos',
          label: shortenActionLabel(`📞 Notruf ${sos}`),
          payload: { kind: 'dial' as const, phone: sos },
        },
        ...(info.medicalAdvice
          ? [
              {
                id: 'dial_advice',
                label: shortenActionLabel(`📞 ${info.medicalAdvice.number}`),
                payload: {
                  kind: 'dial' as const,
                  phone: info.medicalAdvice.number,
                },
              },
            ]
          : []),
      ];

    const emMeta = em.meta ?? {};
    return {
      agent: 'emergency',
      ok: true,
      draftText: speech,
      bullets,
      buttons: buttons.filter((b) => {
        if (b.payload.kind === 'deep_link' && !b.payload.url) return false;
        return true;
      }),
      meta: {
        bypass: true,
        emergencyHandled: em.handled,
        hoursChecked: Boolean(emMeta.hoursChecked),
        openNow: emMeta.openNow ?? null,
        specialty: emMeta.specialty ?? null,
        skippedVacation: emMeta.skippedVacation ?? [],
        alternative: (emMeta.skippedVacation?.length ?? 0) > 0,
      },
    };
  },
};
