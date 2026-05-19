import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: { search?: string; departmentId?: string; roleId?: string; page?: number; limit?: number }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.roleId) where.roleId = query.roleId;

    const [total, rawUsers] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: { role: true, department: true },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    const users = rawUsers.map(({ password, ...u }) => u);
    return { users, total, page, limit, totalPages: Math.ceil(total / limit) };
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

  async update(id: string, data: { name?: string; email?: string; roleId?: string; departmentId?: string; isActive?: boolean; avatar?: string; photoUrl?: string | null }) {
    const user = await this.prisma.user.update({
      where: { id },
      data,
      include: { role: true, department: true },
    });
    const { password, ...result } = user;
    return result;
  }

  async uploadPhoto(userId: string, file: Express.Multer.File): Promise<{ photoUrl: string }> {
    const photoUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    await this.prisma.user.update({ where: { id: userId }, data: { photoUrl } });
    return { photoUrl };
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

  async getDirectory() {
    // Fetch all active users with role + dept
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      include: { role: true, department: true },
      orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
    });

    // Open ticket counts per user (single query)
    const openCounts = await this.prisma.ticket.groupBy({
      by: ['assignedToId'],
      where: {
        assignedToId: { not: null },
        status: { notIn: ['DONE', 'CLOSED'] },
      },
      _count: { id: true },
    });
    const countMap: Record<string, number> = {};
    openCounts.forEach((r) => { if (r.assignedToId) countMap[r.assignedToId] = r._count.id; });

    return users.map(({ password, ...u }) => ({
      ...u,
      ticketCount: countMap[u.id] ?? 0,
    }));
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
