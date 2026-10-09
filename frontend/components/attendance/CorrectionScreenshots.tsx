'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { getCorrectionScreenshot, type CorrectionScreenshot } from './regularization-api';
const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export function CorrectionScreenshotPicker({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled: boolean }) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  return <fieldset disabled={disabled} className="mt-4 rounded-lg border border-[var(--border-secondary)] p-3">
    <legend className="apex-text px-1 text-sm font-semibold">Attach screenshots (optional)</legend>
    <p id={id + '-hint'} className="apex-text-muted mb-3 text-xs">Show a missed punch, error message or system failure that prevented you from starting your workday. Up to 3 images, 2 MB each. PNG, JPEG or WebP. Avoid unrelated personal information.</p>
    <label htmlFor={id} className="apex-text text-sm font-medium">Choose screenshots</label>
    <input id={id} aria-describedby={id + '-hint'} type="file" multiple accept="image/png,image/jpeg,image/webp" className="mt-2 block w-full text-sm" onChange={event => {
      const selected = Array.from(event.target.files ?? []); event.target.value = '';
      if (files.length + selected.length > 3) { setError('You can attach up to 3 screenshots.'); return; }
      if (selected.some(file => !TYPES.includes(file.type) || !file.size || file.size > MAX_BYTES)) { setError('Use PNG, JPEG or WebP images no larger than 2 MB each.'); return; }
      setError(null); onChange([...files, ...selected]);
    }} />
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    <ul className="mt-3 grid gap-3 sm:grid-cols-3">{files.map((file, index) => <li key={file.name + ':' + file.lastModified + ':' + index} className="min-w-0 rounded-lg border p-2"><LocalPreview file={file} /><p className="mt-2 break-all text-xs">{file.name}</p><button type="button" className="mt-2 text-sm font-medium text-blue-700 underline" aria-label={'Remove ' + file.name} onClick={() => { onChange(files.filter((_, i) => i !== index)); setError(null); }}>Remove</button></li>)}</ul>
    <p className="apex-text-muted mt-2 text-xs">Screenshots are saved when you submit and are visible to you and authorized reviewers. They do not count as a recorded punch.</p>
  </fieldset>;
}
function LocalPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { const objectUrl = URL.createObjectURL(file); setUrl(objectUrl); return () => URL.revokeObjectURL(objectUrl); }, [file]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={'Selected screenshot: ' + file.name} className="h-24 w-full rounded object-contain" /> : null;
}
export function CorrectionScreenshots({ requestId, files }: { requestId: string; files: CorrectionScreenshot[] }) {
  if (!files.length) return null;
  return <section aria-label="Supporting screenshots" className="my-3 space-y-2"><h4 className="apex-text text-sm font-semibold">Supporting screenshots</h4>{files.map(file => <SavedScreenshot key={file.id} requestId={requestId} file={file} />)}</section>;
}
function SavedScreenshot({ requestId, file }: { requestId: string; file: CorrectionScreenshot }) {
  const [url, setUrl] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return <div className="rounded-lg border border-[var(--border-secondary)] p-3">
    <button type="button" disabled={loading} className="break-all text-left text-sm font-medium text-blue-700 underline" onClick={async () => {
      if (url) { setUrl(null); return; }
      setLoading(true); setError(false);
      try { const blob = await getCorrectionScreenshot(requestId, file.id); if (!TYPES.includes(blob.type)) throw new Error('Unexpected response'); if (mounted.current) setUrl(URL.createObjectURL(blob)); } catch { if (mounted.current) setError(true); } finally { if (mounted.current) setLoading(false); }
    }}>{loading ? 'Loading screenshot…' : url ? 'Hide ' + file.filename : 'View ' + file.filename}</button>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">Screenshot could not be loaded. Select View to try again.</p>}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {url && <img src={url} alt={'Supporting screenshot: ' + file.filename} className="mt-3 max-h-96 w-full object-contain" />}
  </div>;
}
