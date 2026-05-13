import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: { search?: string; departmentId?: string; roleId?: string }) {
    const where: any = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.roleId) where.roleId = query.roleId;

    const users = await this.prisma.user.findMany({
      where,
      include: { role: true, department: true },
      orderBy: { name: 'asc' },
    });
    return users.map(({ password, ...u }) => u);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true, department: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const { password, ...result } = user;
    return result;
  }

  async create(data: { name: string; email: string; password: string; roleId: string; departmentId?: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ConflictException('Email already registered');

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const user = await this.prisma.user.create({
      data: { ...data, password: hashedPassword },
      include: { role: true, department: true },
    });
    const { password, ...result } = user;
    return result;
  }

  async update(id: string, data: { name?: string; email?: string; roleId?: string; departmentId?: string; isActive?: boolean; avatar?: string }) {
    const user = await this.prisma.user.update({
      where: { id },
      data,
      include: { role: true, department: true },
    });
    const { password, ...result } = user;
    return result;
  }

  async resetPassword(id: string, newPassword: string) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id }, data: { password: hashedPassword } });
    return { message: 'Password reset successfully' };
  }

  async remove(id: string) {
    await this.prisma.user.update({ where: { id }, data: { isActive: false } });
    return { message: 'User deactivated' };
  }

  async getStats() {
    const [total, active, byRole, byDept] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.groupBy({ by: ['roleId'], _count: true }),
      this.prisma.user.groupBy({ by: ['departmentId'], _count: true }),
    ]);
    return { total, active, inactive: total - active, byRole, byDept };
  }
}
