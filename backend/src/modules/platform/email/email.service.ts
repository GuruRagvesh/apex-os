import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import * as nodemailer from 'nodemailer';

type SmtpConfig = {
  host: string;
  port: number;
  email: string;
  password: string;
  secure: boolean;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');
  private transporter: nodemailer.Transporter | null = null;
  private from = '';
  private loadedFingerprint = '';
  private activeConfig: SmtpConfig | null = null;

  constructor(private prisma: PrismaService) {}

  private normalizeConfig(raw: any, strict = false): SmtpConfig | null {
    const host = String(raw?.host || '').trim();
    const email = String(raw?.email || '').trim();
    const password = String(raw?.password || '');
    const port = Number(raw?.port || 587);
    const hasAny = Boolean(host || email || password || raw?.port);

    if (!hasAny) return null;
    if (!host || !email || !password || !Number.isInteger(port) || port <= 0 || port > 65535) {
      if (strict) throw new BadRequestException('SMTP host, port, from email, and password are required.');
      return null;
    }

    return {
      host,
      port,
      email,
      password,
      secure: raw?.secure === true || port === 465,
    };
  }

  private async ensureTransporter(strict = false) {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: 'smtp' } });
    const raw = (setting?.value as any) ?? {};
    const fingerprint = JSON.stringify(raw);
    if (fingerprint === this.loadedFingerprint) {
      if (strict && !this.transporter) throw new BadRequestException('SMTP is not configured.');
      return Boolean(this.transporter);
    }

    const config = this.normalizeConfig(raw, strict);
    this.loadedFingerprint = fingerprint;
    this.activeConfig = config;

    if (!config) {
      this.transporter = null;
      this.from = '';
      this.logger.warn('SMTP not configured in settings - emails will be skipped');
      if (strict) throw new BadRequestException('SMTP is not configured.');
      return false;
    }

    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.email, pass: config.password },
    });
    this.from = `"Apex OS - TechnoEdge" <${config.email}>`;
    this.logger.log('SMTP transporter loaded from settings');
    return true;
  }

  async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    if (!(await this.ensureTransporter(false)) || !this.transporter) {
      this.logger.debug(`[Email skipped] ${subject} -> ${to}`);
      return false;
    }

    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
      this.logger.log(`Email sent: ${subject} -> ${to}`);
      return true;
    } catch (err: any) {
      this.logger.error(`Email failed: ${err.message}`);
      return false;
    }
  }

  async sendTestEmail(to?: string) {
    await this.ensureTransporter(true);
    if (!this.transporter || !this.activeConfig) throw new BadRequestException('SMTP is not configured.');
    const recipient = String(to || this.activeConfig.email || '').trim();
    if (!recipient) throw new BadRequestException('Test recipient is required.');

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: recipient,
        subject: 'Apex OS SMTP test',
        html: this.buildHtml(
          'SMTP test successful',
          '<p>This test email confirms Apex OS can send notifications using the saved SMTP settings.</p>',
        ),
      });
      this.logger.log(`SMTP test email sent -> ${recipient}`);
      return { ok: true, message: `Test email sent to ${recipient}` };
    } catch (err: any) {
      this.logger.error(`SMTP test failed: ${err.message}`);
      throw new BadRequestException('SMTP test failed. Check host, port, credentials, and provider access.');
    }
  }

  private buildHtml(title: string, bodyHtml: string, btnText?: string, btnUrl?: string) {
    const btn = btnText && btnUrl
      ? `<div style="text-align:center;margin:32px 0">
           <a href="${btnUrl}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">${btnText}</a>
         </div>`
      : '';
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  <tr><td style="background:#1e3a5f;padding:20px 32px">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="width:36px;height:36px;background:#2563eb;border-radius:8px;text-align:center;line-height:36px;font-weight:bold;color:#fff;font-size:18px">A</td>
      <td style="padding-left:12px;color:#fff;font-size:17px;font-weight:700">Apex OS</td>
      <td style="padding-left:8px;color:#93c5fd;font-size:12px">TechnoEdge</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px">
    <h2 style="margin:0 0 16px;font-size:20px;color:#0f172a">${title}</h2>
    <div style="font-size:14px;color:#475569;line-height:1.7">${bodyHtml}</div>
    ${btn}
  </td></tr>
  <tr><td style="background:#f1f5f9;padding:14px 32px;text-align:center">
    <p style="margin:0;font-size:12px;color:#94a3b8">Copyright 2024 TechnoEdge Learning Services. Automated notification.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  }

  async sendTicketAssigned(to: string, ticketId: string, title: string, assignedByName: string, frontendUrl: string) {
    const html = this.buildHtml(
      'Ticket assigned to you',
      `<p>Hi,</p>
       <p><strong>${assignedByName}</strong> has assigned you a ticket:</p>
       <p style="background:#f8fafc;border-left:4px solid #2563eb;padding:12px 16px;border-radius:4px;margin:16px 0">
         <strong>${ticketId}</strong> - ${title}
       </p>
       <p>Log in to Apex OS to view the details and get started.</p>`,
      `View ${ticketId}`,
      `${frontendUrl}/tickets`,
    );
    await this.sendEmail(to, `Assigned to you: ${ticketId}`, html);
  }

  async sendTicketResolved(to: string, ticketId: string, title: string, frontendUrl: string) {
    const html = this.buildHtml(
      `Ticket ${ticketId} resolved`,
      `<p>Hi,</p>
       <p>A ticket assigned to you has been marked as <strong style="color:#16a34a">resolved</strong>:</p>
       <p style="background:#f8fafc;border-left:4px solid #16a34a;padding:12px 16px;border-radius:4px;margin:16px 0">
         <strong>${ticketId}</strong> - ${title}
       </p>`,
      'View Ticket',
      `${frontendUrl}/tickets`,
    );
    await this.sendEmail(to, `Resolved: ${ticketId}`, html);
  }

  async sendLeaveDecision(
    to: string,
    status: 'APPROVED' | 'REJECTED',
    leaveType: string,
    startDate: string,
    endDate: string,
    frontendUrl: string,
  ) {
    const approved = status === 'APPROVED';
    const color = approved ? '#16a34a' : '#dc2626';
    const word = approved ? 'approved' : 'rejected';
    const html = this.buildHtml(
      `Leave request ${approved ? 'Approved' : 'Rejected'}`,
      `<p>Hi,</p>
       <p>Your <strong>${leaveType}</strong> leave request
          (<strong>${startDate}</strong> to <strong>${endDate}</strong>)
          has been <strong style="color:${color}">${word}</strong>.</p>
       ${!approved ? '<p>Please contact your manager for further details.</p>' : ''}`,
      'View Leave Requests',
      `${frontendUrl}/leave`,
    );
    await this.sendEmail(to, `Leave request ${word}`, html);
  }
}
