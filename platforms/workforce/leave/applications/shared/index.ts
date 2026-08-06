// Workforce Leave — framework-independent surface.
//
// Domain contracts usable by both the frontend and, later, the backend of this
// component. Nothing here imports React or Nest.

export type {
  LeaveStatus,
  LeaveType,
  LeaveRequest,
  LeaveStats,
} from './contracts/leave.types';
