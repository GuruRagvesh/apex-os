import { Injectable } from '@nestjs/common';
import { PolicyStatus, Prisma } from '@prisma/client';
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
      this.assertTransition(row.status, PolicyStatus.ACTIVE);

      if (row.createdById && row.createdById === actor.userId) {
        throw new PolicySelfApprovalError(actor.userId);
      }

      // The outgoing version is resolved from the series, not supplied by the
      // caller, so a stale or wrong id cannot leave two ACTIVE versions.
      const current = await d.findFirst({
        where: {
          policyKey: row.policyKey,
          status: PolicyStatus.ACTIVE,
          NOT: { id: row.id },
        },
      });

      if (current) {
        this.assertTransition(current.status, PolicyStatus.SUPERSEDED);
        await d.update({
          where: { id: current.id },
          data: {
            status: PolicyStatus.SUPERSEDED,
            isActive: false,
            supersededById: row.id,
            // Closed the day before the incoming version opens, so the two
            // never both cover a date.
            effectiveTo: new Date(row.effectiveFrom.getTime() - 24 * 60 * 60 * 1000),
          },
        });
      }

      return d.update({
        where: { id: row.id },
        data: { status: PolicyStatus.ACTIVE, isActive: true },
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
    const date =
      typeof businessDate === 'string'
        ? businessDate
        : this.tva.companyBusinessDate(businessDate);
    const anchor = this.toDateOnly(date);
    const d = this.delegate(kind, this.prisma);

    return d.findFirst({
      where: {
        ...where,
        status: { in: [PolicyStatus.ACTIVE, PolicyStatus.SUPERSEDED] },
        effectiveFrom: { lte: this.tva.companyDayEnd(anchor) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: this.tva.companyDayStart(anchor) } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
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
