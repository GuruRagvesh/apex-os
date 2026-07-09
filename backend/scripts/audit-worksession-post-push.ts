/**
 * READ-ONLY, one-off follow-up check. Contains no write/update/delete calls.
 * Lists every WorkSession row created strictly after the ac0ce02 push
 * timestamp (2026-07-09T06:17:27Z), with its date-shift status, to answer:
 * has the production service actually started writing correct dates yet?
 * NO DATA IS MODIFIED BY THIS SCRIPT.
 */
import { PrismaClient } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';

const prisma = new PrismaClient();
const PUSH_TIMESTAMP = new Date('2026-07-09T06:17:27.000Z');
const TIMEZONE = process.env.COMPANY_TIMEZONE || 'Asia/Kolkata';

async function main() {
  const rows = await prisma.workSession.findMany({
    where: { createdAt: { gt: PUSH_TIMESTAMP } },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { name: true, email: true } } },
  });

  console.log(`READ-ONLY. Rows created after ac0ce02 push (${PUSH_TIMESTAMP.toISOString()}): ${rows.length}\n`);

  for (const s of rows) {
    const storedDate = s.date instanceof Date ? formatInTimeZone(s.date, 'UTC', 'yyyy-MM-dd') : String(s.date).split('T')[0];
    const expectedDate = s.startWorkAt ? formatInTimeZone(s.startWorkAt, TIMEZONE, 'yyyy-MM-dd') : null;
    const verdict = !s.startWorkAt ? 'NO startWorkAt' : storedDate === expectedDate ? 'CORRECT' : 'STILL AFFECTED';
    console.log(
      `${s.user?.name ?? '?'} <${s.user?.email ?? '?'}> | createdAt=${s.createdAt.toISOString()} | ` +
      `stored=${storedDate} expected=${expectedDate ?? 'n/a'} | status=${s.status} | verdict=${verdict}`,
    );
  }

  console.log('\nNO DATA WAS MODIFIED.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
