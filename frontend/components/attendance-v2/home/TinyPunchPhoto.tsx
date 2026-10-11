'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, ImageOff } from 'lucide-react';
import { ModalPortal } from '../../ui/ModalPortal';
import { getOwnPunchPhotoUrl } from '../../attendance/punch-photo-api';
import s from './home-calendar.module.css';

/**
 * A small round punch photo for a calendar cell.
 *
 * Same privacy rules as PunchPhoto: the signed URL is minted only when the
 * photo scrolls into view, is held in memory only, and is never persisted.
 * Clicking it opens a larger preview.
 */
export function TinyPunchPhoto({
  evidenceId,
  label,
  large = false,
}: {
  evidenceId: string | null;
  label: string;
  large?: boolean;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!evidenceId || visible) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '120px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [evidenceId, visible]);

  useEffect(() => {
    if (!visible || !evidenceId) return;
    let cancelled = false;
    getOwnPunchPhotoUrl(evidenceId)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [visible, evidenceId]);

  const className = [s.photo, large ? s.photoLarge : '', url ? s.photoButton : ''].join(' ');
  const icon = large ? 20 : 11;

  if (!evidenceId) {
    return <span ref={ref} className={className} title={`${label}: no photo`} aria-label={`${label}: no photo`}><Camera size={icon} aria-hidden="true" /></span>;
  }

  return (
    <>
      <span
        ref={ref}
        role={url ? 'button' : undefined}
        tabIndex={url ? 0 : undefined}
        className={className}
        title={label}
        aria-label={url ? `Enlarge ${label}` : label}
        onClick={(e) => { e.stopPropagation(); if (url) setZoomed(true); }}
        onKeyDown={(e) => { if (url && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); setZoomed(true); } }}
      >
        {url && !failed
          ? <img src={url} alt="" onError={() => setFailed(true)} />
          : failed ? <ImageOff size={icon} aria-hidden="true" /> : <Camera size={icon} aria-hidden="true" />}
      </span>
      {zoomed && url && (
        <ModalPortal>
          <div className={s.zoomBackdrop} onClick={() => setZoomed(false)} role="dialog" aria-label={label}>
            <figure className={s.zoom} onClick={(e) => e.stopPropagation()}>
              <img src={url} alt={label} />
              <p>{label}</p>
            </figure>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
