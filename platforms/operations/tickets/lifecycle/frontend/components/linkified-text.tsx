'use client';

import { linkifyText } from '../../shared/linkify';

/**
 * Plain text with its http(s) URLs as links that open in a new tab. Renders
 * text nodes and anchors only (never HTML), so stored text cannot inject
 * markup; line breaks are kept by the caller's `whitespace-pre-wrap`.
 */
export function LinkifiedText({ text }: { text: string | null | undefined }) {
  return (
    <>
      {linkifyText(text).map((segment, i) =>
        segment.kind === 'link' ? (
          <a
            key={i}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)', textDecoration: 'underline', wordBreak: 'break-all' }}
          >
            {segment.text}
          </a>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}
