// Operations Tickets — safe link detection for plain-text ticket fields.
//
// Splits stored plain text into text and link segments. Only absolute http://
// and https:// URLs become links; every other scheme (javascript:, data:,
// vbscript:, file:, …) and anything that is not a well-formed URL stays text.
// Nothing here produces HTML: the renderer emits text nodes and <a> elements
// whose href is the URL as parsed by the URL constructor, so stored text can
// never inject markup or script.

export type LinkifySegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string };

// A candidate starts at http:// or https:// and runs to the next whitespace or
// character that cannot be part of a URL in running text.
const CANDIDATE = /https?:\/\/[^\s<>"'`]+/gi;
// Sentence punctuation that usually follows a link rather than belonging to it.
const TRAILING = /[.,;:!?]+$/;

/** Drop trailing punctuation and an unbalanced closing bracket. */
function trimCandidate(raw: string): string {
  let url = raw.replace(TRAILING, '');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
    while (url.endsWith(close) && url.split(open).length < url.split(close).length) {
      url = url.slice(0, -1).replace(TRAILING, '');
    }
  }
  return url;
}

/** The URL as a safe href, or null when it is not an absolute http(s) URL. */
export function safeHttpUrl(candidate: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  return parsed.href;
}

/** Plain text in, ordered text/link segments out. Line breaks stay in the text. */
export function linkifyText(input: string | null | undefined): LinkifySegment[] {
  const text = input ?? '';
  const segments: LinkifySegment[] = [];
  let cursor = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const last = segments[segments.length - 1];
    if (last?.kind === 'text') last.text += value;
    else segments.push({ kind: 'text', text: value });
  };
  // exec() loop rather than matchAll(): the frontend compiles to ES5 iteration.
  const pattern = new RegExp(CANDIDATE.source, CANDIDATE.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;
    const url = trimCandidate(match[0]);
    const href = url ? safeHttpUrl(url) : null;
    pushText(text.slice(cursor, start));
    if (href) {
      segments.push({ kind: 'link', text: url, href });
      cursor = start + url.length;
    } else {
      pushText(match[0]);
      cursor = start + match[0].length;
    }
  }
  pushText(text.slice(cursor));
  return segments;
}
