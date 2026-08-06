interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <span className="text-5xl mb-4 select-none" role="img" aria-label={title}>{icon}</span>
      <h3 className="text-base font-bold text-slate-800 mb-1.5">{title}</h3>
      <p className="text-sm text-slate-500 max-w-xs leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
