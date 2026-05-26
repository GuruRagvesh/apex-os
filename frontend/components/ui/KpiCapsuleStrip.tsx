'use client';

import React from 'react';
import KpiCapsule, { KpiCapsuleProps } from './KpiCapsule';

interface KpiCapsuleStripProps {
  capsules: KpiCapsuleProps[];
  className?: string;
}

export function KpiCapsuleStrip({ capsules, className = '' }: KpiCapsuleStripProps) {
  if (!capsules || capsules.length === 0) return null;

  return (
    <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${className}`}>
      {capsules.map((capsule, i) => (
        <KpiCapsule key={i} {...capsule} />
      ))}
    </div>
  );
}
