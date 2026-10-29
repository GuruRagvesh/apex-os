type UserIdentity = { id: string; employeeId?: string | null; name: string; email?: string | null };
type AllocationIdentity = { employeeId?: string | null; employeeName: string };

const tokens = (value: unknown) => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .split(/\s+/)
  .filter(Boolean);

const distance = (left: string, right: string) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
};
const nameScore = (allocationName: string, userName: string) => {
  const allocation = tokens(allocationName);
  const user = tokens(userName);
  if (!allocation.length || !user.length) return 0;

  const allocationJoined = allocation.join(' ');
  const userJoined = user.join(' ');
  if (allocationJoined === userJoined) return 100;

  const userWithinAllocation = user.every(token => allocation.includes(token));
  if (user.length >= 2 && userWithinAllocation) return 92 + Math.min(user.length, 5);

  const allocationWithinUser = allocation.every(token => user.includes(token));
  if (allocation.length >= 2 && allocationWithinUser) return 90 + Math.min(allocation.length, 5);

  if (allocation[0] !== user[0]) return 0;

  const allocationTail = allocation.slice(1).join('');
  const userTail = user.slice(1).join('');
  if (allocationTail && userTail && (allocationTail.includes(userTail) || userTail.includes(allocationTail))) return 88;

  const allocationLast = allocation.at(-1)!;
  const userLast = user.at(-1)!;
  const tolerated = Math.max(1, Math.floor(Math.max(allocationLast.length, userLast.length) * 0.2));
  if (allocation.length > 1 && user.length > 1 && distance(allocationLast, userLast) <= tolerated) return 82;

  if (allocation.length === 1 || user.length === 1) return 75;
  return 0;
};

/**
 * Imported allocation sheets often contain a legal name while Apex OS stores a
 * shorter display name. IDs remain authoritative. Name matching is accepted
 * only when one user has the unique best score, so an ambiguous name is never
 * copied onto multiple profiles.
 */
export const matchAllocationUser = <T extends UserIdentity>(allocation: AllocationIdentity, users: T[]): T | null => {
  const allocationEmployeeId = String(allocation.employeeId ?? '').trim();
  if (allocationEmployeeId) {
    const idMatches = users.filter(user => user.id === allocationEmployeeId || user.employeeId === allocationEmployeeId);
    if (idMatches.length === 1) return idMatches[0];
  }

  const ranked = users
    .map(user => ({ user, score: nameScore(allocation.employeeName, user.name) }))
    .filter(candidate => candidate.score >= 75)
    .sort((left, right) => right.score - left.score);

  if (!ranked.length) return null;
  const tied = ranked.filter(candidate => candidate.score === ranked[0].score);
  if (tied.length > 1) {
    const allocationName = tokens(allocation.employeeName).join('');
    const emailMatches = tied.filter(({ user }) => {
      const emailName = String(user.email ?? '').split('@')[0];
      return tokens(emailName).join('') === allocationName;
    });
    return emailMatches.length === 1 ? emailMatches[0].user : null;
  }
  return ranked[0].user;
};

