import { BadRequestException } from '@nestjs/common';
import { SettingsController } from '../../src/modules/platform/settings/settings.controller';
import { SettingsService } from '../../src/modules/platform/settings/settings.service';
import { UsersService } from '../../src/modules/core/users/users.service';
import { TaskTypesService } from '../../src/modules/platform/task-types/task-types.service';

describe('Settings Center safety', () => {
  it('does not replace company details during a theme-only save', async () => {
    const settings = {
      get: jest.fn(), set: jest.fn(),
      upsertThemeDefaults: jest.fn().mockResolvedValue(undefined),
      getCompanyWithTheme: jest.fn().mockResolvedValue({ companyName: 'TechnoEdge', defaultTheme: 'john-wick-dark' }),
    };
    const controller = new SettingsController(settings as any, {} as any);
    await controller.updateCompany({ defaultTheme: 'john-wick-dark' }, { user: { sub: 'admin-1' } });
    expect(settings.upsertThemeDefaults).toHaveBeenCalledWith('john-wick-dark', undefined, 'admin-1');
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('preserves unspecified company fields in partial saves', async () => {
    const settings = {
      get: jest.fn().mockResolvedValue({ companyName: 'TechnoEdge', timezone: 'Asia/Kolkata' }),
      set: jest.fn().mockResolvedValue(undefined),
      getCompanyWithTheme: jest.fn().mockResolvedValue({}),
    };
    const controller = new SettingsController(settings as any, {} as any);
    await controller.updateCompany({ tagline: 'Better work' }, { user: { sub: 'admin-1' } });
    expect(settings.set).toHaveBeenCalledWith('company', { companyName: 'TechnoEdge', timezone: 'Asia/Kolkata', tagline: 'Better work' }, 'admin-1');
  });

  it('rejects an unapproved company theme', async () => {
    const service = new SettingsService({} as any, { log: jest.fn() } as any);
    await expect(service.upsertThemeDefaults('gen-z-pastel')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('merges notification and ticket defaults without dropping existing keys', async () => {
    const tx = {
      appSetting: {
        findUnique: jest.fn().mockResolvedValue({ value: { assignedTicket: false, channels: { assignedTicket: { popup: false } } } }),
        upsert: jest.fn().mockImplementation(async ({ update }: any) => ({ value: update.value })),
      },
    };
    const prisma = { $transaction: jest.fn().mockImplementation((operation: any) => operation(tx)) };
    const service = new UsersService(prisma as any, {} as any, {} as any, {} as any, {} as any);
    const saved = await service.savePreferences('person-1', { autoAssign: true, defaultPriority: 'HIGH' });
    expect(saved).toMatchObject({ assignedTicket: false, autoAssign: true, defaultPriority: 'HIGH' });
    expect(saved.channels.assignedTicket.popup).toBe(false);
  });

  it('rejects a profile image with mismatched content', async () => {
    const service = new UsersService({} as any, {} as any, {} as any, {} as any, {} as any);
    await expect(service.uploadPhoto('person-1', { mimetype: 'image/png', size: 3, buffer: Buffer.from('bad') } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to delete a task type referenced by tickets', async () => {
    const prisma = { ticket: { count: jest.fn().mockResolvedValue(2) }, taskType: { delete: jest.fn() } };
    const service = new TaskTypesService(prisma as any);
    await expect(service.deleteType('type-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.taskType.delete).not.toHaveBeenCalled();
  });

  it('keeps policy writes disabled until policy-version safeguards exist', () => {
    const controller = new SettingsController({} as any, {} as any);
    expect(() => controller.updateLeavePolicy()).toThrow(BadRequestException);
    expect(() => controller.updateSla()).toThrow(BadRequestException);
    expect(() => controller.updateWorkdayPolicy()).toThrow(BadRequestException);
  });
});
