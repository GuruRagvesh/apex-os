// shared/ui — browser surface.
//
// Application-wide design-system primitives. Every export here is presentational:
// no API call, no store, no feature logic, and no dependency on a platform
// component. That is the bar for living in this module.

export { Breadcrumb } from './components/breadcrumb';
export { EmptyState } from './components/empty-state';
export { UserAvatar } from './components/user-avatar';
export { StagingBanner } from './components/staging-banner';

export { AnnouncementBroadcast } from './components/AnnouncementBroadcast';
export { CommandModal } from './components/CommandModal';
export { QuickActionPalette } from './components/QuickActionPalette';

export { default as CommandCard } from './components/CommandCard';
export { default as HoverPreview } from './components/HoverPreview';

export { KpiCapsuleStrip } from './components/KpiCapsuleStrip';
export { default as KpiCapsule } from './components/KpiCapsule';

// Unblocked once `cn` moved to shared/utilities — these three had it as their
// sole legacy dependency.
export {
  Skeleton, SkeletonTicketRow, SkeletonTicketRows, SkeletonStatCard, SkeletonStatCards,
  SkeletonKanbanCard, SkeletonKanbanColumn, SkeletonTicketDetail, CardSkeleton,
  TableRowSkeleton, TableRowSkeletons,
} from './components/skeleton';
export { MultiSelect } from './components/multi-select';
export { StatusBadge, PriorityBadge } from './components/status-badge';
