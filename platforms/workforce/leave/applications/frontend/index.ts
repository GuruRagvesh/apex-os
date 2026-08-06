// Workforce Leave — applications frontend surface.
//
// Only the route-level screen is published. LeavesApprover is component-internal
// and deliberately not re-exported: nothing outside this component consumes it,
// and publishing it would pull it into every consumer of the barrel.

export { default as LeaveScreen } from './screens/LeaveScreen';
