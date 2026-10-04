# -*- coding: utf-8 -*-
"""Wire pitch commit URLs + reject same-slot into planPlacesResearch / runPlanningModule."""
from pathlib import Path

ROOT = Path(r"c:/Users/larsf/Findus 2.0")


def atomic_write(p: Path, text: str) -> None:
    tmp = p.with_suffix(p.suffix + ".tmpwrite")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(p)


def patch_places_research() -> None:
    p = ROOT / "src/module2/planning/planPlacesResearch.ts"
    t = p.read_text(encoding="utf-8")

    # 1) uiCards mapping: keep websiteUrl from pitch option
    old_map = """      actions: {
        mapsUrl: o.mapsUrl,
        menuStatus: (o.menuUrl ? 'READY' : 'SEARCHING') as
          | 'SEARCHING'
          | 'READY'
          | 'NONE',
        menuUrl: o.menuUrl ?? null,
        ticketUrl: o.ticketUrl ?? null,
        reserveUrl: null as string | null,
      },"""
    new_map = """      actions: {
        mapsUrl: o.mapsUrl,
        menuStatus: (o.menuUrl ? 'READY' : 'SEARCHING') as
          | 'SEARCHING'
          | 'READY'
          | 'NONE',
        menuUrl: o.menuUrl ?? null,
        websiteUrl: o.websiteUrl ?? null,
        ticketUrl: o.ticketUrl ?? null,
        reserveUrl: null as string | null,
      },"""
    if "websiteUrl: o.websiteUrl" not in t:
        assert old_map in t, "uiCards actions map"
        t = t.replace(old_map, new_map, 1)

    # 2) toCard: include websiteUrl + prefer card menuUrl
    old_tocard = """    const offer = resolveOfferAction(wish, c);
    const mapsUrl =
      c.actions.mapsUrl?.trim() ||
      mapsUrlFor(c.name, c.lat, c.lng, c.placeId);
    return {
      id: `choice_${stepKey}_${side}`,
      title: `${role === 'favorite' ? '🥇' : '🥈'} ${c.name}`,
      lat: c.lat,
      lng: c.lng,
      subtitle: normalizePlanBullets([...(c.bulletPoints ?? [])], 3).join('\\n'),
      bullets: normalizePlanBullets([...(c.bulletPoints ?? [])], 3),
      mapsUrl,
      menuUrl: offer?.url ?? null,
      placeId: c.placeId ?? null,
      proposalRole: role,
      actionCards: [
        { id: 'maps', label: '🗺️ Maps', url: mapsUrl },
        ...(offer
          ? [{ id: offer.id, label: offer.label, url: offer.url }]
          : []),
      ],
    };"""
    new_tocard = """    const offer = resolveOfferAction(wish, c);
    const mapsUrl =
      c.actions.mapsUrl?.trim() ||
      mapsUrlFor(c.name, c.lat, c.lng, c.placeId);
    const menuUrl =
      (c.actions.menuUrl && /^https?:\\/\\//i.test(c.actions.menuUrl)
        ? c.actions.menuUrl
        : null) ||
      offer?.url ||
      null;
    const websiteUrl =
      c.actions.websiteUrl && /^https?:\\/\\//i.test(c.actions.websiteUrl)
        ? c.actions.websiteUrl
        : null;
    return {
      id: `choice_${stepKey}_${side}`,
      title: `${role === 'favorite' ? '🥇' : '🥈'} ${c.name}`,
      lat: c.lat,
      lng: c.lng,
      subtitle: normalizePlanBullets([...(c.bulletPoints ?? [])], 3).join('\\n'),
      bullets: normalizePlanBullets([...(c.bulletPoints ?? [])], 3),
      mapsUrl,
      menuUrl,
      websiteUrl,
      placeId: c.placeId ?? null,
      proposalRole: role,
      actionCards: [
        { id: 'maps', label: '🗺️ Maps', url: mapsUrl },
        ...(offer
          ? [{ id: offer.id, label: offer.label, url: offer.url }]
          : menuUrl
            ? [{ id: 'menu', label: 'Speisekarte', url: menuUrl }]
            : []),
      ],
    };"""
    if "websiteUrl," not in t[t.find("const toCard") : t.find("const toCard") + 1200]:
        assert old_tocard in t, "toCard block"
        t = t.replace(old_tocard, new_tocard, 1)

    # 3) upsert choice_* stops: keep computed maps/menu/website
    old_upsert = """    const offer = resolveOfferAction(wish, card);
    useFuturePlanStore.getState().upsertStopOnDay(dayKey, {
      id,
      title: `${medal} ${card.name}`,
      lat: card.lat,
      lng: card.lng,
      plannedStartMs: startMs,
      plannedEndMs: hotelWish || startMs == null ? null : startMs + 60 * 60_000,
      bufferMin: 10,
      transport: 'walk',
      kind: 'stop',
      status: 'pending_change',
      planPriority: wish.priority,
      choiceSide: side,
      choiceGroupId: stepKey,
      planTaskId: stepKey,
      notes: [...noteLines, pitchLine].filter(Boolean).join('\\n'),
      mapsUrl: card.actions.mapsUrl,
      menuUrl: offer?.url ?? null,
      reserveUrl: card.actions.reserveUrl ?? null,
      emoji: medal,
      userFixedTime: wish.priority <= 2 && Boolean(wish.estimatedTime),
    });"""
    new_upsert = """    const offer = resolveOfferAction(wish, card);
    const mapsUrl =
      card.actions.mapsUrl?.trim() ||
      mapsUrlFor(card.name, card.lat, card.lng, card.placeId);
    const menuUrl =
      (card.actions.menuUrl && /^https?:\\/\\//i.test(card.actions.menuUrl)
        ? card.actions.menuUrl
        : null) ||
      offer?.url ||
      null;
    const websiteUrl =
      card.actions.websiteUrl &&
      /^https?:\\/\\//i.test(card.actions.websiteUrl)
        ? card.actions.websiteUrl
        : null;
    useFuturePlanStore.getState().upsertStopOnDay(dayKey, {
      id,
      title: `${medal} ${card.name}`,
      lat: card.lat,
      lng: card.lng,
      plannedStartMs: startMs,
      plannedEndMs: hotelWish || startMs == null ? null : startMs + 60 * 60_000,
      bufferMin: 10,
      transport: 'walk',
      kind: 'stop',
      status: 'pending_change',
      planPriority: wish.priority,
      choiceSide: side,
      choiceGroupId: stepKey,
      planTaskId: stepKey,
      notes: [...noteLines, pitchLine].filter(Boolean).join('\\n'),
      mapsUrl,
      menuUrl,
      websiteUrl,
      reserveUrl: card.actions.reserveUrl ?? null,
      emoji: medal,
      userFixedTime: wish.priority <= 2 && Boolean(wish.estimatedTime),
    });"""
    if "websiteUrl,\n      reserveUrl: card.actions.reserveUrl" not in t:
        assert old_upsert in t, "choice upsert"
        t = t.replace(old_upsert, new_upsert, 1)

    atomic_write(p, t)
    print("planPlacesResearch ok")


def patch_run_planning() -> None:
    p = ROOT / "src/module2/planning/runPlanningModule.ts"
    t = p.read_text(encoding="utf-8")

    # Import buildCommittedPlanStopFromPitchCard if missing
    if "buildCommittedPlanStopFromPitchCard" not in t:
        # add near other planning imports
        anchor = "import { setActiveTaskOverride } from './planSessionState';"
        if anchor not in t:
            raise SystemExit("import anchor missing")
        t = t.replace(
            anchor,
            anchor
            + "\nimport { buildCommittedPlanStopFromPitchCard, openWishesQueueAfterPitchReject } from './planPitchCommit';",
            1,
        )

    # passt / confirm yes with pending → pick favorite
    old_reject = """    if (
      /\\b(neu\\s*suchen|beides\\s*nicht|andere[sn]?|nochmal)\\b/i.test(text)
    ) {
      await handlePlanCalendarDirect({ kind: 'reject' });
      return { ok: true };
    }

    // Medaille / Option A/B"""
    new_reject = """    if (
      /\\b(neu\\s*suchen|beides\\s*nicht|andere[sn]?|nochmal)\\b/i.test(text)
    ) {
      await handlePlanCalendarDirect({ kind: 'reject' });
      return { ok: true };
    }

    // passt / ja → Favorit committen (URLs aus Pitch-Karte)
    if (pending) {
      try {
        const { isPlanConfirmYes } = require('./planConfirmAck') as {
          isPlanConfirmYes: (s: string) => boolean;
        };
        if (
          isPlanConfirmYes(text) ||
          /\\b(passt|nehme\\s+(die[sn]?|den)|die\\s+erste)\\b/i.test(text)
        ) {
          const title =
            pending.options.find((o) => o.id === pending.selectedOptionId)
              ?.title ?? pending.options[0]?.title;
          if (title) {
            await handlePlanCalendarDirect({ kind: 'pick', title });
            return { ok: true };
          }
        }
      } catch {
        /* soft */
      }
    }

    // Medaille / Option A/B"""
    if "nehme\\s+(die[sn]?|den)" not in t and "nehme\\s+(die[sn]?|den)" not in t:
        if old_reject not in t:
            raise SystemExit("reject/passt block missing")
        t = t.replace(old_reject, new_reject, 1)

    # reject handler: repitch flag + await + no duplicate wish
    old_h_reject = """  if (input.kind === 'reject') {
    if (session.waitingConflict) {
      session.resolveConflict(false);
      return true;
    }
    // Während Confirm: „Ändern“ → negativ auflösen (Orchestrator holt Amendment)
    if (session.waitingConfirm) {
      // Nur „Ändern“ tippen → nächste Runde fragt nach dem Inhalt
      session.setPendingAmendment(null);
      session.resolveConfirm(false);
      return true;
    }
    // „Neu suchen“ → Re-Research aktueller Wunsch
    const pending = usePlanCalendarUiStore.getState().pendingChoice;
    const stepKey = pending?.stepKey;
    clearChoiceStops(stepKey);
    usePlanCalendarUiStore.getState().clearPendingChoice();
    usePlanCalendarUiStore.getState().clearShortAnswers();
    usePlanCalendarUiStore.getState().clearMirroredActions();

    const wishStop = stepKey
      ? useFuturePlanStore.getState().plan.stops.find((s) => s.id === stepKey)
      : null;
    const sessionWish = usePlanSessionStore.getState().plan?.openWishesQueue.find(
      (w) => w.id === stepKey || w.title === stepKey,
    );
    const wish: IngestOpenWish | null = sessionWish
      ? sessionWish
      : wishStop
        ? {
            id: wishStop.id,
            title: wishStop.title,
            priority: (wishStop.planPriority === 4 ||
            wishStop.planPriority === 5 ||
            wishStop.planPriority === 6
              ? wishStop.planPriority
              : 5) as 4 | 5 | 6,
            context: wishStop.notes ?? wishStop.title,
            estimatedTime: null,
          }
        : null;
    if (wish) {
      void executeDeepResearchAndPitch(wish);
    }
    return true;
  }"""
    new_h_reject = """  if (input.kind === 'reject') {
    if (session.waitingConflict) {
      session.resolveConflict(false);
      return true;
    }
    // Während Confirm: „Ändern“ → negativ auflösen (Orchestrator holt Amendment)
    if (session.waitingConfirm) {
      // Nur „Ändern“ tippen → nächste Runde fragt nach dem Inhalt
      session.setPendingAmendment(null);
      session.resolveConfirm(false);
      return true;
    }
    // „Neu suchen“ → Re-Pitch SAME Slot (kein zweites Breakfast/Meal)
    const pending = usePlanCalendarUiStore.getState().pendingChoice;
    const stepKey = pending?.stepKey;
    const wishStop = stepKey
      ? useFuturePlanStore.getState().plan.stops.find((s) => s.id === stepKey)
      : null;
    const sessionWish = usePlanSessionStore.getState().plan?.openWishesQueue.find(
      (w) => w.id === stepKey || w.title === stepKey,
    );
    const wish: IngestOpenWish | null = sessionWish
      ? sessionWish
      : wishStop
        ? {
            id: wishStop.id,
            title: wishStop.title,
            priority: (wishStop.planPriority === 4 ||
            wishStop.planPriority === 5 ||
            wishStop.planPriority === 6
              ? wishStop.planPriority
              : 5) as 4 | 5 | 6,
            context: wishStop.notes ?? wishStop.title,
            estimatedTime: null,
          }
        : null;
    if (wish && stepKey) {
      try {
        usePlanSessionStore.getState().setRepitchingStepKey(stepKey);
      } catch {
        /* soft */
      }
      // Queue: gleiche Wish-Identitaet behalten (kein Duplikat)
      try {
        const plan = usePlanSessionStore.getState().plan;
        if (plan) {
          usePlanSessionStore.getState().setPlan({
            ...plan,
            openWishesQueue: openWishesQueueAfterPitchReject(
              plan.openWishesQueue,
              wish,
            ),
          });
        }
      } catch {
        /* soft */
      }
    }
    clearChoiceStops(stepKey);
    usePlanCalendarUiStore.getState().clearPendingChoice();
    usePlanCalendarUiStore.getState().clearShortAnswers();
    usePlanCalendarUiStore.getState().clearMirroredActions();
    if (wish) {
      try {
        await executeDeepResearchAndPitch(wish);
      } finally {
        try {
          usePlanSessionStore.getState().setRepitchingStepKey(null);
        } catch {
          /* soft */
        }
      }
    } else {
      try {
        usePlanSessionStore.getState().setRepitchingStepKey(null);
      } catch {
        /* soft */
      }
    }
    return true;
  }"""
    if "setRepitchingStepKey(stepKey)" not in t:
        assert old_h_reject in t, "handle reject"
        t = t.replace(old_h_reject, new_h_reject, 1)

    # accept/confirm with pending → pick (preserve URLs via pick path)
    old_accept = """  if (input.kind === 'confirm' || input.kind === 'accept') {
    if (session.waitingConflict) {
      session.resolveConflict(true);
      return true;
    }
    if (session.waitingConfirm) {
      session.resolveConfirm(true);
      return true;
    }
    usePlanCalendarUiStore.getState().clearPendingChoice();
    usePlanCalendarUiStore.getState().clearShortAnswers();
    return true;
  }"""
    new_accept = """  if (input.kind === 'confirm' || input.kind === 'accept') {
    if (session.waitingConflict) {
      session.resolveConflict(true);
      return true;
    }
    if (session.waitingConfirm) {
      session.resolveConfirm(true);
      return true;
    }
    // Pitch-Auswahl bestaetigen (passt) → Favorit/Selection committen inkl. URLs
    const pendingAccept = usePlanCalendarUiStore.getState().pendingChoice;
    if (pendingAccept) {
      const sel =
        pendingAccept.options.find(
          (o) => o.id === pendingAccept.selectedOptionId,
        ) ?? pendingAccept.options[0];
      if (sel?.title) {
        return handlePlanCalendarDirect({
          kind: 'pick',
          title: sel.title,
          stopId: sel.id,
        });
      }
    }
    usePlanCalendarUiStore.getState().clearPendingChoice();
    usePlanCalendarUiStore.getState().clearShortAnswers();
    return true;
  }"""
    if "pendingAccept" not in t:
        assert old_accept in t, "accept block"
        t = t.replace(old_accept, new_accept, 1)

    # pick: use buildCommittedPlanStopFromPitchCard
    old_pick_upsert = """    useFuturePlanStore.getState().upsertStopOnDay(dayKey, {
      id: committedId,
      title: cleanTitle,
      lat,
      lng,
      plannedStartMs: startMs,
      plannedEndMs:
        isHotelPick || startMs == null ? null : startMs + 60 * 60_000,
      bufferMin: 10,
      transport: 'walk',
      kind: 'stop',
      status: 'planned',
      planPriority: 4,
      mapsUrl: choiceStop?.mapsUrl ?? opt?.mapsUrl ?? null,
      menuUrl: choiceStop?.menuUrl ?? opt?.menuUrl ?? null,
      reserveUrl:
        choiceStop?.reserveUrl ??
        (/friseur|haar|salon|barber/i.test(cleanTitle)
          ? `https://www.google.com/search?q=${encodeURIComponent(`${cleanTitle} Termin buchen`)}`
          : /essen|restaurant|burger|pizza|café|cafe|osteria|trattoria/i.test(
                cleanTitle,
              )
            ? `https://www.google.com/search?q=${encodeURIComponent(`${cleanTitle} Tisch reservieren`)}`
            : null),
      notes: choiceStop?.notes,
      emoji: '📍',
      planTaskId: groupId,
      userFixedTime: false,
    });"""
    new_pick_upsert = """    const sessionWishForCommit =
      groupId
        ? usePlanSessionStore.getState().plan?.openWishesQueue.find(
            (w) => w.id === groupId || w.title === groupId,
          )
        : null;
    const committed = buildCommittedPlanStopFromPitchCard(
      {
        name: cleanTitle,
        lat,
        lng,
        placeId: choiceStop?.placeId ?? opt?.placeId ?? null,
        mapsUrl: choiceStop?.mapsUrl ?? opt?.mapsUrl ?? null,
        menuUrl: choiceStop?.menuUrl ?? opt?.menuUrl ?? null,
        websiteUrl: choiceStop?.websiteUrl ?? opt?.websiteUrl ?? null,
        reserveUrl: choiceStop?.reserveUrl ?? null,
        notes: choiceStop?.notes ?? null,
        bullets: opt?.bullets ?? null,
      },
      {
        id: groupId,
        title: sessionWishForCommit?.title ?? cleanTitle,
        priority: (sessionWishForCommit?.priority ??
          choiceStop?.planPriority ??
          4) as 4 | 5 | 6,
        estimatedTime: sessionWishForCommit?.estimatedTime ?? null,
      },
      dayKey,
      {
        committedId,
        startMs,
        isHotel: isHotelPick,
        cleanTitle,
      },
    );
    if (!committed.reserveUrl) {
      committed.reserveUrl =
        (/friseur|haar|salon|barber/i.test(cleanTitle)
          ? `https://www.google.com/search?q=${encodeURIComponent(`${cleanTitle} Termin buchen`)}`
          : /essen|restaurant|burger|pizza|café|cafe|osteria|trattoria/i.test(
                cleanTitle,
              )
            ? `https://www.google.com/search?q=${encodeURIComponent(`${cleanTitle} Tisch reservieren`)}`
            : null);
    }
    useFuturePlanStore.getState().upsertStopOnDay(dayKey, committed);"""
    if "buildCommittedPlanStopFromPitchCard(" not in t.split("if (input.kind === 'pick'")[1][:2500]:
        assert old_pick_upsert in t, "pick upsert"
        t = t.replace(old_pick_upsert, new_pick_upsert, 1)

    atomic_write(p, t)
    print("runPlanningModule ok")


def patch_publish_pitch_ui() -> None:
    p = ROOT / "src/module2/pitch/publishPitchUi.ts"
    t = p.read_text(encoding="utf-8")
    old = """      notes: noteLines.join('\\n'),
      mapsUrl: card.mapsUrl,
      menuUrl: card.menuUrl ?? null,
      emoji: medal,
      userFixedTime: startMs != null,
    });"""
    new = """      notes: noteLines.join('\\n'),
      mapsUrl: card.mapsUrl,
      menuUrl: card.menuUrl ?? null,
      websiteUrl: card.websiteUrl ?? null,
      emoji: medal,
      userFixedTime: startMs != null,
    });"""
    if "websiteUrl: card.websiteUrl" not in t:
        assert old in t, "publishPitchToTimeline upsert"
        atomic_write(p, t.replace(old, new, 1))
    print("publishPitchUi ok")


def main() -> None:
    patch_places_research()
    patch_run_planning()
    patch_publish_pitch_ui()


if __name__ == "__main__":
    main()
