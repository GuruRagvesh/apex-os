import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto/login.dto';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { EmailService } from '../../platform/email/email.service';

/** Generic response used for both known and unknown emails — prevents enumeration. */
const OTP_GENERIC_RESPONSE = { message: 'If an account exists for that email, a reset code has been sent.' };

/** Unified error for all reset-path failures — prevents enumeration at step 2. */
const RESET_ERROR = 'Invalid or expired code';

@Injectable()
export class AuthService {
  /** In-memory OTP store: email → { otp, expires } */
  private otpStore = new Map<string, { otp: string; expires: number }>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private eventLogger: EventLoggerService,
    private emailService: EmailService,
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

    let nextStatus = 'LOGGED_IN';

    try {
      // Find today's latest session for this user WITHOUT relying on a
      // (userId, date) unique key — multiple same-day sessions are supported,
      // so we use findFirst (most-recent first) instead of findUnique/upsert.
      const existingSession = await this.prisma.workSession.findFirst({
        where: { userId: user.id, date: today },
        orderBy: { createdAt: 'desc' },
      });

      if (existingSession) {
        // A login must NEVER auto-start or revive a workday (Release A.2).
        // Preserve the existing session's status exactly — WORKING/ON_BREAK/IDLE
        // (refresh/restore), LOGGED_OUT (already ended), or ON_LEAVE. Only stamp
        // the latest loginAt by id; never touch status or startWorkAt.
        nextStatus = existingSession.status;
        await this.prisma.workSession.update({
          where: { id: existingSession.id },
          data: { loginAt: now },
        });
      } else {
        // No session yet today: create a fresh LOGGED_IN session. This does NOT
        // start work — startWork remains the only explicit path to WORKING.
        await this.prisma.workSession.create({
          data: { userId: user.id, date: today, loginAt: now, status: nextStatus },
        });
      }
      await this.prisma.attendanceEvent.create({
        data: { userId: user.id, eventType: 'LOGIN', source: 'manual' },
      });
      await this.prisma.user.update({
        where: { id: user.id },
        data: { currentStatus: nextStatus, lastActiveAt: now },
      });
    } catch (e) {
      // Non-critical — don't fail login if attendance tracking fails
      console.error('Attendance tracking error on login:', e);
    }

    userWithoutPassword.currentStatus = nextStatus;

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

    // Unknown email: return generic response without revealing account existence.
    // Do NOT store an OTP or call EmailService for unknown addresses.
    if (!user) return OTP_GENERIC_RESPONSE;

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Attempt email delivery BEFORE storing the OTP.
    // If the provider is unconfigured or fails, the exception propagates to
    // the controller (400) and no OTP is left in memory with no delivery channel.
    await this.emailService.sendOtpEmail(normalizedEmail, otp);

    // Email confirmed dispatched — store OTP with 10-minute TTL.
    this.otpStore.set(normalizedEmail, { otp, expires: Date.now() + 10 * 60 * 1000 });

    return OTP_GENERIC_RESPONSE;
  }

  async resetPasswordWithOtp(email: string, otp: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }

    const normalizedEmail = email.trim().toLowerCase();

    // All failure cases (unknown email, no OTP requested, wrong code, expired)
    // return the same message to prevent enumeration at step 2.
    const entry = this.otpStore.get(normalizedEmail);
    if (!entry) throw new BadRequestException(RESET_ERROR);
    if (Date.now() > entry.expires) {
      this.otpStore.delete(normalizedEmail);
      throw new BadRequestException(RESET_ERROR);
    }
    if (entry.otp !== otp) throw new BadRequestException(RESET_ERROR);

    const user = await this.findUserByEmailCI(normalizedEmail);
    if (!user) throw new BadRequestException(RESET_ERROR);

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
