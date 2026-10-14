'use client';

import { useEffect, useRef } from 'react';
import { animate, splitText, stagger } from 'animejs';
import { Coffee, Play, UsersRound } from 'lucide-react';
import { ModalPortal } from '@/components/ui/ModalPortal';
import styles from './WorkPauseOverlay.module.css';

type WorkPauseOverlayProps = {
  kind: 'break' | 'meeting';
  elapsedMinutes: number;
  plannedMinutes?: number | null;
  resuming: boolean;
  onResume: () => void;
};

function elapsedLabel(minutes: number) {
  if (minutes < 1) return 'Just started';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m elapsed` : `${remainder} min elapsed`;
}

export function WorkPauseOverlay({ kind, elapsedMinutes, plannedMinutes, resuming, onResume }: WorkPauseOverlayProps) {
  const layerRef = useRef<HTMLElement | null>(null);
  const wordRef = useRef<HTMLHeadingElement | null>(null);
  const isMeeting = kind === 'meeting';

  useEffect(() => {
    const target = wordRef.current;
    if (!target) return;

    const split = splitText(target, {
      words: false,
      chars: { class: 'split-char' },
    });

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return () => split.revert();
    }

    const animation = animate(split.chars, {
      y: [
        { to: '-2.75rem', ease: 'outExpo', duration: 600 },
        { to: 0, ease: 'outBounce', duration: 800, delay: 100 },
      ],
      rotate: {
        from: '-1turn',
        delay: 0,
      },
      delay: stagger(50),
      ease: 'inOutCirc',
      loopDelay: 1000,
      loop: true,
    });

    return () => {
      animation.cancel();
      split.revert();
    };
  }, [kind]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const siblings = Array.from(document.body.children).filter((element) => element !== layer) as HTMLElement[];
    const previous = siblings.map((element) => ({ element, inert: element.inert }));
    siblings.forEach((element) => { element.inert = true; });
    return () => previous.forEach(({ element, inert }) => { element.inert = inert; });
  }, []);

  return (
    <ModalPortal>
      <section
        ref={layerRef}
        className={styles.layer}
        data-kind={kind}
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-pause-title"
        aria-describedby="work-pause-status"
      >
        <div className={styles.content}>
          <span className={styles.icon} aria-hidden="true">
            {isMeeting ? <UsersRound size={25} /> : <Coffee size={25} />}
          </span>
          <h2 ref={wordRef} id="work-pause-title" className={styles.word}>
            {isMeeting ? 'MEETING' : 'BREAK'}
          </h2>
          <p id="work-pause-status" className={styles.status}>
            {isMeeting ? 'Meeting in progress' : 'Workday paused'}
          </p>
          <p className={styles.timer}>
            {elapsedLabel(elapsedMinutes)}
            {!isMeeting && plannedMinutes ? ` · ${plannedMinutes} min planned` : ''}
          </p>
        </div>

        <button type="button" className={styles.resume} onClick={onResume} disabled={resuming} autoFocus>
          <Play size={17} fill="currentColor" aria-hidden="true" />
          {resuming ? 'Resuming…' : 'Resume Work'}
        </button>
      </section>
    </ModalPortal>
  );
}
