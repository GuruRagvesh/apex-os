import { BadRequestException, Body, Controller, Get, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { SettingsService } from './settings.service';
import { ROLES } from '../../../shared/constants/roles';
import { EmailService } from '../email/email.service';

const SMTP_PASSWORD_MASK = '********';
const LEGACY_SMTP_PASSWORD_MASKS = ['********', '••••••••', 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢'];

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly emailService: EmailService,
  ) {}

  @Get('company')
  getCompany() {
    return this.settings.getCompanyWithTheme();
  }

  @Patch('company')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  async updateCompany(@Body() body: any, @Request() req: any) {
    const { defaultTheme, defaultAccent, ...rest } = body;
    if (defaultTheme || defaultAccent) {
      await this.settings.upsertThemeDefaults(defaultTheme, defaultAccent);
    }
    return this.settings.set('company', rest, req.user?.sub);
  }

  @Get('leave-policy')
  getLeavePolicy() {
    return this.settings.get('leave_policy');
  }

  @Patch('leave-policy')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  updateLeavePolicy(@Body() body: any, @Request() req: any) {
    return this.settings.set('leave_policy', body, req.user?.sub);
  }

  @Get('sla')
  async getSla() {
    const [executionSla, reviewSla] = await Promise.all([
      this.settings.getSlaHours(),
      this.settings.getReviewSlaHours(),
    ]);
    return { ...executionSla, reviewSla };
  }

  @Patch('sla')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  async updateSla(@Body() body: any, @Request() req: any) {
    const { reviewSla, ...executionSla } = body;
    const ops: Promise<any>[] = [this.settings.set('sla', executionSla, req.user?.sub)];
    if (reviewSla) ops.push(this.settings.set('review_sla', reviewSla, req.user?.sub));
    await Promise.all(ops);
    return this.getSla();
  }

  @Get('smtp')
  @UseGuards(RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  async getSmtp() {
    const data = await this.settings.get('smtp');
    return { ...data, password: data?.password ? SMTP_PASSWORD_MASK : '' };
  }

  @Patch('smtp')
  @UseGuards(RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  async updateSmtp(@Body() body: any, @Request() req: any) {
    let value = { ...body };
    if (LEGACY_SMTP_PASSWORD_MASKS.includes(value.password)) {
      const existing = await this.settings.get('smtp');
      value.password = existing?.password ?? '';
    }

    value = {
      host: String(value.host || '').trim(),
      port: String(value.port || '587').trim(),
      email: String(value.email || '').trim(),
      password: String(value.password || ''),
    };

    const port = Number(value.port);
    const hasAny = Boolean(value.host || value.email || value.password || value.port !== '587');
    if (hasAny && (!value.host || !value.email || !value.password || !Number.isInteger(port) || port <= 0 || port > 65535)) {
      throw new BadRequestException('SMTP host, port, from email, and password are required.');
    }

    await this.settings.set('smtp', value, req.user?.sub);
    return { ...value, password: value.password ? SMTP_PASSWORD_MASK : '' };
  }

  @Post('email/test')
  @UseGuards(RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  async testEmail(@Body() body: any) {
    return this.emailService.sendTestEmail(body?.to);
  }
}
