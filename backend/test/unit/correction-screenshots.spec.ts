import { BadRequestException, NotFoundException } from '@nestjs/common';
import { validateScreenshots, MAX_SCREENSHOT_BYTES } from '../../src/modules/platform/attendance/regularization/correction-screenshot';
import { RegularizationService } from '../../src/modules/platform/attendance/regularization/regularization.service';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const upload = () => ({ buffer: png, size: png.length, mimetype: 'image/png', originalname: '../failure.png' });
function setup() {
  const prisma = {
    attendanceRegularization: { findUnique: jest.fn().mockResolvedValue({ id: 'request', userId: 'owner' }), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'request' }), findMany: jest.fn().mockResolvedValue([]) },
    correctionScreenshot: { findFirst: jest.fn().mockResolvedValue({ id: 'image', content: png }) },
    dailyAttendance: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const hierarchy = { isApproverFor: jest.fn().mockResolvedValue(false) };
  const access = { isHrOrAdmin: jest.fn().mockReturnValue(false) };
  const svc = new RegularizationService(prisma as any, { companyDateOnly: (date: Date) => date } as any, { log: jest.fn().mockResolvedValue(undefined) } as any, hierarchy as any, access as any, { get: jest.fn().mockResolvedValue({ regularizationEnabled: true }) } as any, {} as any);
  return { svc, prisma, hierarchy, access };
}
describe('Correction screenshot supporting attachments', () => {
  it('accepts an actual small screenshot without camera-size/liveness requirements and strips paths', () => {
    const [file] = validateScreenshots([upload()]); expect(file.filename).toBe('failure.png'); expect(file.content).toEqual(png);
  });
  it.each([
    ['too many', () => Array.from({ length: 4 }, upload)],
    ['oversized', () => [{ ...upload(), buffer: Buffer.alloc(MAX_SCREENSHOT_BYTES + 1), size: MAX_SCREENSHOT_BYTES + 1 }]],
    ['SVG disguised as PNG', () => [{ ...upload(), buffer: Buffer.from('<svg onload="alert(1)"/>'), size: 24 }]],
    ['wrong MIME', () => [{ ...upload(), mimetype: 'image/jpeg' }]],
    ['empty', () => [{ ...upload(), buffer: Buffer.alloc(0), size: 0 }]],
  ])('rejects %s', (_, files) => expect(() => validateScreenshots(files())).toThrow(BadRequestException));
  it('writes screenshots atomically with the employee request and returns only file metadata', async () => {
    const { svc, prisma } = setup();
    await svc.create('owner', { businessDate: '2026-10-06', requestType: 'MISSING_PUNCH', reason: 'System failed before punching in.' }, [upload()]);
    const input = prisma.attendanceRegularization.create.mock.calls[0][0];
    expect(input.data.userId).toBe('owner'); expect(input.data.screenshots.create[0].content).toEqual(png); expect(input.include.screenshots.select.content).toBeUndefined();
  });
  it('leaves the request uncreated when attachment validation fails', async () => {
    const { svc, prisma } = setup(); await expect(svc.create('owner', {} as any, [{ ...upload(), mimetype: 'text/html' }])).rejects.toThrow(); expect(prisma.attendanceRegularization.create).not.toHaveBeenCalled();
  });
  it('blocks unrelated employees before reading any image bytes', async () => {
    const { svc, prisma } = setup(); await expect(svc.screenshot({ id: 'stranger' }, 'request', 'image')).rejects.toThrow(NotFoundException); expect(prisma.correctionScreenshot.findFirst).not.toHaveBeenCalled();
  });
  it.each(['owner', 'manager', 'hr'])('allows the existing %s authorization path', async role => {
    const { svc, prisma, hierarchy, access } = setup(); if (role === 'manager') hierarchy.isApproverFor.mockResolvedValue(true); if (role === 'hr') access.isHrOrAdmin.mockReturnValue(true);
    await expect(svc.screenshot({ id: role }, 'request', 'image')).resolves.toMatchObject({ content: png }); expect(prisma.correctionScreenshot.findFirst).toHaveBeenCalledWith({ where: { id: 'image', regularizationId: 'request' } });
  });
  it('rejects an image id from a different request', async () => { const { svc, prisma } = setup(); prisma.correctionScreenshot.findFirst.mockResolvedValue(null); await expect(svc.screenshot({ id: 'owner' }, 'request', 'elsewhere')).rejects.toThrow(NotFoundException); });
  it('does not select bytes in employee/reviewer lists', async () => { const { svc, prisma, access } = setup(); await svc.listMine('owner'); access.isHrOrAdmin.mockReturnValue(true); await svc.pendingFor({ id: 'hr' }); for (const [input] of prisma.attendanceRegularization.findMany.mock.calls) expect(input.include.screenshots.select.content).toBeUndefined(); });
});
