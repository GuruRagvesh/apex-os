export function HomeSkeleton() {
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '24px 0' }}>
        <div>
          <div style={{ width: 220, height: 24, borderRadius: 6, background: 'var(--bg-tertiary)', marginBottom: 8 }} className="animate-pulse" />
          <div style={{ width: 160, height: 14, borderRadius: 4, background: 'var(--bg-tertiary)' }} className="animate-pulse" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[1,2,3,4].map(i => <div key={i} style={{ width: 100, height: 34, borderRadius: 8, background: 'var(--bg-tertiary)' }} className="animate-pulse" />)}
      </div>
      <div style={{ height: 120, borderRadius: 12, background: 'var(--bg-tertiary)', marginBottom: 16 }} className="animate-pulse" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[1,2,3,4].map(i => <div key={i} style={{ height: 80, borderRadius: 12, background: 'var(--bg-tertiary)' }} className="animate-pulse" />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ height: 200, borderRadius: 12, background: 'var(--bg-tertiary)' }} className="animate-pulse" />
        <div style={{ height: 200, borderRadius: 12, background: 'var(--bg-tertiary)' }} className="animate-pulse" />
      </div>
    </div>
  );
}
