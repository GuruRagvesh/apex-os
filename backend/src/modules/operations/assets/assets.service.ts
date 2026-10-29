import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { matchAllocationUser } from './asset-allocation-user-match';

const clean = (value: unknown) => typeof value === 'string' ? value.trim() || null : value ?? null;
const date = (value: unknown) => value ? new Date(String(value)) : null;
const bool = (value: unknown) => value === true || ['yes', 'true', '1', 'returned', 'paid'].includes(String(value).toLowerCase());

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(section = 'registry') {
    const result: Record<string, any[]> = {
      assets: [], allocations: [], requests: [], rentals: [], mobile: [], repairs: [], types: [], imports: [], audit: [],
    };

    switch (section) {
      case 'allocations':
        result.allocations = await this.prisma.assetAllocation.findMany({ include: { asset: true }, orderBy: { fromDate: 'desc' } });
        break;
      case 'requests':
        result.requests = await this.prisma.assetRequest.findMany({ orderBy: { createdAt: 'desc' } });
        break;
      case 'rentals':
        result.rentals = await this.prisma.assetRentalPayment.findMany({ include: { asset: true }, orderBy: { periodMonth: 'desc' } });
        break;
      case 'mobile':
        result.mobile = await this.prisma.assetMobileSubscription.findMany({ include: { recharges: { orderBy: { billingMonth: 'desc' } } }, orderBy: { employeeName: 'asc' } });
        break;
      case 'repairs':
        result.repairs = await this.prisma.assetRepair.findMany({ include: { asset: true }, orderBy: { reportedDate: 'desc' } });
        break;
      case 'activity':
        [result.imports, result.audit] = await Promise.all([
          this.prisma.assetImportBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 25 }),
          this.prisma.assetAuditEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
        ]);
        break;
      case 'registry':
      default: {
        const [assets, types] = await Promise.all([
          this.prisma.companyAsset.findMany({ include: { assetType: true, allocations: { where: { returned: false }, take: 1 } }, orderBy: { assetCode: 'asc' } }),
          this.prisma.assetType.findMany({ orderBy: { name: 'asc' } }),
        ]);
        result.assets = assets;
        result.types = types;
      }
    }
    return result;
  }

  private async audit(user: any, entityType: string, entityId: string, action: string, before?: any, after?: any) {
    await this.prisma.assetAuditEvent.create({ data: { actorId: user.id, actorName: user.name, entityType, entityId, action, before: before ?? undefined, after: after ?? undefined } });
  }

  listAudit() { return this.prisma.assetAuditEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }); }

  async createType(user: any, body: any) {
    const name = String(body.name ?? '').trim().toUpperCase();
    if (!name) throw new BadRequestException('Asset type name is required.');
    const existing = await this.prisma.assetType.findUnique({ where: { name } });
    const row = await this.prisma.assetType.upsert({ where: { name }, update: { isActive: body.isActive !== false }, create: { name, isActive: body.isActive !== false } });
    await this.audit(user, 'ASSET_TYPE', row.id, existing ? 'REACTIVATED' : 'CREATED', existing ?? undefined, row);
    return row;
  }

  async createAsset(user: any, body: any) {
    const assetCode = String(body.assetCode ?? '').trim();
    const brandModel = String(body.brandModel ?? '').trim();
    const ownership = String(body.ownership ?? '').toUpperCase();
    if (!assetCode || !brandModel || !['OWNED', 'RENTED'].includes(ownership)) throw new BadRequestException('Asset ID, brand/model and owned/rented are required.');
    let assetTypeId = clean(body.assetTypeId) as string | null;
    const customTypeName = String(body.assetTypeName ?? '').trim().toUpperCase();
    if (customTypeName) {
      const existingType = await this.prisma.assetType.findUnique({ where: { name: customTypeName } });
      const assetType = await this.prisma.assetType.upsert({
        where: { name: customTypeName },
        update: { isActive: true },
        create: { name: customTypeName, isActive: true },
      });
      assetTypeId = assetType.id;
      if (!existingType) await this.audit(user, 'ASSET_TYPE', assetType.id, 'CREATED', undefined, assetType);
    }
    const row = await this.prisma.companyAsset.create({ data: {
      assetCode, brandModel, ownership, assetTypeId,
      specification: clean(body.specification) as string | null, modelNumber: clean(body.modelNumber) as string | null,
      vendorName: clean(body.vendorName) as string | null, acquisitionDate: date(body.acquisitionDate),
      vendorReturnDate: date(body.vendorReturnDate), purchaseCost: clean(body.purchaseCost) as any,
      monthlyRent: clean(body.monthlyRent) as any, status: String(body.status ?? 'AVAILABLE').toUpperCase(),
      chargerIncluded: bool(body.chargerIncluded), notes: clean(body.notes) as string | null,
    }, include: { assetType: true } });
    await this.audit(user, 'ASSET', row.id, 'CREATED', undefined, row);
    return row;
  }

  async updateAsset(user: any, id: string, body: any) {
    const before = await this.prisma.companyAsset.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Asset not found.');
    const row = await this.prisma.companyAsset.update({ where: { id }, data: {
      ...(body.assetCode !== undefined && { assetCode: String(body.assetCode).trim() }),
      ...(body.brandModel !== undefined && { brandModel: String(body.brandModel).trim() }),
      ...(body.assetTypeId !== undefined && { assetTypeId: clean(body.assetTypeId) as string | null }),
      ...(body.specification !== undefined && { specification: clean(body.specification) as string | null }),
      ...(body.modelNumber !== undefined && { modelNumber: clean(body.modelNumber) as string | null }),
      ...(body.ownership !== undefined && { ownership: String(body.ownership).toUpperCase() }),
      ...(body.vendorName !== undefined && { vendorName: clean(body.vendorName) as string | null }),
      ...(body.acquisitionDate !== undefined && { acquisitionDate: date(body.acquisitionDate) }),
      ...(body.vendorReturnDate !== undefined && { vendorReturnDate: date(body.vendorReturnDate) }),
      ...(body.purchaseCost !== undefined && { purchaseCost: clean(body.purchaseCost) as any }),
      ...(body.monthlyRent !== undefined && { monthlyRent: clean(body.monthlyRent) as any }),
      ...(body.status !== undefined && { status: String(body.status).toUpperCase() }),
      ...(body.chargerIncluded !== undefined && { chargerIncluded: bool(body.chargerIncluded) }),
      ...(body.notes !== undefined && { notes: clean(body.notes) as string | null }),
    }, include: { assetType: true } });
    await this.audit(user, 'ASSET', id, 'UPDATED', before, row);
    return row;
  }

  async createAllocation(user: any, body: any) {
    if (!body.assetId || !String(body.employeeName ?? '').trim() || !body.fromDate) throw new BadRequestException('Asset, employee name and from date are required.');
    const active = await this.prisma.assetAllocation.findFirst({ where: { assetId: body.assetId, returned: false } });
    if (active) throw new BadRequestException('This asset already has an active allocation.');
    const row = await this.prisma.$transaction(async tx => {
      const created = await tx.assetAllocation.create({ data: {
        assetId: body.assetId, employeeId: clean(body.employeeId) as string | null, employeeName: String(body.employeeName).trim(),
        branch: clean(body.branch) as string | null, fromDate: date(body.fromDate)!, toDate: date(body.toDate),
        conditionAtIssue: clean(body.conditionAtIssue) as string | null, hodManagerName: clean(body.hodManagerName) as string | null,
        accessories: body.accessories ?? undefined, workflowStatus: String(body.workflowStatus ?? 'ACTIVE_ASSIGNMENT'), remarks: clean(body.remarks) as string | null,
      }, include: { asset: true } });
      await tx.companyAsset.update({ where: { id: body.assetId }, data: { status: 'ALLOCATED' } });
      return created;
    });
    await this.audit(user, 'ALLOCATION', row.id, 'CREATED', undefined, row);
    return row;
  }

  async returnAllocation(user: any, id: string, body: any) {
    const before = await this.prisma.assetAllocation.findUnique({ where: { id }, include: { asset: true } });
    if (!before) throw new NotFoundException('Allocation not found.');
    if (before.returned) throw new BadRequestException('This allocation is already closed.');
    const needsRepair = bool(body.needsRepair);
    const returnedAt = date(body.toDate) ?? new Date();
    const row = await this.prisma.$transaction(async tx => {
      const updated = await tx.assetAllocation.update({ where: { id }, data: {
        returned: true, toDate: returnedAt, conditionAtReturn: clean(body.conditionAtReturn) as string | null,
        repairingCost: clean(body.repairingCost) as any, repairingDate: date(body.repairingDate), workflowStatus: 'CLOSED', remarks: clean(body.remarks) as string | null,
      }, include: { asset: true } });
      await tx.companyAsset.update({ where: { id: before.assetId }, data: { status: needsRepair ? 'IN_REPAIR' : 'AVAILABLE' } });
      if (needsRepair) {
        await tx.assetRepair.create({ data: {
          assetId: before.assetId,
          brand: before.asset.brandModel,
          specification: before.asset.specification,
          issues: String(clean(body.conditionAtReturn) ?? clean(body.remarks) ?? 'Returned asset requires repair or inspection.'),
          reportedDate: returnedAt,
          repairingDate: date(body.repairingDate),
          estimatedCost: clean(body.repairingCost) as any,
          status: 'REPORTED',
          remarks: clean(body.remarks) as string | null,
        } });
      }
      return updated;
    });
    await this.audit(user, 'ALLOCATION', id, 'RETURNED', before, row);
    return row;
  }

  async listUserAllocations(requester: any, userId: string) {
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(requester?.role?.name ?? requester?.role);
    if (!isAdmin && requester?.id !== userId) {
      throw new ForbiddenException('You can only view assets assigned to your own profile.');
    }
    const employee = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, employeeId: true, name: true, email: true } });
    if (!employee) throw new NotFoundException('Employee not found.');
    const [users, allocations] = await Promise.all([
      this.prisma.user.findMany({ select: { id: true, employeeId: true, name: true, email: true } }),
      this.prisma.assetAllocation.findMany({
        where: { returned: false },
        include: { asset: { include: { assetType: true } } },
        orderBy: { fromDate: 'desc' },
      }),
    ]);

    return allocations.filter(allocation => matchAllocationUser(allocation, users)?.id === employee.id);
  }

  async createRepair(user: any, body: any) {
    if (!String(body.brand ?? '').trim() || !String(body.issues ?? '').trim()) throw new BadRequestException('Laptop brand and issue are required.');
    const row = await this.prisma.assetRepair.create({ data: {
      assetId: clean(body.assetId) as string | null, brand: String(body.brand).trim(), specification: clean(body.specification) as string | null,
      issues: String(body.issues).trim(), reportedDate: date(body.reportedDate) ?? new Date(), repairingDate: date(body.repairingDate),
      expectedCompletionDate: date(body.expectedCompletionDate), estimatedCost: clean(body.estimatedCost) as any,
      status: String(body.status ?? 'REPORTED').toUpperCase(), repairVendor: clean(body.repairVendor) as string | null, remarks: clean(body.remarks) as string | null,
    }, include: { asset: true } });
    if (row.assetId) await this.prisma.companyAsset.update({ where: { id: row.assetId }, data: { status: 'IN_REPAIR' } });
    await this.audit(user, 'REPAIR', row.id, 'CREATED', undefined, row);
    return row;
  }

  async createRequest(user: any, body: any) {
    const allowedTypes = ['ASSET_REQUEST', 'ASSET_RETURN', 'ASSET_REPLACEMENT', 'MULTIPLE_ASSETS', 'ASSET_REPAIR', 'ASSET_DAMAGE', 'OTHER'];
    const requestType = String(body.requestType ?? 'ASSET_REQUEST').trim().toUpperCase();
    if (!allowedTypes.includes(requestType)) throw new BadRequestException('Choose a valid asset request type.');
    if (!String(body.reason ?? '').trim()) throw new BadRequestException('Request details are required.');
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role?.name);
    const requestedItems = Array.isArray(body.requestedItems) ? body.requestedItems.slice(0, 25).map((item: any) => ({
      assetType: clean(item?.assetType), assetCode: clean(item?.assetCode), assetId: clean(item?.assetId),
      quantity: Math.max(1, Math.min(50, Number(item?.quantity) || 1)), notes: clean(item?.notes),
    })).filter((item: any) => item.assetType || item.assetCode || item.assetId) : [];
    const requestedAssetType = clean(body.requestedAssetType) as string | null;
    if (['ASSET_REQUEST', 'ASSET_REPLACEMENT', 'MULTIPLE_ASSETS'].includes(requestType) && !requestedAssetType && !requestedItems.length) {
      throw new BadRequestException('Add at least one requested asset or asset type.');
    }
    const requestCode = `AR-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const row = await this.prisma.assetRequest.create({ data: {
      requestCode, requestType, employeeId: isAdmin ? clean(body.employeeId) as string | null : (user.employeeId ?? user.id),
      employeeName: isAdmin && clean(body.employeeName) ? String(body.employeeName).trim() : user.name,
      department: clean(body.department) as string | null ?? user.department?.name ?? null,
      branch: clean(body.branch) as string | null ?? user.workLocation ?? user.userLocation ?? null,
      managerName: clean(body.managerName) as string | null ?? user.reportingManager ?? null,
      requestedAssetType, requestedItems: requestedItems.length ? requestedItems : undefined,
      linkedAssetId: clean(body.linkedAssetId) as string | null, reason: String(body.reason).trim(),
      priority: String(body.priority ?? 'MEDIUM').toUpperCase(), requiredByDate: date(body.requiredByDate),
    } });
    await this.audit(user, 'REQUEST', row.id, 'CREATED', undefined, row);
    return row;
  }

  listMyRequests(user: any) {
    return this.prisma.assetRequest.findMany({
      where: { employeeId: { in: [user.employeeId, user.id].filter(Boolean) } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateRequest(user: any, id: string, body: any) {
    const before = await this.prisma.assetRequest.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Request not found.');
    const row = await this.prisma.assetRequest.update({ where: { id }, data: {
      ...(body.status !== undefined && { status: String(body.status).toUpperCase() }),
      ...(body.adminOwner !== undefined && { adminOwner: clean(body.adminOwner) as string | null }),
      ...(body.managerRemark !== undefined && { managerRemark: clean(body.managerRemark) as string | null }),
      ...(body.adminRemark !== undefined && { adminRemark: clean(body.adminRemark) as string | null }),
    } });
    await this.audit(user, 'REQUEST', id, 'UPDATED', before, row);
    return row;
  }

  async updateRental(user: any, id: string, body: any) {
    const before = await this.prisma.assetRentalPayment.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Rental record not found.');
    const row = await this.prisma.assetRentalPayment.update({ where: { id }, data: {
      ...(body.paid !== undefined && { paid: bool(body.paid) }),
      ...(body.approvedBy !== undefined && { approvedBy: clean(body.approvedBy) as string | null }),
    }, include: { asset: true } });
    await this.audit(user, 'RENTAL_PAYMENT', id, 'UPDATED', before, row);
    return row;
  }

  async updateRepair(user: any, id: string, body: any) {
    const before = await this.prisma.assetRepair.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Repair record not found.');
    const status = body.status !== undefined ? String(body.status).toUpperCase() : undefined;
    const row = await this.prisma.assetRepair.update({ where: { id }, data: {
      ...(status && { status }), ...(body.repairVendor !== undefined && { repairVendor: clean(body.repairVendor) as string | null }),
      ...(body.finalCost !== undefined && { finalCost: clean(body.finalCost) as any }),
      ...(body.outcome !== undefined && { outcome: clean(body.outcome) as string | null }),
      ...(body.responsibility !== undefined && { responsibility: clean(body.responsibility) as string | null }),
      ...(status === 'COMPLETED' && { completedDate: date(body.completedDate) ?? new Date() }),
    }, include: { asset: true } });
    if (row.assetId && status === 'COMPLETED') await this.prisma.companyAsset.update({ where: { id: row.assetId }, data: { status: 'AVAILABLE' } });
    await this.audit(user, 'REPAIR', id, 'UPDATED', before, row);
    return row;
  }

  async updateMobile(user: any, id: string, body: any) {
    const before = await this.prisma.assetMobileSubscription.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Mobile/SIM record not found.');
    const row = await this.prisma.assetMobileSubscription.update({ where: { id }, data: {
      ...(body.status !== undefined && { status: String(body.status).toUpperCase() }),
      ...(body.employeeName !== undefined && { employeeName: String(body.employeeName).trim() }),
      ...(body.plan !== undefined && { plan: clean(body.plan) as string | null }),
      ...(body.dueDate !== undefined && { dueDate: date(body.dueDate) }),
    } });
    await this.audit(user, 'MOBILE_SUBSCRIPTION', id, 'UPDATED', before, row);
    return row;
  }

  async createRecharge(user: any, id: string, body: any) {
    const subscription = await this.prisma.assetMobileSubscription.findUnique({ where: { id } });
    if (!subscription) throw new NotFoundException('Mobile/SIM record not found.');
    const billingMonth = date(body.billingMonth);
    if (!billingMonth || clean(body.amount) === null) throw new BadRequestException('Billing month and amount are required.');
    billingMonth.setUTCDate(1);
    const row = await this.prisma.$transaction(async tx => {
      const recharge = await tx.assetMobileRecharge.upsert({ where: { subscriptionId_billingMonth: { subscriptionId: id, billingMonth } }, update: {
        rechargeDate: date(body.rechargeDate), dueDate: date(body.dueDate), plan: clean(body.plan) as string | null, amount: body.amount,
      }, create: { subscriptionId: id, billingMonth, rechargeDate: date(body.rechargeDate), dueDate: date(body.dueDate), plan: clean(body.plan) as string | null, amount: body.amount } });
      await tx.assetMobileSubscription.update({ where: { id }, data: { lastRechargeDate: date(body.rechargeDate), dueDate: date(body.dueDate), plan: clean(body.plan) as string | null, amount: body.amount } });
      return recharge;
    });
    await this.audit(user, 'MOBILE_RECHARGE', row.id, 'RECORDED', undefined, row);
    return row;
  }
}
