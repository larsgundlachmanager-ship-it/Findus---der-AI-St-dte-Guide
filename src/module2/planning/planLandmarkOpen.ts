/**
 * Offene Landmarke (Michel): Ticket/Uhrzeit noch nicht fest — nachfragen beim Weitergehen.
 */

type OpenLandmark = {
  title: string;
  ticketPending: boolean;
  timePending: boolean;
};

let open: OpenLandmark | null = null;

export function setOpenLandmarkTicket(title: string): void {
  open = {
    title: (title || 'Landmarke').trim(),
    ticketPending: true,
    timePending: true,
  };
}

export function markLandmarkTicketResolved(opts?: {
  bought?: boolean;
  declined?: boolean;
  timeHm?: string | null;
}): void {
  if (!open) return;
  if (opts?.bought || opts?.declined) open.ticketPending = false;
  if (opts?.timeHm || opts?.declined) open.timePending = false;
  if (!open.ticketPending && !open.timePending) open = null;
}

export function clearOpenLandmarkTicket(): void {
  open = null;
}

export function peekOpenLandmarkTicket(): OpenLandmark | null {
  return open ? { ...open } : null;
}

/** Speech wenn User weitergeht, ohne Ticket/Zeit zu klären. */
export function openLandmarkFollowUpSpeech(): string | null {
  if (!open || (!open.ticketPending && !open.timePending)) return null;
  const n = open.title;
  if (open.ticketPending && open.timePending) {
    return `Kurz zu ${n}: Hast du das Ticket schon gekauft — und hast du eine Uhrzeit, damit ich ihn fest einplanen kann? Oder willst du da gar nicht mehr hin?`;
  }
  if (open.ticketPending) {
    return `Noch offen: Hast du das Ticket für ${n} gekauft, oder soll der Punkt offen bleiben?`;
  }
  return `Noch offen: Wann genau willst du zu ${n}? Dann trage ich die Uhrzeit fest ein.`;
}
