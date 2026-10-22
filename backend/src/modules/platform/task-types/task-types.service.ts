import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class TaskTypesService {
  constructor(private prisma: PrismaService) {}

  private name(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
      throw new BadRequestException('Task type name must be 1 to 100 characters');
    }
    return value.trim();
  }

  // GET /task-types?departmentId=xxx
  // Returns dept-specific + global types with subtypes
  async getByDepartment(departmentId?: string) {
    const where = departmentId
      ? { OR: [{ departmentId }, { isGlobal: true }] }
      : { isGlobal: true };
    return this.prisma.taskType.findMany({
      where,
      include: { subtypes: { orderBy: [{ order: 'asc' }, { name: 'asc' }] } },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
  }

  // GET /task-types/all — admin only
  async getAll() {
    return this.prisma.taskType.findMany({
      include: {
        subtypes: { orderBy: [{ order: 'asc' }, { name: 'asc' }] },
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ departmentId: 'asc' }, { order: 'asc' }, { name: 'asc' }],
    });
  }

  async create(dto: { name: string; departmentId?: string; isGlobal?: boolean }) {
    return this.prisma.taskType.create({ data: { ...dto, name: this.name(dto.name) }, include: { subtypes: true } });
  }

  async createSubtype(taskTypeId: string, dto: { name: string }) {
    return this.prisma.taskSubtype.create({ data: { name: this.name(dto.name), taskTypeId } });
  }

  async updateType(id: string, dto: { name?: string; order?: number }) {
    return this.prisma.taskType.update({ where: { id }, data: { ...dto, ...(dto.name !== undefined ? { name: this.name(dto.name) } : {}) } });
  }

  async updateSubtype(subtypeId: string, dto: { name?: string; order?: number }) {
    return this.prisma.taskSubtype.update({ where: { id: subtypeId }, data: { ...dto, ...(dto.name !== undefined ? { name: this.name(dto.name) } : {}) } });
  }

  async deleteType(id: string) {
    const used = await this.prisma.ticket.count({ where: { OR: [{ taskTypeId: id }, { taskSubtype: { taskTypeId: id } }] } });
    if (used) throw new BadRequestException('This task type is used by tickets and cannot be deleted');
    try { return await this.prisma.taskType.delete({ where: { id } }); }
    catch (error: any) {
      if (error?.code === 'P2003') throw new BadRequestException('This task type is referenced by existing records');
      throw error;
    }
  }

  async deleteSubtype(subtypeId: string) {
    const used = await this.prisma.ticket.count({ where: { taskSubtypeId: subtypeId } });
    if (used) throw new BadRequestException('This subtype is used by tickets and cannot be deleted');
    try { return await this.prisma.taskSubtype.delete({ where: { id: subtypeId } }); }
    catch (error: any) {
      if (error?.code === 'P2003') throw new BadRequestException('This subtype is referenced by existing records');
      throw error;
    }
  }
}
