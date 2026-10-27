import { Injectable } from '@nestjs/common';
import { PolicyStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  policyHealthDedupeKey,
  previousCompanyDate,
  resolveContinuousPolicy,
  type ContinuityResolution,
  type PolicyContinuityHealth,
  GOVERNING_POLICY_STATUSES,
} from './policy-continuity';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import {
  ALLOWED_TRANSITIONS,
  POLICY_ACTIVATION_ROLES,
  PolicyActor,
  PolicyActivationRole,
  PolicyAuthorizationError,
  PolicyImmutableError,
  PolicySelfApprovalError,
  PolicyTransitionError,
  PolicyVersionFacts,
  VersionedPolicyKind,
} from './policy-version.types';

/**
 * Versioned policy lifecycle (Attendance Base Layer, BL-4).
 *
 * Owns DRAFT -> APPROVED -> ACTIVE -> SUPERSEDED for the four policy families,
 * and the maker-checker rule guarding activation.
 *
 * See policy-version.types.ts for the contract. Company time is delegated to
 * TVAService; this service never reads the server's local date.
 *
 * isActive vs status. The four tables carry a pre-existing isActive boolean
 * that BL-2A's calendar query and the HRMS seed both read. status is the
 * authoritative lifecycle field; isActive is maintained here as a derived
 * mirror (ACTIVE => true, anything else => false) so those existing readers
 * keep working rather than being silently broken.
 */
@Injectable()
export class PolicyVersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
  ) {}

  /** Maps a policy family to its Prisma delegate. */
  private delegate(kind: VersionedPolicyKind, client: Prisma.TransactionClient | PrismaService) {
    const c = client as any;
    switch (kind) {
      case 'ATTENDANCE_POLICY':
        return c.attendancePolicy;
      case 'SHIFT_POLICY':
        return c.shiftPolicy;
      case 'LEAVE_POLICY':
        return c.leavePolicy;
      case 'HOLIDAY_CALENDAR':
        return c.holidayCalendar;
      default:
        throw new Error(`Unknown policy kind: ${kind}`);
    }
  }

  /**
   * Physical table name per family, for the row-lock statement.
   *
   * A closed internal map, never caller input -- identifiers cannot be bound
   * as SQL parameters, so this must not be reachable from user data.
   */
  private tableName(kind: VersionedPolicyKind): string {
    switch (kind) {
      case 'ATTENDANCE_POLICY':
        return 'attendance_policies';
      case 'SHIFT_POLICY':
        return 'shift_policies';
      case 'LEAVE_POLICY':
        return 'leave_policies';
      case 'HOLIDAY_CALENDAR':
        return 'holiday_calendars';
      default:
        throw new Error(`Unknown policy kind: ${kind}`);
    }
  }

  /**
   * Serialises every lifecycle mutation for one policy SERIES.
   *
   * A transaction alone does not stop two APPROVED drafts of the same family
   * being activated concurrently: under READ COMMITTED neither sees the
   * other, and both would supersede the same outgoing version and leave two
   * ACTIVE rows. Locking every row of the series makes the second caller
   * block until the first commits, then re-read the real state.
   *
   * policyKey is a bound parameter; only the table name is inlined, from the
   * closed map above.
   */
  private async lockSeries(
    kind: VersionedPolicyKind,
    policyKey: string,
    tx: Prisma.TransactionClient,
  ) {
    const table = this.tableName(kind);
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE "policyKey" = ${policyKey} FOR UPDATE`,
    );
  }
  private toDateOnly(input: Date | string): Date {
    const businessDate =
      typeof input === 'string' ? input : this.tva.companyBusinessDate(input);
    const d = new Date(`${businessDate}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid business date: ${businessDate}`);
    }
    return d;
  }

  private formatOrNull(v: Date | null | undefined): string | null {
    return v ? this.tva.companyBusinessDate(v) : null;
  }

  private toFacts(kind: VersionedPolicyKind, row: any): PolicyVersionFacts {
    return {
      id: row.id,
      kind,
      version: row.version,
      status: row.status,
      effectiveFrom: this.tva.companyBusinessDate(row.effectiveFrom),
      effectiveTo: this.formatOrNull(row.effectiveTo),
      createdById: row.createdById ?? null,
      approvedById: row.approvedById ?? null,
      approvedAt: this.formatOrNull(row.approvedAt),
      supersededById: row.supersededById ?? null,
    };
  }

  private assertTransition(from: PolicyStatus, to: PolicyStatus) {
    if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
      throw new PolicyTransitionError(from, to);
    }
  }

  /**
   * A version that has ever been ACTIVE is frozen. Editing its content would
   * retroactively change what past attendance meant, which is precisely what
   * versioning exists to prevent.
   */
  private assertEditable(row: { id: string; status: PolicyStatus }) {
    if (row.status !== PolicyStatus.DRAFT) {
      throw new PolicyImmutableError(row.id, row.status);
    }
  }

  /** DRAFT -> APPROVED. Records who approved it and when. */
  async approve(kind: VersionedPolicyKind, id: string, actor: PolicyActor) {
    return this.prisma.$transaction(async (tx) => {
      const d = this.delegate(kind, tx);
      const row = await d.findUnique({ where: { id } });
      if (!row) throw new Error(`Policy not found: ${id}`);
      this.assertTransition(row.status, PolicyStatus.APPROVED);
      return d.update({
        where: { id },
        data: {
          status: PolicyStatus.APPROVED,
          approvedById: actor.userId,
          approvedAt: this.tva.now(),
        },
      });
    });
  }

  /**
   * APPROVED -> ACTIVE, with maker-checker enforced and the whole series
   * serialised.
   *
   * Order matters and is asserted by test:
   *   1. role gate (before any read)
   *   2. BEGIN, lock every row of this policy series FOR UPDATE
   *   3. re-read the incoming version AFTER the lock
   *   4. re-validate it is still APPROVED
   *   5. resolve the currently ACTIVE version of the SAME series
   *   6. supersede it
   *   7. activate the incoming version
   *   COMMIT
   *
   * Steps 3-4 are the point of the lock: a competing activation may have
   * already promoted a different draft while this call waited, in which case
   * this one is now stale and must fail rather than create a second ACTIVE.
   *
   * Maker-checker is two independent guards -- the actor's role must permit
   * activation, and the actor must not be the person who created the draft.
   * The second is what stops one authorised person reconfiguring the company
   * alone. When no createdById was recorded, it cannot be satisfied by
   * accident and activation proceeds on role alone.
   */
  async activate(kind: VersionedPolicyKind, id: string, actor: PolicyActor) {
    if (!POLICY_ACTIVATION_ROLES.includes(actor.role as PolicyActivationRole)) {
      throw new PolicyAuthorizationError(actor.role);
    }

    return this.prisma.$transaction(async (tx) => {
      const d = this.delegate(kind, tx);

      // Read once only to learn which series to lock. Every decision below is
      // made from the post-lock re-read.
      const preLock = await d.findUnique({ where: { id } });
      if (!preLock) throw new Error(`Policy not found: ${id}`);

      await this.lockSeries(kind, preLock.policyKey, tx);

      const row = await d.findUnique({ where: { id } });
      if (!row) throw new Error(`Policy not found: ${id}`);
      const incomingStart = this.tva.companyBusinessDate(row.effectiveFrom);
      const today = this.tva.companyBusinessDate(this.tva.now());
      // Phase 3: a future-dated version becomes SCHEDULED, never a second
      // ACTIVE. It governs from its own company date by date-based resolution
      // even if no job ever runs; settleScheduledSupersessions() only tidies
      // the label once the date has passed.
      const startsLater = incomingStart > today;
      const target = startsLater ? PolicyStatus.SCHEDULED : PolicyStatus.ACTIVE;
      this.assertTransition(row.status, target);

      if (row.createdById && row.createdById === actor.userId) {
        throw new PolicySelfApprovalError(actor.userId);
      }

      // The predecessor is the latest live version of the SAME series that
      // starts before the incoming one (the current ACTIVE, or an earlier
      // SCHEDULED one). Resolved from the series, never supplied by the caller.
      const predecessor = await d.findFirst({
        where: {
          policyKey: row.policyKey,
          status: { in: [PolicyStatus.ACTIVE, PolicyStatus.SCHEDULED] },
          effectiveFrom: { lt: this.toDateOnly(incomingStart) },
          NOT: { id: row.id },
        },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      });

      // A version already scheduled to start on or after this one would leave
      // two futures racing for the same dates; that must be settled first.
      const laterScheduled = await d.findFirst({
        where: {
          policyKey: row.policyKey,
          status: PolicyStatus.SCHEDULED,
          effectiveFrom: { gte: this.toDateOnly(incomingStart) },
          NOT: { id: row.id },
        },
      });
      if (
        laterScheduled?.status === PolicyStatus.SCHEDULED &&
        this.tva.companyBusinessDate(laterScheduled.effectiveFrom) >= incomingStart
      ) {
        throw new PolicyTransitionError(row.status, target);
      }

      if (predecessor) {
        // Closed on the previous COMPANY date, so the two never both cover a
        // date. (A timestamp minus 24 hours lands on the wrong day whenever
        // effectiveFrom carries a time or sits across the IST/UTC boundary.)
        const closesOn = this.toDateOnly(previousCompanyDate(incomingStart));
        // An ACTIVE predecessor of a future successor stays ACTIVE (it still
        // governs until the day before); otherwise it is superseded now.
        const keepsGoverning = startsLater && predecessor.status === PolicyStatus.ACTIVE;
        if (!keepsGoverning && predecessor.status === PolicyStatus.ACTIVE) {
          this.assertTransition(predecessor.status, PolicyStatus.SUPERSEDED);
        }
        await d.update({
          where: { id: predecessor.id },
          data: {
            ...(keepsGoverning || predecessor.status === PolicyStatus.SCHEDULED
              ? {}
              : { status: PolicyStatus.SUPERSEDED, isActive: false }),
            supersededById: row.id,
            effectiveTo: closesOn,
          },
        });
      }

      return d.update({
        where: { id: row.id },
        data: { status: target, isActive: !startsLater },
      });
    });
  }

  /**
   * Issues the next version of a policy as a DRAFT.
   *
   * The incoming draft carries version = previous + 1 and whatever content the
   * caller supplies. Nothing about the previous version is touched here --
   * superseding happens at activate(), so an abandoned draft leaves the live
   * configuration exactly as it was.
   */
  async createNextVersion(
    kind: VersionedPolicyKind,
    previousId: string,
    data: Record<string, any>,
    actor: PolicyActor,
    effectiveFrom: Date | string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const d = this.delegate(kind, tx);
      const previous = await d.findUnique({ where: { id: previousId } });
      if (!previous) throw new Error(`Policy not found: ${previousId}`);

      // Serialise against a concurrent activation of the same series, so the
      // version number cannot be chosen from a stale maximum.
      await this.lockSeries(kind, previous.policyKey, tx);

      const latest = await d.findFirst({
        where: { policyKey: previous.policyKey },
        orderBy: { version: 'desc' },
      });

      const {
        id: _ignoredId,
        createdAt: _c,
        updatedAt: _u,
        version: _v,
        status: _s,
        approvedById: _a,
        approvedAt: _aa,
        supersededById: _sb,
        effectiveFrom: _ef,
        effectiveTo: _et,
        ...carried
      } = previous as Record<string, any>;

      const created = await d.create({
        data: {
          ...carried,
          ...data,
          // policyKey is the series identity and is never caller-writable:
          // a new version must stay in the same series as its predecessor.
          policyKey: previous.policyKey,
          version: (latest?.version ?? previous.version ?? 1) + 1,
          status: PolicyStatus.DRAFT,
          isActive: false,
          createdById: actor.userId,
          approvedById: null,
          approvedAt: null,
          supersededById: null,
          effectiveFrom: this.toDateOnly(effectiveFrom),
          effectiveTo: null,
        },
      });

      // HolidayCalendar owns Holiday children. A new version that started
      // empty would silently mean "no holidays at all" the moment it went
      // ACTIVE, so the children are cloned into the draft in this same
      // transaction. The originals are never read-modified: these are fresh
      // rows pointing at the new calendarId, so V1 and V2 diverge freely and
      // @@unique([calendarId, date]) still holds for both.
      if (kind === 'HOLIDAY_CALENDAR') {
        const children = await (tx as any).holiday.findMany({
          where: { calendarId: previousId },
          orderBy: { date: 'asc' },
        });
        if (children.length > 0) {
          await (tx as any).holiday.createMany({
            data: children.map((h: any) => ({
              calendarId: created.id,
              date: h.date,
              name: h.name,
              isOptional: h.isOptional,
            })),
          });
        }
      }

      return created;
    });
  }
  /**
   * Edits a DRAFT's content. Refuses on anything else -- an APPROVED, ACTIVE or
   * SUPERSEDED version is frozen and must be replaced by a new version.
   */
  async updateDraft(
    kind: VersionedPolicyKind,
    id: string,
    data: Record<string, any>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const d = this.delegate(kind, tx);
      const row = await d.findUnique({ where: { id } });
      if (!row) throw new Error(`Policy not found: ${id}`);
      this.assertEditable(row);

      // Lifecycle fields are never caller-writable through this path.
      const {
        status: _s,
        version: _v,
        approvedById: _a,
        approvedAt: _aa,
        supersededById: _sb,
        isActive: _ia,
        policyKey: _pk,
        ...safe
      } = data;

      return d.update({ where: { id }, data: safe });
    });
  }

  /**
   * The version of a policy family in force on a business date.
   *
   * Only ACTIVE and SUPERSEDED versions can ever have applied -- a DRAFT or
   * APPROVED version never governed a real day, so neither is considered.
   * Comparisons use the company business-DAY window, matching BL-3, because
   * effectiveFrom is a TIMESTAMP that may carry a time.
   */
  async resolvePolicyOn(
    kind: VersionedPolicyKind,
    businessDate: Date | string,
    where: Record<string, any> = {},
  ) {
    return (await this.resolveWithHealth(kind, businessDate, where)).policy;
  }

  /**
   * Policy continuity (Phase 3), with the health finding.
   *
   * `where.id` names the version a profile was ASSIGNED; continuity follows
   * that version's SERIES (policyKey), so a successor version applies from its
   * own effective date without anyone re-assigning every profile, and a gap
   * continues the predecessor instead of blocking the day. Any other filter
   * selects the candidate set directly.
   *
   * Never throws for missing or inconsistent configuration: the caller gets
   * `policy: null` / a health value, and the finding is recorded as a
   * PolicyHealthIssue for Admin.
   */
  async resolveWithHealth(
    kind: VersionedPolicyKind,
    businessDate: Date | string,
    where: Record<string, any> = {},
  ): Promise<{ policy: any | null; health: PolicyContinuityHealth | null }> {
    const date =
      typeof businessDate === 'string'
        ? businessDate
        : this.tva.companyBusinessDate(businessDate);
    const d = this.delegate(kind, this.prisma);
    // Local preview databases can legitimately lag the newest additive
    // attendance thresholds while the owner-only migration is pending. Avoid
    // Prisma's implicit `SELECT *` for this read path so the evaluator can use
    // its documented defaults until that migration is applied.
    const readSelect = kind === 'ATTENDANCE_POLICY'
      ? {
          id: true,
          financialYear: true,
          name: true,
          isActive: true,
          minimumWorkingMinutes: true,
          lateExemptionEnabled: true,
          faceCaptureRequired: true,
          locationCaptureRequired: true,
          geoFenceEnabled: true,
          regularizationEnabled: true,
          createdAt: true,
          updatedAt: true,
          updatedById: true,
          policyKey: true,
          version: true,
          status: true,
          effectiveFrom: true,
          effectiveTo: true,
          approvedById: true,
          approvedAt: true,
          createdById: true,
          supersededById: true,
          afterPunchWindowAction: true,
          insufficientHoursAction: true,
          automaticHalfDayEnabled: true,
          permittedBreakMinutes: true,
          minimumEffectiveWorkMinutes: true,
        }
      : undefined;

    // The common case first: a governing version covers the date. This is the
    // same query the readers always made, now also accepting SCHEDULED
    // versions (a future version governs from its own date with no job).
    const anchorDay = this.toDateOnly(date);
    const covering = await d.findFirst({
      where: {
        ...where,
        status: { in: [...GOVERNING_POLICY_STATUSES] },
        effectiveFrom: { lte: this.tva.companyDayEnd(anchorDay) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: this.tva.companyDayStart(anchorDay) } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      ...(readSelect ? { select: readSelect } : {}),
    });
    if (covering) return { policy: covering, health: null };
    if (typeof d.findMany !== 'function' || typeof d.findUnique !== 'function') {
      return { policy: null, health: 'NO_POLICY' };
    }

    // Nothing covers the date: continuity over the series (gap, baseline).
    let filter: Record<string, any> = where;
    if (typeof where.id === 'string') {
      const { id, ...rest } = where;
      const anchor = await d.findUnique({ where: { id }, select: { policyKey: true } });
      if (!anchor) return { policy: null, health: 'NO_POLICY' };
      filter = { ...rest, policyKey: anchor.policyKey };
    }

    const rows = await d.findMany({
      where: { ...filter, status: { in: [...GOVERNING_POLICY_STATUSES] } },
      ...(readSelect ? { select: readSelect } : {}),
    });
    const resolution = resolveContinuousPolicy(
      rows.map((r: any) => ({
        id: r.id,
        version: r.version,
        effectiveFrom: this.tva.companyBusinessDate(r.effectiveFrom),
        effectiveTo: r.effectiveTo ? this.tva.companyBusinessDate(r.effectiveTo) : null,
        row: r,
      })),
      date,
    );
    if (resolution.health) {
      this.recordHealth(kind, resolution).catch(() => undefined);
    }
    return { policy: (resolution.policy as any)?.row ?? null, health: resolution.health };
  }

  /** Recently recorded findings, so a busy read path does not write on every call. */
  private readonly recentHealth = new Map<string, number>();

  /**
   * Upserts the finding as a PolicyHealthIssue. Best effort and never on the
   * caller's critical path: a health record failing to save must not fail a
   * punch, a leave request or an evaluation.
   */
  private async recordHealth(kind: VersionedPolicyKind, resolution: ContinuityResolution) {
    const dedupeKey = policyHealthDedupeKey(kind, resolution);
    if (!dedupeKey || !resolution.health) return;
    const now = Date.now();
    const seen = this.recentHealth.get(dedupeKey);
    if (seen && now - seen < 10 * 60_000) return;
    this.recentHealth.set(dedupeKey, now);
    if (this.recentHealth.size > 500) this.recentHealth.clear();

    const day = (v: string | null) => (v ? new Date(`${v}T00:00:00.000Z`) : null);
    const existing = await (this.prisma as any).policyHealthIssue.findUnique({ where: { dedupeKey } });
    if (!existing) {
      await (this.prisma as any).policyHealthIssue.create({
        data: {
          id: randomUUID(),
          policyFamily: kind,
          kind: resolution.health,
          dedupeKey,
          rangeFrom: day(resolution.rangeFrom),
          rangeTo: day(resolution.rangeTo),
          policyIds: resolution.involvedIds,
        },
      });
    } else if (existing.status === 'RESOLVED') {
      await (this.prisma as any).policyHealthIssue.update({
        where: { dedupeKey },
        data: { status: 'OPEN', resolvedAt: null, resolvedById: null, detectedAt: this.tva.now() },
      });
    }
  }

  /**
   * Tidies lifecycle labels once a SCHEDULED version's company date arrives.
   *
   * Purely cosmetic for resolution: a SCHEDULED version already governs from
   * its effectiveFrom by date alone, so a day with this job down still resolves
   * correctly. Here its predecessor becomes SUPERSEDED and it becomes ACTIVE,
   * in one transaction per family, so the series never shows two ACTIVE rows.
   * Idempotent; run daily and at startup.
   */
  async settleScheduledSupersessions(): Promise<number> {
    const today = this.toDateOnly(this.tva.companyBusinessDate(this.tva.now()));
    let settled = 0;
    for (const kind of ['ATTENDANCE_POLICY', 'SHIFT_POLICY', 'LEAVE_POLICY', 'HOLIDAY_CALENDAR'] as const) {
      settled += await this.prisma.$transaction(async (tx) => {
        const d = this.delegate(kind, tx);
        const due = await d.findMany({
          where: { status: PolicyStatus.SCHEDULED, effectiveFrom: { lte: today } },
          orderBy: { effectiveFrom: 'asc' },
        });
        let n = 0;
        for (const row of due) {
          await this.lockSeries(kind, row.policyKey, tx);
          await d.updateMany({
            where: { policyKey: row.policyKey, status: PolicyStatus.ACTIVE, NOT: { id: row.id } },
            data: { status: PolicyStatus.SUPERSEDED, isActive: false },
          });
          await d.update({ where: { id: row.id }, data: { status: PolicyStatus.ACTIVE, isActive: true } });
          n += 1;
        }
        return n;
      });
    }
    return settled;
  }

  /** Every version of one policy family, oldest first. */
  async listVersions(kind: VersionedPolicyKind, where: Record<string, any> = {}) {
    const d = this.delegate(kind, this.prisma);
    return d.findMany({ where, orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }] });
  }

  /** Public facts view for a single row. */
  facts(kind: VersionedPolicyKind, row: any): PolicyVersionFacts {
    return this.toFacts(kind, row);
  }
}
