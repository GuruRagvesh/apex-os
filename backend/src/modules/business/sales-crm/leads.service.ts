import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SalesAccessService } from '../../../common/services/sales-access.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';

const LEAD_OWNER_INCLUDE = { owner: { select: { id: true, name: true, email: true, avatar: true } } };

const LEAD_UPDATE_FIELDS = [
  'company', 'poc', 'email', 'phone', 'alternatePhone', 'designation', 'location',
  'linkedin', 'website', 'leadSource', 'priority', 'headquarters', 'department',
  'companySize', 'industry', 'serviceInterest', 'score', 'age', 'tags', 'customFields',
  'initialNotes',
] as const;

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private access: SalesAccessService,
    private accessPolicy: AccessPolicyService,
    private eventLogger: EventLoggerService,
  ) {}

  async findAll(query: any, user: any) {
    const where = await this.access.buildLeadWhereForUser(query, user);
    return this.prisma.lead.findMany({
      where,
      include: LEAD_OWNER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: any) {
    return this.access.findAccessibleLead(id, user, {
      ...LEAD_OWNER_INCLUDE,
      activities: { orderBy: { occurredAt: 'desc' }, include: { createdBy: { select: { id: true, name: true } } } },
      followups: { orderBy: { createdAt: 'desc' }, include: { createdBy: { select: { id: true, name: true } } } },
      requirements: { orderBy: { createdAt: 'desc' }, include: { owner: { select: { id: true, name: true } } } },
      deals: { orderBy: { createdAt: 'desc' } },
    });
  }

  async create(body: any, user: any) {
    if (!body?.company?.trim() || !body?.poc?.trim() || !body?.email?.trim() || !body?.phone?.trim()) {
      throw new BadRequestException('company, poc, email, and phone are required');
    }

    await this.assertNoDuplicate({ phone: body.phone, alternatePhone: body.alternatePhone, email: body.email });

    let ownerId = user.id;
    if (body.ownerId && body.ownerId !== user.id) {
      if (!this.accessPolicy.isAdmin(user)) {
        throw new BadRequestException('Only admins can assign a lead to another owner at creation');
      }
      ownerId = body.ownerId;
    }
    const owner = await this.resolveActiveUser(ownerId, 'Owner');

    const leadStage = body.leadStage || 'Created';
    const lead = await this.prisma.lead.create({
      data: {
        company: body.company.trim(),
        poc: body.poc.trim(),
        email: body.email.trim(),
        phone: body.phone.trim(),
        alternatePhone: body.alternatePhone || undefined,
        designation: body.designation || undefined,
        location: body.location || undefined,
        linkedin: body.linkedin || undefined,
        website: body.website || undefined,
        leadStage,
        leadSource: body.leadSource || undefined,
        priority: body.priority || 'Medium',
        headquarters: body.headquarters || undefined,
        department: body.department || undefined,
        companySize: body.companySize || undefined,
        industry: body.industry || undefined,
        serviceInterest: body.serviceInterest || undefined,
        score: body.score ?? undefined,
        age: body.age ?? undefined,
        tags: body.tags ?? undefined,
        customFields: body.customFields ?? undefined,
        initialNotes: body.initialNotes || undefined,
        ownerId: owner.id,
        departmentId: owner.departmentId,
        lastActivityDate: new Date(),
        activities: {
          create: {
            activityType: 'Created',
            comment: body.initialNotes?.trim() || 'Lead created',
            newStage: leadStage,
            createdById: user.id,
          },
        },
      },
      include: LEAD_OWNER_INCLUDE,
    });

    this.eventLogger.log({
      actorId: user.id,
      entityType: 'Lead',
      entityId: lead.id,
      action: OperationalAction.LEAD_CREATED,
      metadata: { company: lead.company, email: lead.email, ownerId: lead.ownerId },
    }).catch(() => {});

    return lead;
  }

  async update(id: string, body: any, user: any) {
    const lead = await this.access.findAccessibleLead(id, user);
    await this.access.assertCanEditLead(user, lead);

    if (body.phone !== undefined || body.alternatePhone !== undefined || body.email !== undefined) {
      await this.assertNoDuplicate(
        {
          phone: body.phone ?? lead.phone,
          alternatePhone: body.alternatePhone ?? lead.alternatePhone,
          email: body.email ?? lead.email,
        },
        lead.id,
      );
    }

    const data: any = {};
    for (const field of LEAD_UPDATE_FIELDS) {
      if (body[field] !== undefined) data[field] = body[field];
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No updatable fields provided');
    }

    const updated = await this.prisma.lead.update({ where: { id }, data, include: LEAD_OWNER_INCLUDE });

    this.eventLogger.log({
      actorId: user.id,
      entityType: 'Lead',
      entityId: id,
      action: OperationalAction.LEAD_UPDATED,
      metadata: { before: this.pick(lead, Object.keys(data)), after: data },
    }).catch(() => {});

    return updated;
  }

  async reassignOwner(id: string, body: any, user: any) {
    const lead = await this.access.findAccessibleLead(id, user);
    await this.access.assertCanChangeLeadOwner(user, lead);

    if (!body?.ownerId) throw new BadRequestException('ownerId is required');
    const newOwner = await this.resolveActiveUser(body.ownerId, 'New owner');

    const updated = await this.prisma.lead.update({
      where: { id },
      data: { ownerId: newOwner.id, departmentId: newOwner.departmentId },
      include: LEAD_OWNER_INCLUDE,
    });

    this.eventLogger.log({
      actorId: user.id,
      entityType: 'Lead',
      entityId: id,
      action: OperationalAction.LEAD_OWNER_CHANGED,
      fromState: lead.ownerId,
      toState: newOwner.id,
    }).catch(() => {});

    return updated;
  }

  async bulkUpdate(body: any, user: any) {
    await this.access.assertCanBulkManageLeads(user);

    const ids: string[] = Array.isArray(body?.leadIds) ? body.leadIds : [];
    if (ids.length === 0) throw new BadRequestException('leadIds is required');

    const scopeWhere = await this.access.buildLeadWhereForUser({}, user);
    const scopedWhere = Object.keys(scopeWhere).length > 0 ? { AND: [{ id: { in: ids } }, scopeWhere] } : { id: { in: ids } };
    const inScope = await this.prisma.lead.findMany({
      where: scopedWhere,
      select: { id: true, ownerId: true, leadStage: true },
    });
    if (inScope.length === 0) {
      throw new BadRequestException('None of the selected leads are in your scope');
    }

    let newOwner: { id: string; departmentId: string | null } | null = null;
    if (body.ownerId) {
      newOwner = await this.resolveActiveUser(body.ownerId, 'ownerId');
    }

    const data: any = {};
    if (newOwner) {
      data.ownerId = newOwner.id;
      data.departmentId = newOwner.departmentId;
    }
    if (body.leadStage) data.leadStage = body.leadStage;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to update — provide ownerId and/or leadStage');
    }

    const inScopeIds = inScope.map((l) => l.id);
    await this.prisma.lead.updateMany({ where: { id: { in: inScopeIds } }, data });

    for (const original of inScope) {
      if (newOwner) {
        this.eventLogger.log({
          actorId: user.id, entityType: 'Lead', entityId: original.id,
          action: OperationalAction.LEAD_OWNER_CHANGED, fromState: original.ownerId, toState: newOwner.id,
        }).catch(() => {});
      }
      if (body.leadStage) {
        this.eventLogger.log({
          actorId: user.id, entityType: 'Lead', entityId: original.id,
          action: OperationalAction.LEAD_STAGE_CHANGED, fromState: original.leadStage, toState: body.leadStage,
        }).catch(() => {});
      }
    }

    return { updated: inScopeIds.length, skipped: ids.length - inScopeIds.length };
  }

  async addActivity(id: string, body: any, user: any) {
    const lead = await this.access.findAccessibleLead(id, user);

    const isStageChange = Boolean(body.stage && body.stage !== lead.leadStage);
    if (isStageChange) {
      await this.access.assertCanEditLead(user, lead);
    }

    const activity = await this.prisma.leadActivity.create({
      data: {
        leadId: id,
        activityType: body.activityType || (isStageChange ? 'Stage Change' : 'Note'),
        comment: body.comment || undefined,
        previousStage: isStageChange ? lead.leadStage : undefined,
        newStage: isStageChange ? body.stage : undefined,
        createdById: user.id,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    const leadUpdateData: any = { lastActivityDate: new Date() };
    if (isStageChange) leadUpdateData.leadStage = body.stage;
    await this.prisma.lead.update({ where: { id }, data: leadUpdateData });

    if (body.followupDate) {
      await this.prisma.followUp.create({
        data: {
          leadId: id,
          type: body.followupType || activity.activityType,
          note: body.followupNote || undefined,
          followupDate: body.followupDate,
          followupTime: body.followupTime || undefined,
          status: 'Pending',
          createdById: user.id,
        },
      });
      this.eventLogger.log({
        actorId: user.id, entityType: 'Lead', entityId: id, action: OperationalAction.LEAD_FOLLOWUP_ADDED,
      }).catch(() => {});
    }

    if (isStageChange) {
      this.eventLogger.log({
        actorId: user.id, entityType: 'Lead', entityId: id, action: OperationalAction.LEAD_STAGE_CHANGED,
        fromState: lead.leadStage, toState: body.stage,
      }).catch(() => {});
    } else {
      this.eventLogger.log({
        actorId: user.id, entityType: 'Lead', entityId: id, action: OperationalAction.LEAD_ACTIVITY_ADDED,
        metadata: { activityType: activity.activityType },
      }).catch(() => {});
    }

    return activity;
  }

  async addFollowup(id: string, body: any, user: any) {
    await this.access.findAccessibleLead(id, user);
    if (!body?.followupDate) throw new BadRequestException('followupDate is required');

    const followup = await this.prisma.followUp.create({
      data: {
        leadId: id,
        type: body.type || 'General',
        note: body.note || undefined,
        followupDate: body.followupDate,
        followupTime: body.followupTime || undefined,
        status: body.status || 'Pending',
        createdById: user.id,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    this.eventLogger.log({
      actorId: user.id, entityType: 'Lead', entityId: id, action: OperationalAction.LEAD_FOLLOWUP_ADDED,
    }).catch(() => {});

    return followup;
  }

  async addRequirement(id: string, body: any, user: any) {
    await this.access.findAccessibleLead(id, user);
    if (!body?.title?.trim()) throw new BadRequestException('title is required');

    const requirement = await this.prisma.requirement.create({
      data: {
        leadId: id,
        title: body.title.trim(),
        details: body.details || undefined,
        priority: body.priority || 'Medium',
        status: body.status || 'New Requirement',
        timeline: body.timeline || undefined,
        ownerId: body.ownerId || user.id,
      },
      include: { owner: { select: { id: true, name: true } } },
    });

    this.eventLogger.log({
      actorId: user.id, entityType: 'Lead', entityId: id, action: OperationalAction.LEAD_REQUIREMENT_ADDED,
    }).catch(() => {});

    return requirement;
  }

  async addDeal(id: string, body: any, user: any) {
    await this.access.findAccessibleLead(id, user);

    const deal = await this.prisma.deal.create({
      data: {
        leadId: id,
        requirementId: body.requirementId || undefined,
        stage: body.stage || 'Proposal Sent',
        value: body.value ?? 0,
        paymentStatus: body.paymentStatus || undefined,
        expectedCloseAt: body.expectedCloseAt ? new Date(body.expectedCloseAt) : undefined,
      },
    });

    this.eventLogger.log({
      actorId: user.id, entityType: 'Lead', entityId: id, action: OperationalAction.LEAD_DEAL_ADDED,
    }).catch(() => {});

    return deal;
  }

  async remove(id: string, user: any) {
    const lead = await this.access.findAccessibleLead(id, user);
    await this.access.assertCanDeleteLead(user);

    await this.prisma.lead.delete({ where: { id } });

    this.eventLogger.log({
      actorId: user.id,
      entityType: 'Lead',
      entityId: id,
      action: OperationalAction.LEAD_DELETED,
      metadata: { company: lead.company, email: lead.email, phone: lead.phone, ownerId: lead.ownerId },
    }).catch(() => {});

    return { success: true };
  }

  private pick(source: Record<string, any>, keys: string[]): Record<string, any> {
    const result: Record<string, any> = {};
    for (const key of keys) result[key] = source[key];
    return result;
  }

  private async resolveActiveUser(userId: string, label: string): Promise<{ id: string; departmentId: string | null }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true, departmentId: true } });
    if (!user || !user.isActive) {
      throw new BadRequestException(`${label} must be a real, active user`);
    }
    return user;
  }

  private async assertNoDuplicate(data: { phone?: string; alternatePhone?: string | null; email: string }, excludeId?: string) {
    const phoneValues = [data.phone, data.alternatePhone].filter((v): v is string => Boolean(v));
    const orConditions: any[] = [{ email: { equals: data.email, mode: 'insensitive' } }];
    for (const phone of phoneValues) {
      orConditions.push({ phone }, { alternatePhone: phone });
    }

    const where: any = { OR: orConditions };
    if (excludeId) where.id = { not: excludeId };

    const duplicate = await this.prisma.lead.findFirst({ where, select: { id: true, company: true, email: true } });
    if (duplicate) {
      const reason = duplicate.email?.toLowerCase() === data.email?.toLowerCase() ? 'email' : 'phone number';
      throw new ConflictException(`A lead with this ${reason} already exists (${duplicate.company})`);
    }
  }
}
