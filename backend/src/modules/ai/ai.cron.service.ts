import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';

const SLA_HOURS: Record<string, number> = { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 };

function isOverdue(createdAt: Date, priority: string, status: string): boolean {
  if (['DONE', 'CLOSED'].includes(status)) return false;
  const elapsed = (Date.now() - createdAt.getTime()) / 3600000;
  return elapsed > (SLA_HOURS[priority] ?? 24);
}

@Injectable()
export class AiCronService {
  private readonly logger = new Logger('AiCronService');

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private configService: ConfigService,
  ) {}

  // Run every day at 18:00 (6 PM) server time
  @Cron('0 18 * * *', { name: 'daily-digest' })
  async sendDailyDigest() {
    this.logger.log('Running daily digest cron job…');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ── Gather data ─────────────────────────────────────────────────────────
    const [resolvedToday, allOpen, newToday, pendingLeave, managers] = await Promise.all([
      this.prisma.ticket.findMany({
        where: {
          status: { in: ['DONE', 'CLOSED'] },
          resolvedAt: { gte: today },
        },
        include: {
          assignedTo: { select: { name: true } },
          department: { select: { name: true } },
        },
        orderBy: { resolvedAt: 'desc' },
      }),

      this.prisma.ticket.findMany({
        where: { status: { in: ['OPEN', 'IN_PROGRESS', 'REVIEW'] } },
        include: { department: { select: { name: true } } },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      }),

      this.prisma.ticket.findMany({
        where: { createdAt: { gte: today } },
        include: {
          createdBy: { select: { name: true } },
          department: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),

      this.prisma.leaveRequest.findMany({
        where: { status: 'PENDING' },
        include: { user: { select: { name: true, department: { select: { name: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),

      this.prisma.user.findMany({
        where: { role: { name: { in: ['Admin', 'Manager'] } }, isActive: true },
        select: { id: true, name: true, email: true },
      }),
    ]);

    if (managers.length === 0) {
      this.logger.warn('No Admin/Manager users found — skipping digest');
      return;
    }

    const overdueTickets = allOpen.filter((t) => isOverdue(t.createdAt, t.priority, t.status));

    // ── Build email HTML ─────────────────────────────────────────────────────
    const dateStr = new Date().toLocaleDateString('en-GB', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const html = this.buildDigestHtml(dateStr, resolvedToday, overdueTickets, newToday, pendingLeave);
    const subject = `NEXUS Daily Digest — ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;

    // ── Send to each manager / admin ─────────────────────────────────────────
    let sent = 0;
    for (const manager of managers) {
      await this.emailService.sendEmail(manager.email, subject, html);
      sent++;
    }

    this.logger.log(
      `Daily digest sent to ${sent} manager(s). ` +
      `Resolved: ${resolvedToday.length}, Overdue: ${overdueTickets.length}, New: ${newToday.length}, Pending leave: ${pendingLeave.length}`,
    );
  }

  // ── Manually trigger (for testing) ──────────────────────────────────────────
  async triggerDigestNow() {
    await this.sendDailyDigest();
    return { message: 'Daily digest triggered' };
  }

  // ── HTML builder ─────────────────────────────────────────────────────────────
  private buildDigestHtml(
    dateStr: string,
    resolved: any[],
    overdue: any[],
    newTickets: any[],
    pendingLeave: any[],
  ): string {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');

    const stat = (value: number, label: string, color: string) =>
      `<td style="text-align:center;padding:12px 20px">
         <div style="font-size:28px;font-weight:700;color:${color}">${value}</div>
         <div style="font-size:12px;color:#64748b;margin-top:2px">${label}</div>
       </td>`;

    const ticketRow = (t: any) =>
      `<tr style="border-bottom:1px solid #f1f5f9">
         <td style="padding:8px 0;font-size:13px;color:#475569;font-family:monospace">${t.ticketId}</td>
         <td style="padding:8px 12px;font-size:13px;color:#0f172a">${t.title}</td>
         <td style="padding:8px 0;font-size:12px;color:#64748b">${t.department?.name ?? '—'}</td>
       </tr>`;

    const section = (title: string, color: string, icon: string, rows: string, emptyMsg: string) =>
      `<div style="margin-bottom:28px">
         <h3 style="margin:0 0 12px;font-size:15px;color:#0f172a;display:flex;align-items:center;gap:6px">
           <span style="color:${color}">${icon}</span> ${title}
         </h3>
         ${rows
           ? `<table width="100%" cellpadding="0" cellspacing="0"
                style="border-collapse:collapse;font-size:13px">${rows}</table>`
           : `<p style="margin:0;font-size:13px;color:#94a3b8;font-style:italic">${emptyMsg}</p>`}
       </div>`;

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0"
  style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#1e40af 0%,#4f46e5 100%);padding:24px 32px">
    <table cellpadding="0" cellspacing="0" width="100%"><tr>
      <td>
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="width:36px;height:36px;background:rgba(255,255,255,.2);border-radius:8px;text-align:center;line-height:36px;font-weight:bold;color:#fff;font-size:18px">N</td>
          <td style="padding-left:10px;color:#fff;font-size:17px;font-weight:700">Nexus</td>
          <td style="padding-left:6px;color:#c7d2fe;font-size:11px;letter-spacing:.05em;text-transform:uppercase">TechnoEdge</td>
        </tr></table>
      </td>
      <td style="text-align:right;color:#c7d2fe;font-size:12px">Daily Digest</td>
    </tr></table>
    <h1 style="margin:16px 0 4px;color:#fff;font-size:22px;font-weight:700">Operations Summary</h1>
    <p style="margin:0;color:#c7d2fe;font-size:13px">${dateStr}</p>
  </td></tr>

  <!-- Stats bar -->
  <tr><td style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      ${stat(resolved.length,   'Resolved Today',  '#16a34a')}
      ${stat(overdue.length,    'Overdue',          overdue.length > 0 ? '#dc2626' : '#94a3b8')}
      ${stat(newTickets.length, 'New Today',        '#2563eb')}
      ${stat(pendingLeave.length, 'Pending Leave',  pendingLeave.length > 2 ? '#d97706' : '#94a3b8')}
    </tr></table>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:32px">

    ${section(
      'Resolved Today',
      '#16a34a', '✅',
      resolved.map(ticketRow).join(''),
      'No tickets were resolved today.',
    )}

    ${overdue.length > 0 ? section(
      `Overdue Tickets (${overdue.length})`,
      '#dc2626', '⚠️',
      overdue.map((t) =>
        `<tr style="border-bottom:1px solid #fef2f2;background:#fff5f5">
           <td style="padding:8px 0;font-size:13px;color:#dc2626;font-family:monospace;font-weight:600">${t.ticketId}</td>
           <td style="padding:8px 12px;font-size:13px;color:#0f172a">${t.title}</td>
           <td style="padding:8px 0;font-size:12px">
             <span style="background:#fecaca;color:#991b1b;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600">${t.priority}</span>
           </td>
         </tr>`
      ).join(''),
      '',
    ) : ''}

    ${section(
      'New Tickets Today',
      '#2563eb', '🆕',
      newTickets.map((t) =>
        `<tr style="border-bottom:1px solid #f1f5f9">
           <td style="padding:8px 0;font-size:13px;color:#475569;font-family:monospace">${t.ticketId}</td>
           <td style="padding:8px 12px;font-size:13px;color:#0f172a">${t.title}</td>
           <td style="padding:8px 0;font-size:12px;color:#64748b">${t.createdBy?.name ?? '—'}</td>
         </tr>`
      ).join(''),
      'No new tickets were opened today.',
    )}

    ${pendingLeave.length > 0 ? section(
      `Pending Leave Requests (${pendingLeave.length})`,
      '#d97706', '📅',
      pendingLeave.map((l) =>
        `<tr style="border-bottom:1px solid #f1f5f9">
           <td style="padding:8px 0;font-size:13px;color:#0f172a;font-weight:500">${l.user?.name}</td>
           <td style="padding:8px 12px;font-size:13px;color:#64748b">${l.type}</td>
           <td style="padding:8px 0;font-size:12px;color:#64748b">
             ${new Date(l.startDate).toLocaleDateString('en-GB')} → ${new Date(l.endDate).toLocaleDateString('en-GB')}
           </td>
         </tr>`
      ).join(''),
      '',
    ) : ''}

    <!-- CTA -->
    <div style="text-align:center;margin-top:32px;padding-top:24px;border-top:1px solid #e2e8f0">
      <a href="${frontendUrl}/dashboard"
         style="background:linear-gradient(135deg,#1e40af,#4f46e5);color:#fff;padding:12px 32px;
                border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;
                display:inline-block">
        Open Dashboard →
      </a>
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f1f5f9;padding:16px 32px;text-align:center">
    <p style="margin:0;font-size:12px;color:#94a3b8">
      © ${new Date().getFullYear()} TechnoEdge Learning Services · Nexus Platform<br>
      This is an automated daily digest sent to managers and admins.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
  }
}
