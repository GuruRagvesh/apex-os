import * as fs from 'fs';
import * as path from 'path';
import { TicketsService, reviewTimerRequired } from '../../src/modules/operations/tickets/tickets.service';
import { reviewControls, REVIEW_START_REQUIRED } from '../../../platforms/operations/tickets/lifecycle/shared/review-controls';
import {
  attachmentProtectionLabel,
  attachmentPurposeLabel,
  formatElapsed,
  groupAttachments,
  NO_CURRENT_PROOF_MESSAGE,
  previewKind,
  reviewStartPrompt,
  shouldOpenEvidenceFirst,
  uploadPurposeFor,
  type TicketAttachment,
} from '../../../platforms/operations/tickets/lifecycle/shared/review-workspace';

// Review workspace follow-up: the mandatory review-start gate, evidence-first
// attachments, and attachment ownership, through the pure modules and the
// page source. Database behaviour is proven in test/integration-pg/t10.

const REPO = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const PAGE = 'frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx';

describe('review-start gate (UI controls)', () => {
  const ready = { isLoading: false, isError: false };
  const base = (over: Record<string, any> = {}) => ({
    status: 'REVIEW', viewerCanApprove: true, assignedToId: 'worker', reviewTimerRequired: true,
    timers: { activeClock: 'NONE', active: null }, ...over,
  });
  const runningFor = (userId: string) => ({ activeClock: 'REVIEWER_WORK', active: { userId, ownerType: 'REVIEWER' } });

  it('a reviewer who has not started cannot decide and must see the prompt', () => {
    expect(reviewControls(base(), 'rev', ready)).toMatchObject({
      canDecide: false, needsReviewStart: true, decisionBlockedReason: REVIEW_START_REQUIRED, canStartReview: true,
    });
  });

  it('once the viewer\'s own review runs (ledger), decisions open and the prompt goes away', () => {
    expect(reviewControls(base({ timers: runningFor('rev') }), 'rev', ready)).toMatchObject({
      canDecide: true, needsReviewStart: false, decisionBlockedReason: null,
    });
  });

  it('another reviewer\'s running clock does not open decisions for the viewer', () => {
    expect(reviewControls(base({ timers: runningFor('other') }), 'rev', ready)).toMatchObject({ canDecide: false, needsReviewStart: true });
  });

  it('QUERY / HELP (timer not required) decide without a started review and get no prompt', () => {
    expect(reviewControls(base({ reviewTimerRequired: false }), 'rev', ready)).toMatchObject({ canDecide: true, needsReviewStart: false });
  });

  it('an older backend without the flag is treated as required (safe direction)', () => {
    const { reviewTimerRequired: _omit, ...legacy } = base();
    expect(reviewControls(legacy, 'rev', ready)).toMatchObject({ reviewTimerRequired: true, canDecide: false });
  });

  it('non-reviewers, loading and unreadable tickets never prompt', () => {
    expect(reviewControls(base({ viewerCanApprove: false }), 'x', ready).needsReviewStart).toBe(false);
    expect(reviewControls(base(), 'rev', { isLoading: true, isError: false }).needsReviewStart).toBe(false);
    expect(reviewControls(base(), 'rev', { isLoading: false, isError: true }).needsReviewStart).toBe(false);
    expect(reviewControls(base({ status: 'IN_PROGRESS' }), 'rev', ready).needsReviewStart).toBe(false);
  });

  it('the prompt names the employee ticket a start would pause', () => {
    const t = { id: 't-review', ticketId: 'TKT-100' };
    const running = { activeClock: 'EMPLOYEE_WORK' as const, active: { ownerType: 'ASSIGNEE', startedAt: '', elapsedSeconds: 5, ticket: { id: 't-own', ticketId: 'TKT-200' } } };
    expect(reviewStartPrompt(t, running)).toEqual({
      title: 'Start reviewing TKT-100?',
      message: 'Starting this review will pause TKT-200. It will resume when you pause or finish this review.',
      startLabel: 'Start Review & Pause TKT-200',
      canStart: true,
    });
  });

  it('with nothing running the prompt is plain Start Review', () => {
    expect(reviewStartPrompt({ id: 't', ticketId: 'TKT-1' }, { activeClock: 'NONE', active: null }))
      .toEqual({ title: 'Start reviewing TKT-1?', message: null, startLabel: 'Start Review', canStart: true });
    expect(reviewStartPrompt({ id: 't', ticketId: 'TKT-1' }, undefined).startLabel).toBe('Start Review');
  });

  it('another running review blocks the start (the backend would refuse it)', () => {
    const other = { activeClock: 'REVIEWER_WORK' as const, active: { ownerType: 'REVIEWER', startedAt: '', elapsedSeconds: 5, ticket: { id: 't2', ticketId: 'TKT-9' } } };
    expect(reviewStartPrompt({ id: 't', ticketId: 'TKT-1' }, other)).toMatchObject({ canStart: false });
  });

  it('elapsed formatting for the banner', () => {
    expect(formatElapsed(0)).toBe('0m 00s');
    expect(formatElapsed(65)).toBe('1m 05s');
    expect(formatElapsed(3 * 3600 + 5 * 60 + 9)).toBe('3h 05m 09s');
    expect(formatElapsed(-4)).toBe('0m 00s');
  });

  it('timer requirement follows the ticket type', () => {
    expect(reviewTimerRequired({ type: 'TASK' })).toBe(true);
    expect(reviewTimerRequired({ type: 'BUG' })).toBe(true);
    expect(reviewTimerRequired({ type: 'QUERY' })).toBe(false);
    expect(reviewTimerRequired({ type: 'HELP' })).toBe(false);
  });
});

describe('evidence-first attachments', () => {
  const att = (over: Partial<TicketAttachment>): TicketAttachment => ({
    id: Math.random().toString(36).slice(2), filename: 'f.pdf', createdAt: '2026-10-01T00:00:00Z', purpose: 'GENERAL', ...over,
  });

  it('only the current cycle\'s proof is current; earlier cycles are previous evidence, oldest first', () => {
    const cycle1 = att({ id: 'p1', purpose: 'POC', reviewCycleId: 'c1', cycleNo: 1, locked: true, createdAt: '2026-10-01T09:00:00Z' });
    const cycle2a = att({ id: 'p2a', purpose: 'POC', reviewCycleId: 'c2', cycleNo: 2, locked: true, createdAt: '2026-10-02T09:00:00Z' });
    const cycle2b = att({ id: 'p2b', purpose: 'POC', reviewCycleId: 'c2', cycleNo: 2, locked: true, createdAt: '2026-10-02T10:00:00Z' });
    const feedback1 = att({ id: 'fb1', purpose: 'REVIEW_FEEDBACK', reviewCycleId: 'c1', cycleNo: 1, locked: true, createdAt: '2026-10-01T12:00:00Z' });
    const ref = att({ id: 'ref', purpose: 'REFERENCE' });
    const g = groupAttachments([cycle1, cycle2a, ref, cycle2b, feedback1], 'c2');
    expect(g.currentProof.map((a) => a.id)).toEqual(['p2b', 'p2a']); // latest first
    expect(g.previous).toEqual([{ cycleNo: 1, items: [cycle1, feedback1] }]);
    expect(g.other.map((a) => a.id)).toEqual(['ref']);
  });

  it('outside review there is no current evidence: all bound evidence is previous', () => {
    const g = groupAttachments([att({ purpose: 'POC', reviewCycleId: 'c1', cycleNo: 1, locked: true })], null);
    expect(g.currentProof).toHaveLength(0);
    expect(g.previous[0].cycleNo).toBe(1);
  });

  it('unsubmitted proof is pending; legacy proof without a cycle is earlier evidence, never current', () => {
    const pending = att({ id: 'pend', purpose: 'POC', reviewCycleId: null, locked: false, legacyProtected: false });
    const legacy = att({ id: 'old', purpose: 'POC', reviewCycleId: null, legacyProtected: true, isPoc: true });
    const g = groupAttachments([pending, legacy], 'c3');
    expect(g.pendingProof.map((a) => a.id)).toEqual(['pend']);
    expect(g.currentProof).toHaveLength(0);
    expect(g.previous).toEqual([{ cycleNo: null, items: [legacy] }]);
  });

  it('opens on Attachments only for a ticket in review whose current cycle has proof', () => {
    const proof = att({ purpose: 'POC', reviewCycleId: 'c1', cycleNo: 1 });
    expect(shouldOpenEvidenceFirst({ status: 'REVIEW', currentReviewCycle: { id: 'c1' }, attachments: [proof] })).toBe(true);
    expect(shouldOpenEvidenceFirst({ status: 'REVIEW', currentReviewCycle: { id: 'c1' }, attachments: [] })).toBe(false);
    expect(shouldOpenEvidenceFirst({ status: 'REVIEW', currentReviewCycle: { id: 'c2' }, attachments: [proof] })).toBe(false);
    expect(shouldOpenEvidenceFirst({ status: 'IN_PROGRESS', currentReviewCycle: null, attachments: [proof] })).toBe(false);
  });

  it('inline preview only for images and PDFs; Word, Excel, ZIP use View / Download', () => {
    expect(previewKind({ mimeType: 'image/png', filename: 'a.png' })).toBe('image');
    expect(previewKind({ mimeType: 'application/pdf', filename: 'a.pdf' })).toBe('pdf');
    expect(previewKind({ mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'a.docx' })).toBe('none');
    expect(previewKind({ mimeType: 'application/vnd.ms-excel', filename: 'a.xls' })).toBe('none');
    expect(previewKind({ mimeType: 'application/zip', filename: 'a.zip' })).toBe('none');
  });

  it('labels: purpose, lock reason, legacy protection', () => {
    expect(attachmentPurposeLabel(att({ purpose: 'POC' }))).toBe('Proof of completion');
    expect(attachmentPurposeLabel(att({ purpose: null, isPoc: true }))).toBe('Proof of completion');
    expect(attachmentPurposeLabel(att({ purpose: 'REVIEW_FEEDBACK' }))).toBe('Review feedback');
    expect(attachmentPurposeLabel(att({ purpose: 'GENERAL' }))).toBeNull();
    expect(attachmentProtectionLabel(att({ locked: true, lockReason: 'SUBMITTED_FOR_REVIEW' }))).toBe('Locked when submitted for review');
    expect(attachmentProtectionLabel(att({ locked: true, lockReason: 'REVIEW_REWORK' }))).toBe('Locked when sent back for rework');
    expect(attachmentProtectionLabel(att({ legacyProtected: true }))).toMatch(/before uploaders were recorded/);
    expect(attachmentProtectionLabel(att({}))).toBeNull();
  });

  it('upload purpose: reviewer in review = feedback, worker = general, anyone else = reference', () => {
    const t = { status: 'REVIEW', viewerCanApprove: true, assignedToId: 'w', assignees: [{ userId: 'w2' }] };
    expect(uploadPurposeFor(t, 'rev')).toBe('REVIEW_FEEDBACK');
    expect(uploadPurposeFor({ ...t, viewerCanApprove: false }, 'w')).toBe('GENERAL');
    expect(uploadPurposeFor({ ...t, viewerCanApprove: false, status: 'IN_PROGRESS' }, 'w2')).toBe('GENERAL');
    expect(uploadPurposeFor({ ...t, viewerCanApprove: false, status: 'IN_PROGRESS' }, 'tl')).toBe('REFERENCE');
  });
});

describe('attachment capabilities come from the backend', () => {
  const service = new TicketsService(
    {} as any, {} as any, {} as any, { get: jest.fn() } as any, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, { now: () => new Date() } as any,
  );
  const row = (over: Record<string, any>) => ({
    id: 'a1', filename: 'x.pdf', url: 'cloudinary:authenticated:raw:x:pdf', uploadedById: 'emp', lockedAt: null, lockReason: null,
    purpose: 'GENERAL', uploadedBy: { id: 'emp', name: 'Emp', email: 'hidden@example.invalid' }, ...over,
  });

  it('only the uploader of an unlocked attachment may delete it; role, participation and ownership grant nothing', () => {
    expect(service.sanitizeAttachmentForResponse('t', row({}), 'emp').canDelete).toBe(true);
    for (const viewer of ['tl', 'manager', 'admin', 'reviewer', 'creator', undefined]) {
      expect(service.sanitizeAttachmentForResponse('t', row({}), viewer).canDelete).toBe(false);
    }
  });

  it('locked evidence is not deletable, even by its uploader', () => {
    const safe = service.sanitizeAttachmentForResponse('t', row({ purpose: 'POC', lockedAt: new Date(), lockReason: 'SUBMITTED_FOR_REVIEW' }), 'emp');
    expect(safe).toMatchObject({ canDelete: false, locked: true, lockReason: 'SUBMITTED_FOR_REVIEW', purpose: 'POC' });
  });

  it('a legacy attachment (uploader unknown) is protected and says so', () => {
    const safe = service.sanitizeAttachmentForResponse('t', row({ uploadedById: null, uploadedBy: null }), 'emp');
    expect(safe).toMatchObject({ canDelete: false, legacyProtected: true, uploadedBy: null });
  });

  it('responses never carry the stored url or the uploader\'s email; legacy isPoc maps to POC', () => {
    const safe: any = service.sanitizeAttachmentForResponse('t', row({ purpose: undefined, isPoc: true, reviewCycle: { cycleNo: 2 } }), 'emp');
    expect(safe.url).toBeUndefined();
    expect(safe.uploadedBy).toEqual({ id: 'emp', name: 'Emp' });
    expect(safe.purpose).toBe('POC');
    expect(safe.cycleNo).toBe(2);
    expect(safe.reviewCycle).toBeUndefined();
  });
});

describe('ticket page and layout wiring', () => {
  const page = read(PAGE);

  it('delete buttons follow the backend canDelete only', () => {
    expect(page).toContain('att.canDelete === true');
    expect(page).not.toContain('canDelete={canDelete || canEdit}');
  });

  it('opening the page never starts a review: Start Review runs only from a user action', () => {
    const calls = page.split('startReviewMutation.mutate()').length - 1;
    expect(calls).toBe(2); // the gate's Start button and the banner's Start button
    expect(page).toContain('onStart={() => startReviewMutation.mutate()}');
    expect(page).toMatch(/onClick=\{\(\) => \(review\.needsReviewStart \? setViewOnly\(false\) : startReviewMutation\.mutate\(\)\)\}/);
    // No effect calls it.
    expect(page).not.toMatch(/useEffect\(\(\) => \{[^}]*startReviewMutation\.mutate/);
  });

  it('the gate offers Start Review, View Only and Go Back; decisions are gated on the backend rule', () => {
    expect(page).toContain('<ReviewStartGate');
    expect(page).toContain('View Only');
    expect(page).toContain('Go Back');
    expect(page).toContain("disabled={reviewActionPending || !review.canDecide}");
  });

  it('proof stays optional: Skip for now remains, the copy no longer says it is required, one request submits', () => {
    expect(page).toContain('Skip for now');
    expect(page).not.toContain('requires uploading proof');
    expect(page).toContain('ticketsApi.submitForReview(ticket.id, file)');
    expect(page).not.toContain("await ticketsApi.updateStatus(ticket.id, 'REVIEW')");
    expect(page).toContain('{NO_CURRENT_PROOF_MESSAGE}');
    expect(NO_CURRENT_PROOF_MESSAGE).toBe('No proof of completion was attached for this review cycle.');
  });

  it('evidence-first and previous evidence are rendered from the grouped attachments', () => {
    expect(page).toContain("if (shouldOpenEvidenceFirst(ticket)) setActiveTab('attachments');");
    expect(page).toContain('Previous evidence');
    expect(page).toContain('highlight={i === 0} inlinePreview={i === 0}');
  });

  it('the review banner is mounted app-wide', () => {
    const layout = read('frontend/app/(dashboard)/layout.tsx');
    expect(layout).toContain('<ActiveReviewBanner />');
    const banner = read('platforms/operations/tickets/lifecycle/frontend/components/active-review-banner.tsx');
    expect(banner).toContain("activeClock === 'REVIEWER_WORK'");
    expect(banner).toContain('Return to Review');
    expect(banner).toContain('Pause Review');
  });

  it('self-assigned approvals stay comment-only (rating rule unchanged)', () => {
    expect(page).toContain("const ratingsAllowed = !isSelfAssigned && ticket.type !== 'HELP';");
    expect(page).toContain('Self-assigned work is approved comment-only — no ratings are recorded.');
  });
});
