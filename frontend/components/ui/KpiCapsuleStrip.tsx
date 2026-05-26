'use client';

import React from 'react';
import { KpiCapsule, KpiCapsuleProps } from './KpiCapsule';

interface KpiCapsuleStripProps {
  capsules: KpiCapsuleProps[];
  className?: string;
}

export function KpiCapsuleStrip({ capsules, className = '' }: KpiCapsuleStripProps) {
  if (!capsules || capsules.length === 0) return null;

  return (
    <div className={`grid gap-3 ${className}`} style={{ gridTemplateColumns: `repeat(${Math.min(capsules.length, 4)}, 1fr)` }}>
      {capsules.map((capsule, i) => (
        <KpiCapsule key={i} {...capsule} />
      ))}
    </div>
  );
}
