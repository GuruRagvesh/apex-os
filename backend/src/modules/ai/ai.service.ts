import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { TicketTimingService } from '../../common/services/ticket-timing.service';
import { TVAService } from '../../common/services/tva.service';
import OpenAI from 'openai';

const MODEL = 'gpt-4o-mini';

@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');
  private client: OpenAI | null = null;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private ticketTiming: TicketTimingService,
    private tva: TVAService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey && apiKey.trim()) {
      this.client = new OpenAI({ apiKey: apiKey.trim() });
      this.logger.log('OpenAI client initialised (model: gpt-4o-mini)');
    } else {
      this.logger.warn('OPENAI_API_KEY not set — AI endpoints will return "coming soon" responses');
    }
  }

  // True when no AI provider key is configured. Methods short-circuit and return a friendly
  // "coming soon" payload so the UI can render a graceful disabled state instead of erroring.
  private isAiDisabled(): boolean {
    return !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY;
  }

  // Checks overdue using DB-configured SLA hours (not hardcoded constants).
  private ticketIsOverdue(ticket: { createdAt: Date; priority: string; status: string }, slaHours: Record<string, number>): boolean {
    if (['DONE', 'CLOSED'].includes(ticket.status)) return false;
    const elapsed = (this.tva.now().getTime() - ticket.createdAt.getTime()) / 3_600_000;
    return elapsed > (slaHours[ticket.priority] ?? 24);
  }

  // ── Core helper ─────────────────────────────────────────────────────────────
  private async chat(system: string, user: string): Promise<string> {
    if (!this.client) throw new Error('OpenAI not configured');

    const completion = await this.client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      max_tokens: 600,
    });
    return completion.choices[0]?.message?.content?.trim() ?? '';
  }

  private parseJson(raw: string): any {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    return JSON.parse(cleaned);
  }

  // ── A) Suggest priority ──────────────────────────────────────────────────────
  async suggestPriority(title: string, description: string): Promise<{ priority: string; reason: string; disabled?: boolean }> {
    if (this.isAiDisabled()) {
      return {
        priority: 'MEDIUM',
        reason: 'AI features coming soon. Priority set to Medium by default.',
        disabled: true,
      };
    }
    const fallback = { priority: 'MEDIUM', reason: 'No AI key configured — defaulting to Medium.' };
    if (!this.client) return fallback;

    try {
      const system = `You are a helpdesk triage assistant for a business management platform.
Given a ticket title and description, respond with ONLY a JSON object — no prose, no markdown fences.
The object must have exactly two keys:
  "priority": one of URGENT | HIGH | MEDIUM | LOW
  "reason": one sentence (≤ 20 words) explaining the chosen priority.

Priority guide:
  URGENT = system outage, security breach, total blocker affecting many users
  HIGH   = major functionality broken, deadline risk, multiple users affected
  MEDIUM = partial degradation, workaround exists, single user affected
  LOW    = cosmetic, nice-to-have, no time pressure`;

      const user = `Title: ${title}\nDescription: ${description?.trim() || '(none provided)'}`;
      const raw = await this.chat(system, user);
      const parsed = this.parseJson(raw);

      const valid = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
      if (!valid.includes(parsed.priority)) parsed.priority = 'MEDIUM';
      return { priority: parsed.priority, reason: String(parsed.reason) };
    } catch (err: any) {
      this.logger.error(`suggestPriority failed: ${err.message}`);
      return fallback;
    }
  }

  // ── B) Summarise open tickets ────────────────────────────────────────────────
  async summarizeTickets(): Promise<{ summary: string; disabled?: boolean }> {
    if (this.isAiDisabled()) {
      return {
        summary: "AI Daily Summary will be available once AI is configured. Check back soon.",
        disabled: true,
      };
    }
    const tickets = await this.prisma.ticket.findMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS', 'REVIEW'] } },
      include: {
        department: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 60,
    });

    if (tickets.length === 0) {
      return { summary: '✅ No open or in-progress tickets at this time. Great work, team!' };
    }

    const { execution: slaHours } = await this.ticketTiming.getSlaConfig();

    if (!this.client) {
      const lines = tickets.map(
        (t) => `• [${t.ticketId}] ${t.title} (${t.status}, ${t.priority}${this.ticketIsOverdue(t, slaHours) ? ' — OVERDUE' : ''})`,
      );
      return { summary: `${tickets.length} open tickets:\n\n${lines.join('\n')}` };
    }

    const list = tickets
      .map(
        (t) =>
          `[${t.ticketId}] ${t.title} | ${t.status} | ${t.priority} | ` +
          `Dept: ${t.department?.name ?? 'N/A'} | Assigned: ${t.assignedTo?.name ?? 'Unassigned'}` +
          (this.ticketIsOverdue(t, slaHours) ? ' | ⚠️ OVERDUE' : ''),
      )
      .join('\n');

    const system = `You are a concise daily-standup summariser for a business management platform.
Rules:
• Group tickets by department using bold department names as headers
• Flag OVERDUE tickets with ⚠️ and bold text
• Keep the whole summary under 200 words
• Use bullet points (•) — no numbered lists
• End with a one-line overall health statement`;

    try {
      const summary = await this.chat(system, `Open/in-progress tickets as of now:\n\n${list}`);
      return { summary };
    } catch (err: any) {
      this.logger.error(`summarizeTickets failed: ${err.message}`);
      return { summary: 'Unable to generate summary — OpenAI request failed.' };
    }
  }

  // ── C) Ticket suggestions ────────────────────────────────────────────────────
  async ticketSuggestions(
    id: string,
  ): Promise<{ nextAction?: string; suggestedAssignee?: string; estimatedTime?: string; result?: string; disabled?: boolean }> {
    if (this.isAiDisabled()) {
      return { result: 'AI features coming soon.', disabled: true };
    }
    const ticket = await this.prisma.ticket.findFirst({
      where: { OR: [{ id }, { ticketId: id }] },
      include: {
        comments: {
          include: { author: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
          take: 10,
        },
        department: { select: { name: true } },
        assignedTo: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');

    const fallback = {
      nextAction: 'Review the ticket and assign it to the appropriate team member.',
      suggestedAssignee: 'Assign based on the ticket category and department.',
      estimatedTime: 'Unable to estimate without more context.',
    };

    if (!this.client) return fallback;

    const { execution: slaHours } = await this.ticketTiming.getSlaConfig();
    const commentBlock =
      ticket.comments.length > 0
        ? ticket.comments.map((c) => `  ${c.author.name}: ${c.content}`).join('\n')
        : '  (no comments yet)';

    const context = `Ticket: ${ticket.ticketId}
Title: ${ticket.title}
Description: ${ticket.description ?? '(none)'}
Category: ${ticket.category}
Priority: ${ticket.priority}
Status: ${ticket.status}
Department: ${ticket.department?.name ?? 'N/A'}
Assigned to: ${ticket.assignedTo?.name ?? 'Unassigned'}
Reported by: ${ticket.createdBy?.name}
Overdue: ${this.ticketIsOverdue(ticket, slaHours) ? 'Yes' : 'No'}

Discussion (newest to oldest):
${commentBlock}`;

    const system = `You are an expert helpdesk operations advisor.
Given a support ticket and its discussion, respond with ONLY a JSON object — no prose, no markdown fences.
The object must have exactly three keys:
  "nextAction": the single most important next step to move toward resolution (1–2 sentences, specific and actionable)
  "suggestedAssignee": the ideal role or team to own this, based on category and symptoms (1 sentence)
  "estimatedTime": realistic wall-clock time to resolve, as a range string like "2–4 hours" or "1–2 days"`;

    try {
      const raw = await this.chat(system, context);
      const parsed = this.parseJson(raw);
      return {
        nextAction: String(parsed.nextAction ?? fallback.nextAction),
        suggestedAssignee: String(parsed.suggestedAssignee ?? fallback.suggestedAssignee),
        estimatedTime: String(parsed.estimatedTime ?? fallback.estimatedTime),
      };
    } catch (err: any) {
      this.logger.error(`ticketSuggestions failed: ${err.message}`);
      return fallback;
    }
  }
}
