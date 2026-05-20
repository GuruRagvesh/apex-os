'use client';

interface Props { onDismiss: () => void; }

export function IdleWarningToast({ onDismiss }: Props) {
  return (
    <div className="fixed bottom-6 right-6 z-50 bg-white dark:bg-gray-900 border border-yellow-300 dark:border-yellow-700 rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 max-w-sm">
      <span className="text-yellow-500 text-lg flex-shrink-0">&#128164;</span>
      <p className="text-sm text-gray-700 dark:text-gray-300 flex-1">
        You appear inactive - still working?
      </p>
      <button
        onClick={onDismiss}
        className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex-shrink-0"
      >
        Yes, I&apos;m here
      </button>
    </div>
  );
}
