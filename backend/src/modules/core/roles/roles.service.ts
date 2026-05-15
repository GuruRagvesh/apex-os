import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.role.findMany({ orderBy: { level: 'asc' } });
  }

  findOne(id: string) {
    return this.prisma.role.findUnique({ where: { id } });
  }

  create(data: { name: string; level: number; description?: string }) {
    return this.prisma.role.create({ data });
  }

  update(id: string, data: { name?: string; level?: number; description?: string }) {
    return this.prisma.role.update({ where: { id }, data });
  }

  remove(id: string) {
    return this.prisma.role.delete({ where: { id } });
  }
}
