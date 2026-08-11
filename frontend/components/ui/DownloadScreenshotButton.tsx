'use client';

import { useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { downloadScreenshot } from '@apex/shared-utilities/download-screenshot';
import toast from 'react-hot-toast';
import { usePathname } from 'next/navigation';

interface DownloadScreenshotButtonProps {
  className?: string;
  label?: string;
}

export function DownloadScreenshotButton({
  className = '',
  label = 'Download Screenshot',
}: DownloadScreenshotButtonProps) {
  const [loading, setLoading] = useState(false);
  const pathname = usePathname();

  const getPageName = () => {
    const segments = pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'dashboard';
  };

  const handleCapture = async () => {
    setLoading(true);
    try {
      await downloadScreenshot(getPageName());
      toast.success('Screenshot downloaded!');
    } catch {
      toast.error('Failed to capture screenshot');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleCapture}
      disabled={loading}
      className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg transition-all disabled:opacity-50 ${className}`}
      style={{
        color: 'var(--text-secondary)',
      }}
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin flex-shrink-0" />
      ) : (
        <Camera size={14} className="flex-shrink-0" />
      )}
      {loading ? 'Capturing…' : label}
    </button>
  );
}
