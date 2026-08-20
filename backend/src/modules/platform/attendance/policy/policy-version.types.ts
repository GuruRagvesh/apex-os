import { PolicyStatus } from '@prisma/client';

/**
 * Versioned policy lifecycle contract (Attendance Base Layer, BL-4).
 *
 * The rule this layer exists to enforce:
 *
 *     Once a policy version has been ACTIVE, editing it must never rewrite
 *     historical meaning.
 *
 * So a change is a NEW version. The old one is SUPERSEDED and kept, and any
 * past date still resolves through the version that applied at the time.
 */

/** The four policy families that share this lifecycle. */
export type VersionedPolicyKind =
  | 'ATTENDANCE_POLICY'
  | 'SHIFT_POLICY'
  | 'LEAVE_POLICY'
  | 'HOLIDAY_CALENDAR';

/**
 * Roles permitted to ACTIVATE a policy version.
 *
 * Maker-checker: HR (or anyone) may prepare and submit a draft, but activation
 * — the moment configuration starts affecting real attendance — is restricted.
 * One person's mistake must not be able to reconfigure the company.
 */
export const POLICY_ACTIVATION_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const;
export type PolicyActivationRole = (typeof POLICY_ACTIVATION_ROLES)[number];

export interface PolicyActor {
  userId: string;
  role: string;
}

/** Legal lifecycle transitions. Anything absent here is rejected. */
export const ALLOWED_TRANSITIONS: Record<PolicyStatus, PolicyStatus[]> = {
  DRAFT: ['APPROVED'],
  APPROVED: ['ACTIVE', 'DRAFT'],
  ACTIVE: ['SUPERSEDED'],
  SUPERSEDED: [],
};

/** Fields that may still be edited, and only while a version is a DRAFT. */
export interface PolicyVersionFacts {
  id: string;
  kind: VersionedPolicyKind;
  version: number;
  status: PolicyStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdById: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  supersededById: string | null;
}

export class PolicyTransitionError extends Error {
  constructor(from: PolicyStatus, to: PolicyStatus) {
    super(`Illegal policy transition: ${from} -> ${to}`);
    this.name = 'PolicyTransitionError';
  }
}

export class PolicyImmutableError extends Error {
  constructor(id: string, status: PolicyStatus) {
    super(
      `Policy ${id} is ${status} and can no longer be edited in place. ` +
        `Issue a new version instead so historical attendance keeps its meaning.`,
    );
    this.name = 'PolicyImmutableError';
  }
}

export class PolicyAuthorizationError extends Error {
  constructor(role: string) {
    super(
      `Role ${role} may not activate a policy version. ` +
        `Activation is restricted to ${POLICY_ACTIVATION_ROLES.join(' or ')}.`,
    );
    this.name = 'PolicyAuthorizationError';
  }
}

export class PolicySelfApprovalError extends Error {
  constructor(userId: string) {
    super(
      `User ${userId} created this policy version and may not also activate it. ` +
        `Activation requires a second authorised actor (maker-checker).`,
    );
    this.name = 'PolicySelfApprovalError';
  }
}
