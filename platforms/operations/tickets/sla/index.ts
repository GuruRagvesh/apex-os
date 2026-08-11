// Operations Tickets — SLA component public entry point.
//
// This component owns the FRONTEND PRESENTATION of ticket timing. It computes
// no SLA: backend/src/common/services/ticket-timing.service.ts remains the sole
// authority, and computeClientTimingState() renders the state that backend
// returns on the ticket.
//
// This barrel publishes the pure timing contract only. OverdueTicker is a React
// component and is published by exact subpath instead, so a consumer that wants
// the contract does not also load React presentation.

export * from './shared/ticket-timing';
