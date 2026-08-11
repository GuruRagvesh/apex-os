// Operations Tickets — lifecycle component public entry point.
//
// Scope today is the ticket visibility contract only: pure presentation helpers
// over a ticket's status. It defines NO transition rules — the allowed-status
// matrix lives solely in backend/src/common/services/ticket-access.service.ts
// (assertCanTransitionTicket).
//
// The Kanban screen HAS migrated, but it is published as the exact subpath
// './frontend/screens/KanbanScreen' rather than through this barrel: it pulls
// the ticket API, @dnd-kit and the auth boundary, none of which a consumer
// wanting a visibility helper should have to load.
//
// The remaining lifecycle screens (tickets list, ticket detail) have not migrated.

export * from './shared/ticket-visibility';
