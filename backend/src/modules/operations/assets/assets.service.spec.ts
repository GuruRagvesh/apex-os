import { AssetsService } from './assets.service';

describe('AssetsService overview loading', () => {
  const prisma = {
    companyAsset: { findMany: jest.fn() },
    assetAllocation: { findMany: jest.fn() },
    assetRequest: { findMany: jest.fn() },
    assetRentalPayment: { findMany: jest.fn() },
    assetMobileSubscription: { findMany: jest.fn() },
    assetRepair: { findMany: jest.fn() },
    assetType: { findMany: jest.fn() },
    assetImportBatch: { findMany: jest.fn() },
    assetAuditEvent: { findMany: jest.fn() },
  } as any;

  const service = new AssetsService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    for (const model of Object.values(prisma) as any[]) model.findMany.mockResolvedValue([]);
  });

  it('loads only registry records and asset types for the initial page', async () => {
    prisma.companyAsset.findMany.mockResolvedValue([{ id: 'asset-1' }]);
    prisma.assetType.findMany.mockResolvedValue([{ id: 'type-1' }]);

    const result = await service.overview('registry');

    expect(result.assets).toHaveLength(1);
    expect(result.types).toHaveLength(1);
    expect(prisma.companyAsset.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.assetType.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.assetAllocation.findMany).not.toHaveBeenCalled();
    expect(prisma.assetRequest.findMany).not.toHaveBeenCalled();
    expect(prisma.assetRentalPayment.findMany).not.toHaveBeenCalled();
    expect(prisma.assetMobileSubscription.findMany).not.toHaveBeenCalled();
    expect(prisma.assetRepair.findMany).not.toHaveBeenCalled();
    expect(prisma.assetImportBatch.findMany).not.toHaveBeenCalled();
  });

  it('loads allocations without mixing employee requests into the section', async () => {
    prisma.assetAllocation.findMany.mockResolvedValue([{ id: 'allocation-1' }]);

    const result = await service.overview('allocations');

    expect(result.allocations).toHaveLength(1);
    expect(result.requests).toHaveLength(0);
    expect(prisma.assetAllocation.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.assetRequest.findMany).not.toHaveBeenCalled();
    expect(prisma.companyAsset.findMany).not.toHaveBeenCalled();
    expect(prisma.assetType.findMany).not.toHaveBeenCalled();
  });

  it('loads employee asset tickets in the separate requests section', async () => {
    prisma.assetRequest.findMany.mockResolvedValue([{ id: 'request-1' }]);

    const result = await service.overview('requests');

    expect(result.requests).toHaveLength(1);
    expect(result.allocations).toHaveLength(0);
    expect(prisma.assetRequest.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.assetAllocation.findMany).not.toHaveBeenCalled();
  });

  it('loads imports and audit events as one activity log', async () => {
    prisma.assetImportBatch.findMany.mockResolvedValue([{ id: 'import-1' }]);
    prisma.assetAuditEvent.findMany.mockResolvedValue([{ id: 'event-1' }]);

    const result = await service.overview('activity');

    expect(result.imports).toHaveLength(1);
    expect(result.audit).toHaveLength(1);
    expect(prisma.assetImportBatch.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.assetAuditEvent.findMany).toHaveBeenCalledTimes(1);
  });

  it('falls back to the registry for an unknown section', async () => {
    await service.overview('unknown');

    expect(prisma.companyAsset.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.assetType.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('AssetsService allocation lifecycle', () => {
  const tx = {
    assetAllocation: { update: jest.fn() },
    companyAsset: { update: jest.fn() },
    assetRepair: { create: jest.fn() },
  };
  const prisma = {
    assetAllocation: { findUnique: jest.fn(), findMany: jest.fn() },
    assetAuditEvent: { create: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((work: any) => work(tx)),
  } as any;
  const service = new AssetsService(prisma);
  const actor = { id: 'admin-1', name: 'Admin', role: { name: 'ADMIN' } };
  const allocation = {
    id: 'allocation-1', assetId: 'asset-1', returned: false,
    asset: { id: 'asset-1', brandModel: 'Dell Latitude', specification: '16 GB RAM' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.assetAllocation.findUnique.mockResolvedValue(allocation);
    tx.assetAllocation.update.mockResolvedValue({ ...allocation, returned: true });
    tx.companyAsset.update.mockResolvedValue({});
    tx.assetRepair.create.mockResolvedValue({ id: 'repair-1' });
    prisma.assetAuditEvent.create.mockResolvedValue({});
  });

  it('returns a good-condition asset to the available registry without creating a repair', async () => {
    await service.returnAllocation(actor, allocation.id, { toDate: '2026-10-28', conditionAtReturn: 'Good', needsRepair: false });

    expect(tx.companyAsset.update).toHaveBeenCalledWith({ where: { id: 'asset-1' }, data: { status: 'AVAILABLE' } });
    expect(tx.assetRepair.create).not.toHaveBeenCalled();
  });

  it('routes a damaged return into Repairs in the same transaction', async () => {
    await service.returnAllocation(actor, allocation.id, { toDate: '2026-10-28', conditionAtReturn: 'Screen damaged', needsRepair: true });

    expect(tx.companyAsset.update).toHaveBeenCalledWith({ where: { id: 'asset-1' }, data: { status: 'IN_REPAIR' } });
    expect(tx.assetRepair.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      assetId: 'asset-1', brand: 'Dell Latitude', issues: 'Screen damaged', status: 'REPORTED',
    }) });
  });

  it('loads active allocations for an employee profile by user id, employee id, or imported name', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', employeeId: 'EMP-001', name: 'Asha Rao' });
    prisma.user.findMany.mockResolvedValue([
      { id: 'user-1', employeeId: 'EMP-001', name: 'Asha Rao' },
      { id: 'user-2', employeeId: 'EMP-002', name: 'Aniket Phapale' },
    ]);
    prisma.assetAllocation.findMany.mockResolvedValue([
      { id: 'allocation-1', employeeId: null, employeeName: 'Asha Kumari Rao' },
      { id: 'allocation-2', employeeId: null, employeeName: 'Aniket Dattatray Phapale' },
    ]);

    const result = await service.listUserAllocations(actor, 'user-1');

    expect(result).toHaveLength(1);
    expect(prisma.assetAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { returned: false },
    }));
    expect(result[0].id).toBe('allocation-1');
  });
});
