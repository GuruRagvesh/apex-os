import { BadRequestException, Body, Controller, Get, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { SettingsService } from './settings.service';
import { ROLES } from '../../../shared/constants/roles';
import { EmailService } from '../email/email.service';



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
    return { host: '', port: '587', email: '', password: '' };
  }

  @Patch('smtp')
  @UseGuards(RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  async updateSmtp() {
    throw new BadRequestException('SMTP configuration is deprecated. Only Resend is supported.');
  }

  @Post('email/test')
  @UseGuards(RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  async testEmail(@Body() body: any) {
    return this.emailService.sendTestEmail(body?.to);
  }
}
