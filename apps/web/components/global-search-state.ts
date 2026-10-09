// Apex OS — Global Search result state (pure).
//
// A search whose every request failed is "unavailable" and offers a retry; it
// must never read as "No results", which tells the user the thing does not
// exist when the server simply did not answer.

export type SearchOutcome = 'results' | 'empty' | 'unavailable';

export function searchOutcome(
  settled: Array<{ status: 'fulfilled' | 'rejected' }>,
  resultCount: number,
): SearchOutcome {
  if (settled.length > 0 && settled.every((r) => r.status === 'rejected')) return 'unavailable';
  return resultCount > 0 ? 'results' : 'empty';
}
