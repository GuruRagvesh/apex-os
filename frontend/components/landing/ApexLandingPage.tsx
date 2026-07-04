import Link from 'next/link';
import {
  type LucideIcon,
  Ticket, FolderKanban, Handshake, Clock, ClipboardCheck, BarChart3, Sparkles,
  Users, UsersRound, UserCircle, TrendingUp, MessageSquare, UserPlus, Wrench,
  Eye, CheckCircle2, ShieldCheck, History, Lock, ArrowRight, Building2,
  Briefcase, Radar, LayoutGrid, FileCheck2, Gauge,
} from 'lucide-react';

// Shared Apex OS public landing page — rendered by both / (the main public
// homepage) and /home-v2 (kept as a review/alias route). Server component:
// no client state is needed, every CTA is a plain link or same-page anchor.

const NAV_LINKS = [
  { label: 'Platform', href: '#platform' },
  { label: 'Workspaces', href: '#workspaces' },
  { label: 'Features', href: '#features' },
  { label: 'AI', href: '#ai' },
  { label: 'Security', href: '#trust' },
];

const PROBLEMS = [
  'Work scattered across WhatsApp, calls, spreadsheets, and email',
  'No clear ownership on who is actually responsible for what',
  'Approvals delayed because there is no single place to request them',
  'Managers and leads depend on manual follow-up to know status',
  'HR and day-to-day operations run in disconnected tools',
  'Sales handoffs get lost the moment a deal is won',
  'Leadership has no real-time view into execution health',
  'Every department invents its own ad-hoc tracking process',
];

const SOLUTIONS = [
  'Every request — task, query, or help — becomes a trackable unit of work',
  'Every item has an owner, a live status, and an SLA clock',
  'Every approval has one clearly accountable decision-maker',
  'Every workday is visible — sessions, breaks, and idle time',
  'Every department runs on the same operating system, not its own tool',
];

interface Pillar { icon: LucideIcon; title: string; desc: string; }
const PILLARS: Pillar[] = [
  { icon: Ticket, title: 'Execution Management', desc: 'Tickets, tasks, queries, and help requests, with SLA timers, review cycles, and rework tracking built in.' },
  { icon: Users, title: 'People & HR Operations', desc: 'Company-wide employee visibility, leave management, and HR approvals inside the dedicated HRMS workspace.' },
  { icon: FolderKanban, title: 'Projects & Delivery', desc: 'Auto-numbered projects with stages and member tracking, connected to the same tickets your teams already work in.' },
  { icon: Handshake, title: 'Sales & Client Operations', desc: 'A dedicated Sales CRM workspace, designed for leads, deals, and client handoffs. Early-stage — see Workspaces below.' },
  { icon: Clock, title: 'Workday & Attendance', desc: 'Login/logout sessions, breaks, and idle detection, visible to the people who need to see them.' },
  { icon: ClipboardCheck, title: 'Approvals & Reviews', desc: 'Multi-stage approval chains for tasks, leave, and employee changes, each with a full review and rework cycle.' },
  { icon: BarChart3, title: 'Analytics & Leadership Visibility', desc: 'Role-based dashboards — from one person’s workload up to company-wide execution health.' },
  { icon: Sparkles, title: 'AI Assistance', desc: 'AI-assisted priority suggestions, ticket summaries, and daily digests today, with more planned across the platform.' },
];

interface WorkspaceCard {
  badge: string; badgeColor: string; icon: LucideIcon; title: string; desc: string;
  items: { label: string; live: boolean }[];
  accent: string;
}
const WORKSPACES: WorkspaceCard[] = [
  {
    badge: 'Core', badgeColor: '#60a5fa', icon: LayoutGrid, accent: '#2563eb',
    title: 'Apex OS Core',
    desc: 'The daily execution room every employee works in.',
    items: [
      { label: 'Tickets, tasks, queries & help', live: true },
      { label: 'Projects & delivery tracking', live: true },
      { label: 'Approvals & workday', live: true },
      { label: 'Role-based analytics', live: true },
    ],
  },
  {
    badge: 'HRMS', badgeColor: '#34d399', icon: Users, accent: '#0f766e',
    title: 'HRMS Workspace',
    desc: 'A separate HR room inside Apex OS, not a bolted-on module.',
    items: [
      { label: 'Employee directory', live: true },
      { label: 'Leave management (company-wide)', live: true },
      { label: 'HR approvals', live: true },
      { label: 'Onboarding, offboarding & performance', live: false },
    ],
  },
  {
    badge: 'Sales CRM', badgeColor: '#a78bfa', icon: Handshake, accent: '#7c3aed',
    title: 'Sales CRM Workspace',
    desc: 'The sales room inside Apex OS — designed for, not fully built yet.',
    items: [
      { label: 'Leads, clients & contacts', live: false },
      { label: 'Deals & pipeline', live: false },
      { label: 'Follow-ups', live: false },
      { label: 'Won deal → project handoff', live: false },
    ],
  },
];

interface RoleCard { icon: LucideIcon; role: string; points: string[]; }
const ROLES: RoleCard[] = [
  { icon: TrendingUp, role: 'Leadership', points: ['Company-wide execution visibility', 'Where work is stalling', 'Performance signals across teams'] },
  { icon: Building2, role: 'Managers', points: ['Team workload at a glance', 'Approvals waiting on you', 'Project and SLA status'] },
  { icon: UsersRound, role: 'Team Leads', points: ['Assignment across your team', 'Review and rework cycles', 'Day-to-day execution tracking'] },
  { icon: UserCircle, role: 'Employees', points: ['Your tasks, queries & help', 'Leave and workday in one place', 'Clear accountability on your work'] },
  { icon: Users, role: 'HR', points: ['Company-wide leave management', 'Employee directory', 'HR approval queue'] },
  { icon: Briefcase, role: 'Sales', points: ['Client work today via tickets', 'A dedicated CRM workspace, growing over time'] },
];

const AI_CAPABILITIES = [
  { icon: Gauge, title: 'Priority suggestions', desc: 'AI-assisted priority hints when a ticket is created.' },
  { icon: FileCheck2, title: 'Ticket summaries', desc: 'Automatic summaries so context is never lost between handoffs.' },
  { icon: MessageSquare, title: 'Per-ticket suggestions', desc: 'Contextual suggestions surfaced on individual tickets.' },
  { icon: History, title: 'Daily digest', desc: 'A daily email digest of what changed and what needs attention.' },
];

const FLOW_STEPS = [
  { icon: MessageSquare, label: 'Request' },
  { icon: Ticket, label: 'Ticket / Task' },
  { icon: UserPlus, label: 'Assignment' },
  { icon: Wrench, label: 'Work' },
  { icon: Eye, label: 'Review' },
  { icon: CheckCircle2, label: 'Approval' },
  { icon: BarChart3, label: 'Analytics' },
];

const TRUST_POINTS = [
  { icon: Lock, text: 'Role-based access control on every module' },
  { icon: History, text: 'Activity trail across tickets, approvals, and workday events' },
  { icon: ClipboardCheck, text: 'Multi-stage approval workflows with a named decision-maker' },
  { icon: Building2, text: 'Department and team structure built into every access rule' },
  { icon: ShieldCheck, text: 'Environment-aware safeguards on destructive operations' },
  { icon: Radar, text: 'Company data visibility scoped by role, not all-or-nothing' },
];

const PREVIEWS = [
  { icon: Ticket, title: 'Tickets', accent: '#3b82f6' },
  { icon: Users, title: 'HRMS', accent: '#34d399' },
  { icon: Handshake, title: 'Sales CRM', accent: '#a78bfa' },
  { icon: BarChart3, title: 'Analytics', accent: '#f59e0b' },
  { icon: Clock, title: 'Workday', accent: '#06b6d4' },
];

export function ApexLandingPage({ showPreviewBanner = false }: { showPreviewBanner?: boolean }) {
  return (
    <div style={{ backgroundColor: '#05070c', color: '#e2e8f0' }} className="min-h-screen">
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{`html { scroll-behavior: smooth; }`}</style>

      {/* ── PREVIEW BANNER — /home-v2 alias only ─────────────────────────────── */}
      {showPreviewBanner && (
        <div className="px-4 py-2 text-center text-xs font-mono" style={{ backgroundColor: 'rgba(139,92,246,0.12)', color: '#c4b5fd', borderBottom: '1px solid rgba(139,92,246,0.2)' }}>
          You&rsquo;re viewing the /home-v2 preview alias — the main experience is now live at{' '}
          <Link href="/" className="underline">the homepage</Link>.
        </div>
      )}

      {/* ── TOP NAV ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40" style={{ backgroundColor: 'rgba(5,7,12,0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(30,41,59,0.6)' }}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <Link href="#top" className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #1e40af 0%, #4f46e5 100%)' }}>
              <span className="text-white font-bold text-sm">A</span>
            </div>
            <div className="leading-none">
              <p className="font-bold text-sm text-white">APEX OS</p>
              <p className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#64748b' }}>Execution OS</p>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-7">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="text-sm font-medium transition-colors" style={{ color: '#94a3b8' }}>
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3 flex-shrink-0">
            <Link href="/login" className="hidden sm:inline text-sm font-medium transition-colors" style={{ color: '#94a3b8' }}>
              Login
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)', color: '#fff' }}
            >
              Open App
            </Link>
          </div>
        </div>
      </header>

      <main id="top">
        {/* ── HERO ───────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden px-6 pt-20 pb-24">
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(600px circle at 50% 0%, rgba(37,99,235,0.15), transparent 60%)' }} />
          <div className="max-w-4xl mx-auto text-center relative">
            <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-8 text-xs font-mono uppercase tracking-widest" style={{ background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.25)', color: '#93c5fd' }}>
              <Sparkles size={12} />
              AI-Powered Enterprise Execution OS
            </div>
            <h1 className="text-4xl md:text-6xl font-black leading-tight mb-6" style={{ letterSpacing: '-0.02em', color: '#fff' }}>
              Run your company from<br />one AI-powered execution OS.
            </h1>
            <p className="text-lg max-w-2xl mx-auto mb-10" style={{ color: '#94a3b8' }}>
              Apex OS brings tickets, projects, HR operations, sales workflows, approvals, workday tracking,
              analytics, and AI visibility into one execution layer — so every request becomes trackable work
              with a clear owner.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl transition-transform hover:scale-[1.02]"
                style={{ background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', boxShadow: '0 8px 24px rgba(37,99,235,0.35)' }}
              >
                Open Apex OS <ArrowRight size={15} />
              </Link>
              <a
                href="#platform"
                className="inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl transition-colors"
                style={{ border: '1px solid rgba(148,163,184,0.25)', color: '#e2e8f0' }}
              >
                Explore Platform
              </a>
              <a href="#workspaces" className="text-sm font-medium transition-colors" style={{ color: '#64748b' }}>
                View Workspaces →
              </a>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {['Tickets', 'Queries', 'Help Requests', 'Approvals', 'Leave', 'Workday', 'Reviews'].map((chip) => (
                <span key={chip} className="text-xs font-mono px-3 py-1.5 rounded-full" style={{ backgroundColor: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.15)', color: '#94a3b8' }}>
                  {chip}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── PROBLEM ────────────────────────────────────────────────────────── */}
        <section className="px-6 py-20" style={{ backgroundColor: '#070a12' }}>
          <div className="max-w-6xl mx-auto">
            <SectionHeading eyebrow="The problem" title="Work is happening everywhere — except in one place." />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-10">
              {PROBLEMS.map((p) => (
                <div key={p} className="flex items-start gap-3 p-4 rounded-xl" style={{ backgroundColor: '#0F172A', border: '1px solid #1E293B' }}>
                  <span className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ backgroundColor: '#f87171' }} />
                  <p className="text-sm" style={{ color: '#94a3b8' }}>{p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SOLUTION ───────────────────────────────────────────────────────── */}
        <section className="px-6 py-20">
          <div className="max-w-6xl mx-auto">
            <SectionHeading eyebrow="The Apex OS approach" title="One execution layer for the entire company." />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-10">
              {SOLUTIONS.map((s) => (
                <div key={s} className="flex items-start gap-3 p-4 rounded-xl" style={{ backgroundColor: '#0F172A', border: '1px solid #1E293B' }}>
                  <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" style={{ color: '#34d399' }} />
                  <p className="text-sm" style={{ color: '#cbd5e1' }}>{s}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PLATFORM PILLARS ───────────────────────────────────────────────── */}
        <section id="platform" className="px-6 py-20 scroll-mt-16" style={{ backgroundColor: '#070a12' }}>
          <div className="max-w-6xl mx-auto">
            <SectionHeading eyebrow="Platform" title="Everything execution runs through." />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
              {PILLARS.map((p) => (
                <div key={p.title} className="p-5 rounded-2xl" style={{ backgroundColor: '#0F172A', border: '1px solid #1E293B' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(59,130,246,0.12)' }}>
                    <p.icon size={18} style={{ color: '#60a5fa' }} />
                  </div>
                  <h3 className="text-sm font-bold mb-1.5" style={{ color: '#f1f5f9' }}>{p.title}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: '#8892a4' }}>{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── WORKSPACES ─────────────────────────────────────────────────────── */}
        <section id="workspaces" className="px-6 py-20 scroll-mt-16">
          <div className="max-w-6xl mx-auto">
            <SectionHeading
              eyebrow="Workspaces"
              title="Separate rooms, one operating system."
              sub="Apex OS Core is the daily execution room everyone works in. HRMS and Sales CRM are dedicated rooms inside the same product — built to connect back into Apex OS tickets, approvals, and notifications, not disconnected tools."
            />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-10">
              {WORKSPACES.map((w) => (
                <div key={w.title} className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#0F172A', border: '1px solid #1E293B' }}>
                  <div className="p-5" style={{ borderBottom: '1px solid #1E293B' }}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${w.accent}22` }}>
                        <w.icon size={18} style={{ color: w.badgeColor }} />
                      </div>
                      <span className="text-[9px] font-mono uppercase tracking-widest px-2 py-1 rounded-full" style={{ backgroundColor: `${w.accent}22`, color: w.badgeColor }}>
                        {w.badge}
                      </span>
                    </div>
                    <h3 className="text-base font-bold mb-1" style={{ color: '#f1f5f9' }}>{w.title}</h3>
                    <p className="text-xs" style={{ color: '#8892a4' }}>{w.desc}</p>
                  </div>
                  <div className="p-5 space-y-2.5">
                    {w.items.map((it) => (
                      <div key={it.label} className="flex items-center justify-between gap-2">
                        <span className="text-xs" style={{ color: '#94a3b8' }}>{it.label}</span>
                        <span
                          className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded flex-shrink-0"
                          style={{
                            backgroundColor: it.live ? 'rgba(16,185,129,0.12)' : 'rgba(148,163,184,0.12)',
                            color: it.live ? '#34d399' : '#94a3b8',
                          }}
                        >
                          {it.live ? 'Live' : 'Planned'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── ROLE-BASED VALUE ───────────────────────────────────────────────── */}
        <section className="px-6 py-20" style={{ backgroundColor: '#070a12' }}>
          <div className="max-w-6xl mx-auto">
            <SectionHeading eyebrow="Built for every role" title="One system, tailored to what each role needs." />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-10">
              {ROLES.map((r) => (
                <div key={r.role} className="p-5 rounded-2xl" style={{ backgroundColor: '#0F172A', border: '1px solid #1E293B' }}>
                  <div className="flex items-center gap-2.5 mb-3">
                    <r.icon size={16} style={{ color: '#60a5fa' }} />
                    <h3 className="text-sm font-bold" style={{ color: '#f1f5f9' }}>{r.role}</h3>
                  </div>
                  <ul className="space-y-1.5">
                    {r.points.map((pt) => (
                      <li key={pt} className="text-xs flex items-start gap-2" style={{ color: '#8892a4' }}>
                        <span className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: '#475569' }} />
                        {pt}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── AI ─────────────────────────────────────────────────────────────── */}
        <section id="ai" className="px-6 py-20 scroll-mt-16">
          <div className="max-w-6xl mx-auto">
            <SectionHeading
              eyebrow="AI"
              title="AI-assisted, not a black box."
              sub="Apex OS uses AI where it already helps today. As HRMS and Sales CRM mature, the same AI layer is designed to extend across them — summarizing deal health, follow-ups, and pipeline risk from a future operational command center."
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
              {AI_CAPABILITIES.map((a) => (
                <div key={a.title} className="p-5 rounded-2xl" style={{ backgroundColor: '#0F172A', border: '1px solid #1E293B' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(139,92,246,0.12)' }}>
                    <a.icon size={18} style={{ color: '#a78bfa' }} />
                  </div>
                  <h3 className="text-sm font-bold mb-1.5" style={{ color: '#f1f5f9' }}>{a.title}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: '#8892a4' }}>{a.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── EXECUTION FLOW ─────────────────────────────────────────────────── */}
        <section className="px-6 py-20" style={{ backgroundColor: '#070a12' }}>
          <div className="max-w-6xl mx-auto">
            <SectionHeading eyebrow="How it flows" title="From request to result, without losing the thread." />
            <div className="flex flex-wrap items-center justify-center gap-2 mt-10">
              {FLOW_STEPS.map((s, i) => (
                <div key={s.label} className="flex items-center gap-2">
                  <div className="flex flex-col items-center gap-2 px-4 py-4 rounded-2xl" style={{ backgroundColor: '#0F172A', border: '1px solid #1E293B', minWidth: 108 }}>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.12)' }}>
                      <s.icon size={16} style={{ color: '#60a5fa' }} />
                    </div>
                    <span className="text-xs font-semibold text-center" style={{ color: '#e2e8f0' }}>{s.label}</span>
                  </div>
                  {i < FLOW_STEPS.length - 1 && <ArrowRight size={14} className="flex-shrink-0 hidden sm:block" style={{ color: '#334155' }} />}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── TRUST / CONTROL ────────────────────────────────────────────────── */}
        <section id="trust" className="px-6 py-20 scroll-mt-16">
          <div className="max-w-6xl mx-auto">
            <SectionHeading eyebrow="Trust & control" title="Built with access control from the start." />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-10">
              {TRUST_POINTS.map((t) => (
                <div key={t.text} className="flex items-center gap-3 p-4 rounded-xl" style={{ backgroundColor: '#0F172A', border: '1px solid #1E293B' }}>
                  <t.icon size={16} className="flex-shrink-0" style={{ color: '#60a5fa' }} />
                  <p className="text-sm" style={{ color: '#cbd5e1' }}>{t.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PRODUCT PREVIEW ────────────────────────────────────────────────── */}
        <section id="features" className="px-6 py-20 scroll-mt-16" style={{ backgroundColor: '#070a12' }}>
          <div className="max-w-6xl mx-auto">
            <SectionHeading eyebrow="A look inside" title="Every room, at a glance." sub="Illustrative previews — not live data." />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mt-10">
              {PREVIEWS.map((p) => (
                <div key={p.title} className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#0F172A', border: '1px solid #1E293B' }}>
                  <div className="h-20 flex items-center justify-center" style={{ background: `${p.accent}14` }}>
                    <p.icon size={26} style={{ color: p.accent }} />
                  </div>
                  <div className="p-3 text-center">
                    <p className="text-xs font-semibold" style={{ color: '#e2e8f0' }}>{p.title}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ──────────────────────────────────────────────────────── */}
        <section className="px-6 py-24">
          <div className="max-w-3xl mx-auto text-center rounded-3xl p-12" style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.12) 0%, rgba(124,58,237,0.12) 100%)', border: '1px solid rgba(148,163,184,0.15)' }}>
            <h2 className="text-2xl md:text-3xl font-black mb-4" style={{ color: '#fff' }}>
              Bring your company&rsquo;s execution into one operating system.
            </h2>
            <p className="text-sm mb-8" style={{ color: '#94a3b8' }}>
              Tickets, projects, HR, sales, and analytics — one execution layer, one login.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl transition-transform hover:scale-[1.02]"
                style={{ background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)', color: '#fff' }}
              >
                Open Apex OS <ArrowRight size={15} />
              </Link>
              <Link href="/login" className="text-sm font-semibold px-6 py-3" style={{ color: '#e2e8f0' }}>
                Login
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ── FOOTER ─────────────────────────────────────────────────────────── */}
      <footer className="px-6 py-8 text-center text-sm" style={{ borderTop: '1px solid #1E293B', color: '#64748b' }}>
        <p>© 2026 TechnoEdge Learning Services · Apex OS</p>
        <div className="flex items-center justify-center gap-4 mt-2 text-xs">
          <Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
          <a href="mailto:admin@technoedgels.com" className="hover:text-white transition-colors">Contact</a>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="max-w-2xl">
      <span className="text-xs font-mono uppercase tracking-widest" style={{ color: '#60a5fa' }}>{eyebrow}</span>
      <h2 className="text-2xl md:text-3xl font-black mt-2" style={{ color: '#fff', letterSpacing: '-0.01em' }}>{title}</h2>
      {sub && <p className="text-sm mt-3" style={{ color: '#94a3b8' }}>{sub}</p>}
    </div>
  );
}
