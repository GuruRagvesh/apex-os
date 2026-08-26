'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders a modal into document.body instead of where it is written.
 *
 * WHY THIS EXISTS
 * ---------------
 * `position: fixed` is normally relative to the viewport — but a transformed
 * ancestor becomes the containing block for its fixed descendants, and then
 * `fixed inset-0` covers only that ancestor.
 *
 * WorkdayBar renders inside a `motion.section` on the dashboard, and Framer
 * Motion applies a transform to animate it. So every modal opened from
 * WorkdayBar was positioned against that section rather than the screen: the
 * employee clicked Start Work and had to scroll down the page to find the
 * punch dialog. The same is true of `filter`, `perspective`, `contain` and
 * `will-change`, so removing one animation would not reliably fix it either.
 *
 * A portal to `document.body` escapes the transformed ancestor entirely, which
 * makes the modal immune to whatever wrapping it later ends up inside.
 *
 * Background scrolling is locked while the modal is open, so the page behind
 * cannot drift under the dialog.
 */
export function ModalPortal({ children }: { children: React.ReactNode }) {
  // document does not exist during the server render, so the portal can only
  // be created after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      // Restore whatever was there before rather than assuming '', so nesting
      // or a page that sets its own overflow is not clobbered.
      document.body.style.overflow = previous;
    };
  }, []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}
