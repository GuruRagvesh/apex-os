import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    // SECURITY: No fallback default — throws if JWT_SECRET absent.
    // main.ts guards this at startup; the explicit undefined here surfaces
    // any test/import bypass rather than silently accepting unknown tokens.
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; email: string; iat?: number }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true, department: true },
    });
    if (!user || !user.isActive || (user as any).isSystemAccount) throw new UnauthorizedException();
    // Archive, rehire, permanent delete and admin password reset revoke every
    // token issued before them (compared in whole seconds, as iat is).
    const revokedAt = (user as any).sessionsRevokedAt as Date | null;
    if (revokedAt && (typeof payload.iat !== 'number' || payload.iat < Math.floor(revokedAt.getTime() / 1000))) {
      throw new UnauthorizedException();
    }
    const { password, ...result } = user;
    return result;
  }
}
