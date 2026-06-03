import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { Resend } from 'resend';

/**
 * EmailService — provider-agnostic email delivery.
 *
 * Provider priority (resolved per-send):
 *   1. Resend  — if RESEND_API_KEY + RESEND_FROM_EMAIL env vars are set
 *
 * Soft paths (sendEmail / notification helpers): return false if no provider.
 * Strict paths (sendOtpEmail / sendTestEmail): throw BadRequestException.
 *
 * ConfigService is @Optional() so existing unit tests that instantiate
 * EmailService directly with `new EmailService(prisma)` remain valid.
 * Resend init falls back to process.env when ConfigService is absent.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');

  // ── Resend state ────────────────────────────────────────────────────────────
  private resendClient: Resend | null = null;
  private resendFrom = '';

  constructor(
    private prisma: PrismaService,
    @Optional() private configService?: ConfigService,
  ) {
    this.initResend();
  }

  // ── Provider initialisation ─────────────────────────────────────────────────

  private initResend(): void {
    // ConfigService available through NestJS DI; falls back to process.env when
    // the service is instantiated directly (e.g. unit tests via `new EmailService(prisma)`).
    const apiKey  = this.configService?.get<string>('RESEND_API_KEY')    ?? process.env['RESEND_API_KEY'];
    const fromAddr = this.configService?.get<string>('RESEND_FROM_EMAIL') ?? process.env['RESEND_FROM_EMAIL'];

    if (apiKey && fromAddr) {
      this.resendClient = new Resend(apiKey);
      this.resendFrom   = fromAddr;
      this.logger.log('Resend email provider initialized');
    }
  }

  // ── OTP email — strict path (throws on any failure) ────────────────────────

  /**
   * Send a password-reset OTP to the given address.
   * Throws BadRequestException if the provider fails or is not configured.
   * Callers must NOT call this for unknown users (no side-channel via error timing).
   */
  async sendOtpEmail(to: string, otp: string): Promise<void> {
    const html = this.buildHtml(
      'Your Apex OS password reset code',
      `<p>Hi,</p>
       <p>You requested a password reset for your Apex OS account.</p>
       <div style="text-align:center;margin:24px 0">
         <div style="display:inline-block;background:#f1f5f9;border:2px dashed #cbd5e1;
                     border-radius:12px;padding:16px 32px">
           <p style="margin:0 0 4px;font-size:12px;color:#64748b;
                     text-transform:uppercase;letter-spacing:.05em">One-time code</p>
           <p style="margin:0;font-size:32px;font-weight:700;color:#0f172a;
                     letter-spacing:.2em;font-family:monospace">${otp}</p>
           <p style="margin:8px 0 0;font-size:11px;color:#94a3b8">
             Expires in 10 minutes</p>
         </div>
       </div>
       <p style="color:#64748b;font-size:13px">
         If you did not request this, you can safely ignore this email.</p>`,
    );

    if (!this.resendClient) {
      this.logger.error(`Resend is not configured. Failed to send OTP email to ${to}`);
      throw new BadRequestException('Failed to send reset code. Please try again later.');
    }

    const { error } = await this.resendClient.emails.send({
      from:    this.resendFrom,
      to:      [to],
      subject: 'Apex OS — Password reset code',
      html,
    });
    
    if (error) {
      this.logger.error(`Resend OTP send failed: ${error.message}`);
      throw new BadRequestException('Failed to send reset code. Please try again later.');
    }
    
    this.logger.log(`OTP email sent via Resend -> ${to}`);
  }

  // ── General email — soft path (returns boolean, never throws) ───────────────

  async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.resendClient) {
      this.logger.debug(`[Email skipped — no provider] ${subject} -> ${to}`);
      return false;
    }

    try {
      const { error } = await this.resendClient.emails.send({
        from:    this.resendFrom,
        to:      [to],
        subject,
        html,
      });
      if (error) {
        this.logger.error(`Resend send failed: ${error.message}`);
        return false;
      }
      this.logger.log(`Email sent via Resend: ${subject} -> ${to}`);
      return true;
    } catch (err: any) {
      this.logger.error(`Resend unexpected error: ${err.message}`);
      return false;
    }
  }

  // ── Test email — strict path ─────────────────────────────────────────────────

  async sendTestEmail(to?: string) {
    if (!this.resendClient) {
      throw new BadRequestException('Email provider is not configured.');
    }

    const recipient = String(to || this.resendFrom.match(/<(.+)>/)?.[1] || '').trim();
    if (!recipient) throw new BadRequestException('Test recipient is required.');
    
    const { error } = await this.resendClient.emails.send({
      from:    this.resendFrom,
      to:      [recipient],
      subject: 'Apex OS Resend test',
      html:    this.buildHtml('Resend test successful',
        '<p>This test email confirms Apex OS can send notifications via Resend.</p>'),
    });
    
    if (error) {
      this.logger.error(`Resend test failed: ${error.message}`);
      throw new BadRequestException('Resend test failed. Check API key and from-address domain verification.');
    }
    
    this.logger.log(`Resend test email sent -> ${recipient}`);
    return { ok: true, message: `Test email sent to ${recipient} via Resend` };
  }

  // ── HTML template builder ────────────────────────────────────────────────────

  private buildHtml(title: string, bodyHtml: string, btnText?: string, btnUrl?: string) {
    const btn = btnText && btnUrl
      ? `<div style="text-align:center;margin:32px 0">
           <a href="${btnUrl}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;
              text-decoration:none;font-weight:600;font-size:14px;display:inline-block">${btnText}</a>
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

  // ── Notification helpers (unchanged callers — soft path) ─────────────────────

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
    const color    = approved ? '#16a34a' : '#dc2626';
    const word     = approved ? 'approved' : 'rejected';
    const html     = this.buildHtml(
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
