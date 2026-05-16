import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');
  private transporter: nodemailer.Transporter | null = null;
  private from = '';

  constructor(private configService: ConfigService) {
    const host = configService.get<string>('SMTP_HOST');
    const port = configService.get<number>('SMTP_PORT', 587);
    const user = configService.get<string>('SMTP_USER');
    const pass = configService.get<string>('SMTP_PASS');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({ host, port, secure: false, auth: { user, pass } });
      this.from = `"Apex OS — TechnoEdge" <${user}>`;
      this.logger.log('SMTP configured');
    } else {
      this.logger.warn('SMTP not configured — emails will be skipped');
    }
  }

  async sendEmail(to: string, subject: string, html: string) {
    if (!this.transporter) {
      this.logger.debug(`[Email skipped] ${subject} → ${to}`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
      this.logger.log(`Email sent: ${subject} → ${to}`);
    } catch (err: any) {
      this.logger.error(`Email failed: ${err.message}`);
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
      <td style="width:36px;height:36px;background:#2563eb;border-radius:8px;text-align:center;line-height:36px;font-weight:bold;color:#fff;font-size:18px">N</td>
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
    <p style="margin:0;font-size:12px;color:#94a3b8">© 2024 TechnoEdge Learning Services · Automated notification</p>
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
         <strong>${ticketId}</strong> — ${title}
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
         <strong>${ticketId}</strong> — ${title}
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
      `Leave request ${approved ? 'Approved ✓' : 'Rejected'}`,
      `<p>Hi,</p>
       <p>Your <strong>${leaveType}</strong> leave request
          (<strong>${startDate}</strong> → <strong>${endDate}</strong>)
          has been <strong style="color:${color}">${word}</strong>.</p>
       ${!approved ? '<p>Please contact your manager for further details.</p>' : ''}`,
      'View Leave Requests',
      `${frontendUrl}/leave`,
    );
    await this.sendEmail(to, `Leave request ${word}`, html);
  }
}
