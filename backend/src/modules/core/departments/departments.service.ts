import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const departments = await this.prisma.department.findMany({
      include: { _count: { select: { users: true, tickets: true, projects: true } } },
      orderBy: { name: 'asc' },
    });
    return departments;
  }

  findOne(id: string) {
    return this.prisma.department.findUnique({
      where: { id },
      include: {
        users: { include: { role: true }, take: 10 },
        _count: { select: { users: true, tickets: true, projects: true } },
      },
    });
  }

  create(data: { name: string; description?: string; color?: string }) {
    return this.prisma.department.create({ data });
  }

  update(id: string, data: { name?: string; description?: string; color?: string }) {
    return this.prisma.department.update({ where: { id }, data });
  }

  remove(id: string) {
    return this.prisma.department.delete({ where: { id } });
  }
}
