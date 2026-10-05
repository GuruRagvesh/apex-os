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
    // The gate the scoped routes now use: HR and Admin anywhere, a manager
    // inside their own departments. Still the SERVICE's rule -- the point of
    // these tests is that the controller delegates rather than deciding.
    assertMayManageFor: jest.fn(),
    extendValidity: jest.fn().mockResolvedValue({ id: 'credit-1' }),
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

  it('gates another employees credits behind the services own scope rule', async () => {
    // The gate moved from assertHrOrAdmin to assertMayManageFor when managers
    // were given comp off authority. What is being tested is unchanged: the
    // controller asks the service and does not decide for itself.
    const { service, controller } = rig();
    service.assertMayManageFor.mockRejectedValue(new ForbiddenException('nope'));

    await expect(controller.forEmployee({ id: 'emp-2' }, 'emp-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(service.listAvailable).not.toHaveBeenCalled();
  });

  it('asks the service about the employee being read, not the caller', async () => {
    // A gate called with the wrong subject would authorize the manager
    // against themselves and let any manager read any employee.
    const { service, controller } = rig();

    await controller.forEmployee({ id: 'mgr-1' }, 'emp-1');

    expect(service.assertMayManageFor).toHaveBeenCalledWith({ id: 'mgr-1' }, 'emp-1');
  });

  it('passes an extension straight through to the service', async () => {
    const { service, controller } = rig();
    const body = { newExpiry: '2026-11-01', reason: 'Delivery slipped' };

    await controller.extend({ id: 'mgr-1' }, 'credit-1', body);

    // No ceiling arithmetic in the controller: it hands over and the service
    // decides.
    expect(service.extendValidity).toHaveBeenCalledWith({ id: 'mgr-1' }, 'credit-1', body);
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
