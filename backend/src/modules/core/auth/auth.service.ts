import { Injectable, UnauthorizedException, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto/login.dto';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';

@Injectable()
export class AuthService {
  /** In-memory OTP store: email → { otp, expires } */
  private otpStore = new Map<string, { otp: string; expires: number }>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private eventLogger: EventLoggerService,
  ) {}

  /** Case-insensitive email lookup — handles mixed-case addresses at login/OTP */
  private async findUserByEmailCI(email: string, include?: Record<string, boolean>) {
    return this.prisma.user.findFirst({
      where: { email: { equals: email.trim().toLowerCase(), mode: 'insensitive' } },
      ...(include ? { include } : {}),
    });
  }

  async login(dto: LoginDto) {
    const user = await this.findUserByEmailCI(dto.email, { role: true, department: true });

    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.generateTokens(user.id, user.email);
    const { password, ...userWithoutPassword } = user;

    // Create login attendance event
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();

    try {
      await this.prisma.workSession.upsert({
        where: { userId_date: { userId: user.id, date: today } },
        update: { loginAt: now, status: 'LOGGED_IN' },
        create: { userId: user.id, date: today, loginAt: now, status: 'LOGGED_IN' },
      });
      await this.prisma.attendanceEvent.create({
        data: { userId: user.id, eventType: 'LOGIN', source: 'manual' },
      });
      await this.prisma.user.update({
        where: { id: user.id },
        data: { currentStatus: 'LOGGED_IN', lastActiveAt: now },
      });
    } catch (e) {
      // Non-critical — don't fail login if attendance tracking fails
      console.error('Attendance tracking error on login:', e);
    }

    this.eventLogger.log({ actorId: user.id, entityType: 'User', entityId: user.id, action: OperationalAction.USER_LOGIN }).catch(() => {});

    return { user: userWithoutPassword, ...tokens };
  }

  async register(dto: RegisterDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.findUserByEmailCI(normalizedEmail);
    if (existing) throw new ConflictException('Email already registered');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        name: dto.name,
        password: hashedPassword,
        roleId: dto.roleId,
        departmentId: dto.departmentId,
      },
      include: { role: true, department: true },
    });

    const tokens = await this.generateTokens(user.id, user.email);
    const { password, ...userWithoutPassword } = user;

    return { user: userWithoutPassword, ...tokens };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) throw new UnauthorizedException('Current password is incorrect');

    const hashed = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed, mustChangePassword: false },
    });

    return { message: 'Password changed successfully' };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, department: true },
    });
    if (!user) throw new UnauthorizedException();
    const { password, ...result } = user;
    return result;
  }

  async findByEmail(email: string) {
    return this.findUserByEmailCI(email);
  }

  async updatePassword(userId: string, hashedPassword: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword, mustChangePassword: false },
    });
  }

  async sendOtp(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.findUserByEmailCI(normalizedEmail);
    if (!user) throw new NotFoundException('User not found');

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    this.otpStore.set(normalizedEmail, { otp, expires: Date.now() + 10 * 60 * 1000 }); // 10-min TTL
    // TODO: send via SMTP when configured — email.service.ts is wired but optional
    // SECURITY: OTP is never logged in production. Development-only trace.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[OTP:DEV] Reset requested for: ${normalizedEmail} — check email or SMTP logs`);
    }
    return { message: `OTP sent to ${normalizedEmail}` };
  }

  async resetPasswordWithOtp(email: string, otp: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const entry = this.otpStore.get(normalizedEmail);
    if (!entry) throw new BadRequestException('No OTP requested for this email');
    if (Date.now() > entry.expires) {
      this.otpStore.delete(normalizedEmail);
      throw new BadRequestException('OTP has expired — please request a new one');
    }
    if (entry.otp !== otp) throw new BadRequestException('Invalid OTP');

    const user = await this.findUserByEmailCI(normalizedEmail);
    if (!user) throw new NotFoundException('User not found');

    const hashed = await bcrypt.hash(newPassword, 12);
    await this.updatePassword(user.id, hashed);
    this.otpStore.delete(normalizedEmail);

    return { message: 'Password reset successfully' };
  }

  private async generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };
    // SECURITY: No fallback — main.ts already exits if JWT_SECRET is absent.
    // If this line is reached without the secret set, throw immediately rather
    // than silently signing with an undefined/weak key.
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) throw new Error('FATAL: JWT_SECRET is not configured');

    const accessToken = this.jwtService.sign(payload, {
      secret,
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') ?? '24h',
    });

    return { accessToken };
  }
}
