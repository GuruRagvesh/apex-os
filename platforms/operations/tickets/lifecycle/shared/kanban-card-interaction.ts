// Operations Tickets — Kanban card interaction rules.
//
// A card opens its ticket on a plain click or Enter. A REVIEW card is decided
// only on the ticket page (Start Review, Approve, Send Back, View Only and the
// attachment evidence), so the board offers no generic drag, Back or Move for
// it. These are UI affordances only: the backend remains the authority on
// every transition and refuses review moves without a recorded decision.

/** Lanes whose cards never move from the board itself. */
export const KANBAN_LOCKED_LANES: readonly string[] = ['REVIEW'];

/** Clicks this soon after a drag ends belong to the drop, not to the card. */
export const KANBAN_DROP_CLICK_GUARD_MS = 300;

export function isKanbanLaneLocked(columnKey: string | null | undefined): boolean {
  return !!columnKey && KANBAN_LOCKED_LANES.includes(columnKey);
}

/** Whether the board may move a card out of this lane (drag or Back/Move). */
export function canMoveFromKanbanLane(columnKey: string | null | undefined, canMoveCard: boolean): boolean {
  return canMoveCard && !isKanbanLaneLocked(columnKey);
}

export function kanbanCardHref(ticketId: string): string {
  return `/tickets/${ticketId}`;
}

/** A click opens the ticket unless it is the tail of a drag that just ended. */
export function shouldOpenKanbanCardOnClick(now: number, lastDragEndedAt: number): boolean {
  return now - lastDragEndedAt >= KANBAN_DROP_CLICK_GUARD_MS;
}

export function isKanbanCardOpenKey(key: string): boolean {
  return key === 'Enter';
}
