'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, Pause, Play, Volume2 } from 'lucide-react';
import { cn } from '@apex/shared-utilities';

export const DEFAULT_BREAK_SOUND = 'apex-break';

export const BREAK_SOUNDS = [
  // seconds: length of one play; the server uses the same values to time alarm rounds.
  { id: 'apex-break', name: 'Apex Break', description: 'A clear, steady break alarm', src: '/sounds/apex-break.mp3', seconds: 10.1 },
  { id: 'chicken-call', name: 'Chicken Call', description: 'A lively, attention-grabbing alert', src: '/sounds/chicken-call.mp3', seconds: 5.7 },
  { id: 'fahhh', name: 'Fahhh', description: 'A short, playful reminder', src: '/sounds/fahhh.mp3', seconds: 2.7 },
] as const;

export type BreakSoundId = typeof BREAK_SOUNDS[number]['id'];

export function isBreakSoundId(value: unknown): value is BreakSoundId {
  return BREAK_SOUNDS.some((sound) => sound.id === value);
}

export function breakSoundSource(value: unknown): string {
  return BREAK_SOUNDS.find((sound) => sound.id === value)?.src ?? BREAK_SOUNDS[0].src;
}

export function breakSoundSeconds(value: unknown): number {
  return BREAK_SOUNDS.find((sound) => sound.id === value)?.seconds ?? BREAK_SOUNDS[0].seconds;
}

export function BreakSoundPicker({
  value,
  onChange,
  constrained = false,
}: {
  value: BreakSoundId;
  onChange: (value: BreakSoundId) => void;
  /** Settings has a navigation rail beside it, so it needs a later 3-column breakpoint. */
  constrained?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<BreakSoundId | null>(null);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  const preview = (sound: typeof BREAK_SOUNDS[number]) => {
    if (playing === sound.id) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(sound.src);
    audioRef.current = audio;
    setPlaying(sound.id);
    audio.addEventListener('ended', () => setPlaying(null), { once: true });
    void audio.play().catch(() => setPlaying(null));
  };

  return (
    <div className={cn('grid gap-3', constrained ? 'lg:grid-cols-3' : 'sm:grid-cols-3')} role="radiogroup" aria-label="Break warning sound">
      {BREAK_SOUNDS.map((sound) => {
        const selected = value === sound.id;
        const isPlaying = playing === sound.id;
        return (
          <div
            key={sound.id}
            className={cn('rounded-card border p-4 transition-colors', selected && 'ring-2 ring-offset-2')}
            style={{
              borderColor: selected ? 'var(--accent)' : 'var(--border-primary)',
              backgroundColor: selected ? 'var(--accent-subtle)' : 'var(--surface-card)',
              ...(selected ? { '--tw-ring-color': 'var(--accent)', '--tw-ring-offset-color': 'var(--surface-card)' } as CSSProperties : {}),
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--surface-sunken)', color: 'var(--accent-text)' }}>
                <Volume2 size={20} aria-hidden="true" />
              </span>
              {selected && <Check size={20} style={{ color: 'var(--success-text)' }} aria-label="Selected" />}
            </div>
            <p className="mt-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{sound.name}</p>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{sound.description}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" className="apex-btn apex-btn-secondary min-w-0 flex-1 px-2 text-xs" onClick={() => preview(sound)}>
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                {isPlaying ? 'Stop' : 'Preview'}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                className="apex-btn apex-btn-primary min-w-0 flex-1 px-2 text-xs"
                onClick={() => onChange(sound.id)}
              >
                {selected ? 'Selected' : 'Choose'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
