'use client';

// shared/remediation — the screen-side hook (Phase 1, spec §11.1).
//
//   const remediation = useRemediation();
//   ...
//   onError: (err) => { if (remediation.openFrom(err)) return; toast.error(...) }
//   ...
//   <RemediationDialog {...remediation.dialogProps} runAction={runner} />
//
// openFrom() returns true for a remediation error, so the caller skips its
// generic toast. It never resets the caller's form: the dialog is a sibling
// layer and the form underneath keeps every value.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RemediationResult, toRemediation } from '../shared/remediation-contract';

const CONTROL = 'button, [role="button"], input[type="submit"], a[href]';

export function useRemediation() {
  const [result, setResult] = useState<RemediationResult | null>(null);
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  // The control the person last pressed. A submit button is often disabled
  // while its request runs, which drops focus to <body>; this keeps the exact
  // control so focus can return to it when the dialog closes.
  const lastPressed = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const remember = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.(CONTROL) as HTMLElement | null;
      if (el && !el.closest('[data-testid="remediation-dialog"]')) lastPressed.current = el;
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') remember(e); };
    document.addEventListener('pointerdown', remember, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', remember, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const openWith = useCallback((r: RemediationResult, returnFocusTo?: HTMLElement | null) => {
    const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const focused = active && active !== document.body ? active : null;
    setTrigger(returnFocusTo ?? focused ?? lastPressed.current);
    setResult(r);
    setOpen(true);
  }, []);

  const openFrom = useCallback((err: unknown, returnFocusTo?: HTMLElement | null): boolean => {
    const r = toRemediation(err);
    if (!r) return false;
    openWith(r, returnFocusTo);
    return true;
  }, [openWith]);

  const close = useCallback(() => setOpen(false), []);

  const dialogProps = useMemo(() => ({
    result,
    open,
    onClose: close,
    onResult: setResult,
    returnFocusTo: trigger,
  }), [result, open, close, trigger]);

  return { result, open, openFrom, openWith, close, dialogProps };
}
