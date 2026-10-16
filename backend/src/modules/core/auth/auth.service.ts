import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
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
  private otpStore = new Map<string, { otp: string; expires: number; userId: string; emailAtIssue: string; issuedAt: number; codeId: string }>();

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

    // A system principal (the Deleted account) is never a login, whatever its state.
    if (!user || (user as any).isSystemAccount) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) {
      // Someone scheduled to join is told when their account starts, but only
      // after the right password, so the message reveals nothing to a guesser.
      const scheduledFor = (user as any).employmentState === 'SCHEDULED_TO_JOIN' ? (user as any).scheduledActivationOn as Date | null : null;
      if (scheduledFor && (await bcrypt.compare(dto.password, user.password))) {
        const startsOn = scheduledFor.toISOString().slice(0, 10);
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.COMPANY_TIMEZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        throw new UnauthorizedException({
          message: startsOn > today
            ? `Your account starts on ${startsOn}. You can sign in from that date.`
            : 'Your account is being activated. Please try again in a few minutes.',
          code: 'ACCOUNT_SCHEDULED_TO_JOIN',
        });
      }
      throw new UnauthorizedException('Invalid credentials');
    }

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
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128 || newPassword.trim().length === 0) {
      throw new BadRequestException('Password must be between 8 and 128 characters and cannot be blank.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const isValid = await bcrypt.compare(currentPassword, user.password);
    // 400, not 401: the browser treats every 401 as an expired session and
    // signs the user out, which a mistyped current password must not do.
    if (!isValid) throw new BadRequestException('Current password is incorrect');

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
    // Do NOT store an OTP or call EmailService for unknown addresses. Inactive,
    // archived and system accounts are treated the same way.
    if (!user || !user.isActive || (user as any).isSystemAccount) return OTP_GENERIC_RESPONSE;

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Attempt email delivery BEFORE storing the OTP.
    // If the provider is unconfigured or fails, the exception propagates to
    // the controller (400) and no OTP is left in memory with no delivery channel.
    await this.emailService.sendOtpEmail(normalizedEmail, otp);

    // Email confirmed dispatched — store OTP with 10-minute TTL, bound to THIS
    // account: its id, the email it was sent to, when, and a one-time id. A code
    // issued before an archive, rehire or deletion can never reset the account
    // that holds the email afterwards.
    this.otpStore.set(normalizedEmail, {
      otp,
      expires: Date.now() + 10 * 60 * 1000,
      userId: user.id,
      emailAtIssue: normalizedEmail,
      issuedAt: Date.now(),
      codeId: randomUUID(),
    });

    return OTP_GENERIC_RESPONSE;
  }

  async resetPasswordWithOtp(email: string, otp: string, newPassword: string) {
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128 || newPassword.trim().length === 0) {
      throw new BadRequestException('Password must be between 8 and 128 characters and cannot be blank.');
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
    const revokedAt = (user as any)?.sessionsRevokedAt as Date | null | undefined;
    if (
      !user ||
      user.id !== entry.userId ||
      entry.emailAtIssue !== normalizedEmail ||
      !user.isActive ||
      (user as any).isSystemAccount ||
      (revokedAt && revokedAt.getTime() >= entry.issuedAt)
    ) {
      this.otpStore.delete(normalizedEmail);
      throw new BadRequestException(RESET_ERROR);
    }
    // One-time: consumed before the password changes.
    this.otpStore.delete(normalizedEmail);

    const hashed = await bcrypt.hash(newPassword, 12);
    await this.updatePassword(user.id, hashed);

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
