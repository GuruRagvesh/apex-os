'use client';

/**
 * StagingBanner
 *
 * Renders a persistent top-of-screen banner ONLY when
 * NEXT_PUBLIC_APP_ENV === "staging".
 *
 * - Invisible in production and development.
 * - Mounted in the root layout so it is always visible, regardless of route.
 * - Zero impact on production bundle (early return).
 * - Matches the Apex OS design system: uses CSS variables and Tailwind tokens.
 *
 * Stage 0.5 requirement: visible environment indicator per the
 * APEX_OS_STABILIZATION_MASTER_PROMPT staging acceptance check.
 */

const APP_ENV = process.env.NEXT_PUBLIC_APP_ENV ?? 'development';

export function StagingBanner() {
  if (APP_ENV !== 'staging') return null;

  return (
    <div
      role="banner"
      aria-label="Staging environment indicator"
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 bg-amber-500 text-amber-950 text-[11px] font-black uppercase tracking-widest py-1.5 px-4 select-none shadow-md"
    >
      <span className="flex items-center gap-1.5">
        {/* Pulsing dot */}
        <span className="w-2 h-2 rounded-full bg-amber-900 animate-pulse shrink-0" />
        <span>STAGING ENVIRONMENT — NOT PRODUCTION — DATA MAY BE RESET AT ANY TIME</span>
        <span className="w-2 h-2 rounded-full bg-amber-900 animate-pulse shrink-0" />
      </span>
    </div>
  );
}
