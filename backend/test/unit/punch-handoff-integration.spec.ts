import { ForbiddenException } from '@nestjs/common';
import { PunchEvidenceController } from '../../src/modules/platform/attendance/punch/punch-evidence.controller';

// The handoff service tests prove the service. These prove the SUBMIT PATH:
// that the controller actually claims the handoff, and that identity, intent
// and idempotency come from the claimed row rather than from the request body.
//
// A correct service wired up wrongly is still a broken feature — the claim
// could simply not be called, and every service-level guarantee would be
// bypassed by a body that carries handoffId but is never checked.

const USER = { id: 'emp-1' };
const req = { ip: '10.0.0.9', headers: {} };

function build(over: any = {}) {
  const submitted: any[] = [];
  const attached: any[] = [];

  const punchEvidence: any = {
    submit: jest.fn(async (userId: string, input: any) => {
      submitted.push({ userId, input });
      if (over.submitThrows) throw over.submitThrows;
      return { id: over.evidenceId ?? 'ev-1', type: input.type };
    }),
  };
  const punchPhoto: any = {};
  const handoff: any = {
    claim: jest.fn(async () => {
      if (over.claimThrows) throw over.claimThrows;
      return {
        userId: 'emp-1',
        intent: over.intent ?? 'PUNCH_IN',
        idempotencyKey: 'handoff:shared-key',
      };
    }),
    attachEvidence: jest.fn(async (id: string, evidenceId: string) => {
      attached.push({ id, evidenceId });
    }),
  };

  return {
    controller: new PunchEvidenceController(punchEvidence, punchPhoto, handoff),
    punchEvidence,
    handoff,
    submitted,
    attached,
  };
}

const mobileBody = (over: any = {}) => ({
  type: 'PUNCH_IN',
  idempotencyKey: 'client-supplied-key',
  latitude: 12.9716,
  longitude: 77.5946,
  accuracyMeters: 14,
  photoAssetId: 'photo-1',
  handoffId: 'ho-1',
  handoffToken: 'raw-token',
  ...over,
});

describe('a handoff submission is claimed before the punch is written', () => {
  it('claims with the authenticated user, not anything from the body', async () => {
    const { controller, handoff } = build();
    await controller.submit(USER, mobileBody() as any, req);

    expect(handoff.claim).toHaveBeenCalledWith('ho-1', 'raw-token', 'emp-1');
  });

  it('never reaches the punch service if the claim is refused', async () => {
    // The claim is the concurrency and identity gate. A punch written before
    // it, or despite it, would defeat both.
    const { controller, punchEvidence } = build({
      claimThrows: new ForbiddenException('wrong employee'),
    });

    await expect(controller.submit(USER, mobileBody() as any, req)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(punchEvidence.submit).not.toHaveBeenCalled();
  });

  it('links the evidence back to the handoff after a successful punch', async () => {
    const { controller, attached } = build();
    await controller.submit(USER, mobileBody() as any, req);

    expect(attached).toEqual([{ id: 'ho-1', evidenceId: 'ev-1' }]);
  });
});

describe('the row decides identity, intent and idempotency', () => {
  it('overrides a body intent that disagrees with the handoff', async () => {
    // The attack: scan a PUNCH_IN QR, post PUNCH_OUT. The claimed intent wins.
    const { controller, submitted } = build({ intent: 'PUNCH_IN' });
    await controller.submit(USER, mobileBody({ type: 'PUNCH_OUT' }) as any, req);

    expect(submitted[0].input.type).toBe('PUNCH_IN');
  });

  it('overrides a client idempotency key with the shared one', async () => {
    // This is what makes desktop and phone converge on one punch. A body key
    // would create a second.
    const { controller, submitted } = build();
    await controller.submit(USER, mobileBody() as any, req);

    expect(submitted[0].input.idempotencyKey).toBe('handoff:shared-key');
    expect(submitted[0].input.idempotencyKey).not.toBe('client-supplied-key');
  });

  it('records the punch against the authenticated employee', async () => {
    const { controller, submitted } = build();
    await controller.submit(USER, mobileBody() as any, req);

    expect(submitted[0].userId).toBe('emp-1');
  });

  it('marks the source as MOBILE, not whatever the body claimed', async () => {
    const { controller, submitted } = build();
    await controller.submit(USER, mobileBody({ source: 'WEB' }) as any, req);

    expect(submitted[0].input.source).toBe('MOBILE');
  });

  it('keeps the genuine evidence the phone captured', async () => {
    // The QR route is evidence-backed attendance, not a manual entry: real
    // coordinates, a real photo and a real capture time all survive.
    const { controller, submitted } = build();
    await controller.submit(USER, mobileBody() as any, req);

    expect(submitted[0].input).toMatchObject({
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 14,
      photoAssetId: 'photo-1',
    });
  });
});

describe('the ordinary desktop punch is untouched', () => {
  it('does not claim a handoff when none is referenced', async () => {
    const { controller, handoff, submitted } = build();
    const body = { type: 'PUNCH_IN', idempotencyKey: 'desktop-key', photoAssetId: 'p' };

    await controller.submit(USER, body as any, req);

    expect(handoff.claim).not.toHaveBeenCalled();
    expect(submitted[0].input.idempotencyKey).toBe('desktop-key');
  });

  it('ignores a half-specified handoff rather than guessing', async () => {
    // An id with no token, or a token with no id, is not a handoff attempt.
    const { controller, handoff } = build();

    await controller.submit(USER, { ...mobileBody(), handoffToken: undefined } as any, req);
    await controller.submit(USER, { ...mobileBody(), handoffId: undefined } as any, req);

    expect(handoff.claim).not.toHaveBeenCalled();
  });
});

describe('a failed punch does not leave the handoff looking successful', () => {
  it('does not attach evidence when the punch throws', async () => {
    const { controller, attached } = build({ submitThrows: new Error('context blocked') });

    await expect(controller.submit(USER, mobileBody() as any, req)).rejects.toBeTruthy();
    expect(attached).toEqual([]);
  });

  it('leaves an uploaded photo unlinked when the punch fails', async () => {
    // The orphan-photo rule, on this path too: a photo uploaded for a punch
    // that was refused has no evidence row, so it can never be shown as
    // attendance evidence.
    const { controller, attached } = build({ submitThrows: new Error('refused') });

    await expect(controller.submit(USER, mobileBody() as any, req)).rejects.toBeTruthy();
    expect(attached).toEqual([]);
  });
});
