// Sales CRM Leads — shared surface.
//
// Types and pure helpers usable by both the frontend and, in Phase 1B, the
// backend of this component. Nothing here imports React or Nest.

export { STAGE_FORMS } from './types/stage-forms';
export type {
  StageFieldType,
  StageFieldConfig,
  ScheduledActionConfig,
  StageFormConfig,
} from './types/stage-forms';

export {
  getLocalTodayISO,
  getLocalTomorrowISO,
  isStrictFutureDate,
  isTodayOrPastDate,
} from './types/date-utils';
