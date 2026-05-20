import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class TaskTypesService {
  constructor(private prisma: PrismaService) {}

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
    return this.prisma.taskType.create({ data: dto, include: { subtypes: true } });
  }

  async createSubtype(taskTypeId: string, dto: { name: string }) {
    return this.prisma.taskSubtype.create({ data: { ...dto, taskTypeId } });
  }

  async updateType(id: string, dto: { name?: string; order?: number }) {
    return this.prisma.taskType.update({ where: { id }, data: dto });
  }

  async updateSubtype(subtypeId: string, dto: { name?: string; order?: number }) {
    return this.prisma.taskSubtype.update({ where: { id: subtypeId }, data: dto });
  }

  async deleteType(id: string) {
    return this.prisma.taskType.delete({ where: { id } });
  }

  async deleteSubtype(subtypeId: string) {
    return this.prisma.taskSubtype.delete({ where: { id: subtypeId } });
  }
}
