import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';

function serviceFor(user: Record<string, unknown>) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockImplementation(async ({ data }) => {
        Object.assign(user, data);
        return user;
      }),
    },
  };
  const service = Object.create(UsersService.prototype) as UsersService;
  (service as any).prisma = prisma;
  return { service, prisma };
}

describe('collaboration availability', () => {
  it('falls back to workday status when there is no manual choice', async () => {
    const { service } = serviceFor({ availabilityStatus: 'AUTO', availabilityExpiresAt: null, currentStatus: 'ON_BREAK' });
    await expect(service.getAvailability('user-1')).resolves.toMatchObject({
      selectedStatus: 'AUTO', effectiveStatus: 'BE_RIGHT_BACK', workdayStatus: 'ON_BREAK',
    });
  });

  it('ignores an expired override without changing attendance', async () => {
    const { service } = serviceFor({ availabilityStatus: 'BUSY', availabilityExpiresAt: new Date(0), currentStatus: 'WORKING' });
    await expect(service.getAvailability('user-1')).resolves.toMatchObject({
      selectedStatus: 'AUTO', effectiveStatus: 'AVAILABLE',
    });
  });

  it('saves a time-limited override without writing the workday field', async () => {
    const { service, prisma } = serviceFor({ availabilityStatus: 'AUTO', availabilityExpiresAt: null, currentStatus: 'WORKING' });
    await expect(service.setAvailability('user-1', 'DO_NOT_DISTURB', 60)).resolves.toMatchObject({
      selectedStatus: 'DO_NOT_DISTURB', effectiveStatus: 'DO_NOT_DISTURB',
    });
    expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('currentStatus');
  });

  it('rejects unknown statuses and durations', async () => {
    const { service, prisma } = serviceFor({ availabilityStatus: 'AUTO', availabilityExpiresAt: null, currentStatus: 'WORKING' });
    await expect(service.setAvailability('user-1', 'ON_BREAK')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setAvailability('user-1', 'BUSY', 15)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('exposes only effective presence in directory responses', () => {
    const policy = Object.create(AccessPolicyService.prototype) as AccessPolicyService;
    const directoryUser = policy.safeUser({
      id: 'user-1', currentStatus: 'WORKING', availabilityStatus: 'APPEAR_OFFLINE', availabilityExpiresAt: null,
    });
    expect(directoryUser.effectiveAvailabilityStatus).toBe('OFFLINE');
    expect(directoryUser).not.toHaveProperty('availabilityStatus');
    expect(directoryUser).not.toHaveProperty('availabilityExpiresAt');
  });
});
