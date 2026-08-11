// Operations Tickets — lifecycle component public entry point.
//
// Scope today is the ticket visibility contract only: pure presentation helpers
// over a ticket's status. It defines NO transition rules — the allowed-status
// matrix lives solely in backend/src/common/services/ticket-access.service.ts
// (assertCanTransitionTicket).
//
// The lifecycle SCREENS (tickets list, ticket detail, kanban) have not migrated.

export * from './shared/ticket-visibility';
