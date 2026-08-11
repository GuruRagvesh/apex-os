import { formatRelativeTime, getInitials } from '@apex/shared-utilities';

const ACTION_LABELS: Record<string, string> = {
  CREATED: 'created',
  UPDATED: 'updated',
  COMMENTED: 'commented on',
  CLOSED: 'closed',
  ASSIGNED: 'assigned',
};

export function ActivityItem({ item }: { item: any }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-blue-700 text-xs font-semibold">{getInitials(item.user?.name || 'U')}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-700">
          <span className="font-medium">{item.user?.name}</span>
          {' '}{ACTION_LABELS[item.action] || item.action.toLowerCase()}{' '}
          <span className="font-medium">{item.entityType.toLowerCase()}</span>
          {item.details?.ticketId && <span className="text-blue-600"> #{item.details.ticketId}</span>}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">{formatRelativeTime(item.createdAt)}</p>
      </div>
    </div>
  );
}
