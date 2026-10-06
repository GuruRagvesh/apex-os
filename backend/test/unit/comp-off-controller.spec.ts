import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { CompOffController } from '../../src/modules/operations/leave/comp-off.controller';
import {
  CompOffAlreadyGrantedError,
  CompOffSourceNotQualifyingError,
} from '../../src/modules/operations/leave/comp-off.service';

// CompOffService.grantManual and listAvailable existed and were tested, but no
// controller exposed them — so no credit could be granted over HTTP and a
// COMP_OFF leave request had nothing to consume. These tests pin the transport
// only: the policy itself stays in the service, and this must not re-implement
// or soften it.

const hr = { id: 'hr-1', isHR: true };

function rig() {
  const service: any = {
    grantManual: jest.fn(),
    listAvailable: jest.fn().mockResolvedValue([]),
    assertHrOrAdmin: jest.fn(),
  };
  return { service, controller: new CompOffController(service) };
}

describe('comp off transport', () => {
  it('lists the callers own credits without an HR check', () => {
    const { service, controller } = rig();

    controller.mine({ id: 'emp-1' });

    expect(service.listAvailable).toHaveBeenCalledWith('emp-1');
    // Employees may always see their own credits.
    expect(service.assertHrOrAdmin).not.toHaveBeenCalled();
  });

  it('gates another employees credits behind the services own HR rule', async () => {
    const { service, controller } = rig();
    service.assertHrOrAdmin.mockImplementation(() => {
      throw new ForbiddenException('nope');
    });

    await expect(controller.forEmployee({ id: 'emp-2' }, 'emp-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(service.listAvailable).not.toHaveBeenCalled();
  });

  it('passes the grant straight through to the service', async () => {
    const { service, controller } = rig();
    service.grantManual.mockResolvedValue({ id: 'credit-1' });
    const body = {
      employeeId: 'emp-1',
      earnedFromBusinessDate: '2026-08-23',
      reason: 'Worked the Sunday release',
    };

    await controller.grant(hr, body);

    // The actor reaches the service unchanged: grantManual is what decides
    // whether this caller is allowed, and it must decide on the real actor.
    expect(service.grantManual).toHaveBeenCalledWith(hr, body);
  });

  it('does not re-check authorisation itself on grant', async () => {
    const { service, controller } = rig();
    service.grantManual.mockResolvedValue({ id: 'credit-1' });

    await controller.grant(hr, {
      employeeId: 'emp-1',
      earnedFromBusinessDate: '2026-08-23',
      reason: 'Worked the Sunday release',
    });

    // Duplicating the rule here would let the two copies drift.
    expect(service.assertHrOrAdmin).not.toHaveBeenCalled();
  });

  it('reports a non-qualifying source day as 422, not a generic failure', async () => {
    const { service, controller } = rig();
    service.grantManual.mockRejectedValue(
      new CompOffSourceNotQualifyingError('2026-08-25', ['ORDINARY_WORKING_DAY']),
    );

    await expect(
      controller.grant(hr, {
        employeeId: 'emp-1',
        earnedFromBusinessDate: '2026-08-25',
        reason: 'Tuesday is not a qualifying day',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('reports a duplicate credit for one source date as 409', async () => {
    const { service, controller } = rig();
    service.grantManual.mockRejectedValue(new CompOffAlreadyGrantedError('2026-08-23'));

    await expect(
      controller.grant(hr, {
        employeeId: 'emp-1',
        earnedFromBusinessDate: '2026-08-23',
        reason: 'Already granted for this date',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('exposes no automatic-earning route', () => {
    const routes = Object.getOwnPropertyNames(CompOffController.prototype);

    // Management has not defined a qualifying work duration; a route that
    // earned credit from a WorkSession would silently become that policy.
    expect(routes).toEqual(expect.arrayContaining(['mine', 'forEmployee', 'grant']));
    for (const name of routes) {
      expect(name).not.toMatch(/auto|earn|accrue/i);
    }
  });
});
