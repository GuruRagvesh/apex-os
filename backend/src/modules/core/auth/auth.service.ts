import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto/login.dto';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { EmailService } from '../../platform/email/email.service';
import { UsersService } from '../users/users.service';

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
    private usersService: UsersService,
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

    // ── Login audit only — authentication is fully decoupled from the workday.
    // A login must NEVER create, revive, or mutate a WorkSession (Release A.3):
    // work sessions are owned exclusively by explicit workday actions (Start
    // Work / break / End Day). Here we only record the login event and refresh
    // the user's last-active timestamp — both live OUTSIDE the WorkSession table
    // and never touch workday status, startWorkAt, or break logs. The returned
    // user keeps whatever currentStatus the last workday action persisted.
    const now = new Date();
    try {
      await this.prisma.attendanceEvent.create({
        data: { userId: user.id, eventType: 'LOGIN', source: 'manual' },
      });
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastActiveAt: now },
      });
    } catch (e) {
      // Non-critical — never fail login if audit tracking fails.
      console.error('Login audit tracking error:', e);
    }

    this.eventLogger.log({ actorId: user.id, entityType: 'User', entityId: user.id, action: OperationalAction.USER_LOGIN }).catch(() => {});

    return { user: userWithoutPassword, ...tokens };
  }

  async register(dto: RegisterDto, actorId?: string) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.findUserByEmailCI(normalizedEmail);
    if (existing) throw new ConflictException('Email already registered');

    // Registration is another administrative user-creation entry point. It
    // must use the same atomic user + attendance-profile boundary as POST
    // /users, or a future caller could recreate NOT_EMPLOYED accounts.
    const user = await this.usersService.create(
      {
        email: normalizedEmail,
        name: dto.name,
        password: dto.password,
        roleId: dto.roleId,
        departmentId: dto.departmentId ?? null,
        joiningDate: dto.joiningDate,
      },
      actorId,
    );

    const tokens = await this.generateTokens(user.id, user.email);
    return { user, ...tokens };
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
