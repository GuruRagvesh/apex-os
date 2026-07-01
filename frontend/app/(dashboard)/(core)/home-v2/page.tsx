'use client';

import { motion } from 'motion/react';
import { useAuthStore } from '@/store/auth.store';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  type LucideIcon,
  Ticket,
  Clock,
  CheckCircle,
  AlertTriangle,
  CalendarDays,
  FolderKanban,
  TrendingUp,
  Users,
  ShieldAlert,
  Timer,
  Target,
  Zap,
  Activity,
  FlaskConical,
  BarChart3,
  Settings,
  ChevronRight,
  Home,
  UserCircle,
  Grid3X3,
  Star,
  RotateCcw,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

// ── Phase 1 static mock data ──────────────────────────────────────────────────

const MOCK_TREND = [
  { date: 'Mon', created: 8,  resolved: 6  },
  { date: 'Tue', created: 5,  resolved: 7  },
  { date: 'Wed', created: 12, resolved: 9  },
  { date: 'Thu', created: 7,  resolved: 11 },
  { date: 'Fri', created: 9,  resolved: 8  },
  { date: 'Sat', created: 3,  resolved: 4  },
  { date: 'Sun', created: 2,  resolved: 3  },
];

interface ScoreCard { label: string; value: string; desc: string; color: string; icon: LucideIcon; }
const MOCK_SCORECARDS: ScoreCard[] = [
  { label: 'Completion Rate', value: '—', desc: 'Closed vs created',       color: '#3b82f6', icon: Target   },
  { label: 'Avg Review Time', value: '—', desc: 'Hours per review cycle',   color: '#8b5cf6', icon: Timer    },
  { label: 'Rework Rate',     value: '—', desc: 'Rejected back to rework',  color: '#f97316', icon: RotateCcw },
  { label: 'SLA Compliance',  value: '—', desc: 'Tickets met SLA deadline', color: '#10b981', icon: Star     },
];

interface WorkforceRow { name: string; role: string; load: number; online: boolean; tasks: number; }
const MOCK_WORKFORCE: WorkforceRow[] = [
  { name: 'Alex K.',   role: 'Team Lead',  load: 78, online: true,  tasks: 5 },
  { name: 'Priya M.',  role: 'Developer',  load: 62, online: true,  tasks: 4 },
  { name: 'James R.',  role: 'Designer',   load: 91, online: true,  tasks: 7 },
  { name: 'Sarah L.',  role: 'Developer',  load: 35, online: false, tasks: 2 },
  { name: 'Ravi T.',   role: 'QA Analyst', load: 55, online: true,  tasks: 3 },
];

interface BentoCard { id: string; title: string; icon: LucideIcon; count: string; label: string; href: string; color: string; bg: string; }
const BENTO_CARDS: BentoCard[] = [
  { id: 'tickets',  title: 'My Tickets',  icon: Ticket,      count: '—', label: 'Open & in-progress', href: '/tickets',             color: '#3b82f6', bg: 'rgba(59,130,246,0.1)'  },
  { id: 'projects', title: 'Projects',    icon: FolderKanban, count: '—', label: 'Active',             href: '/projects',            color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)'  },
  { id: 'team',     title: 'Team',        icon: Users,        count: '—', label: 'Online now',          href: '/team',               color: '#10b981', bg: 'rgba(16,185,129,0.1)'  },
  { id: 'leave',    title: 'Leave',       icon: CalendarDays, count: '—', label: 'Pending approval',    href: '/leave',              color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'  },
  { id: 'overdue',  title: 'Overdue',     icon: ShieldAlert,  count: '—', label: 'SLA breached',        href: '/tickets?overdue=true', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  { id: 'activity', title: 'Activity',    icon: Activity,     count: '—', label: 'Events today',        href: '/admin/activity',     color: '#06b6d4', bg: 'rgba(6,182,212,0.1)'   },
];

interface QuickNavItem { label: string; icon: LucideIcon; href: string; }
const QUICK_NAV: QuickNavItem[] = [
  { label: 'Home',     icon: Home,        href: '/dashboard'  },
  { label: 'Kanban',   icon: Grid3X3,     href: '/kanban'     },
  { label: 'Calendar', icon: CalendarDays, href: '/calendar'  },
  { label: 'Reports',  icon: BarChart3,   href: '/reports'    },
  { label: 'Settings', icon: Settings,    href: '/settings'   },
  { label: 'Profile',  icon: UserCircle,  href: '/profile'    },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function HomeV2Page() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  const roleObj = user?.role as any;
  const role: string = roleObj?.name ?? (typeof roleObj === 'string' ? roleObj : '') ?? '';
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const roleLabel =
    role === 'SUPER_ADMIN' || role === 'ADMIN' ? 'Company Administrator' :
    role === 'MANAGER' ? 'Department Manager' :
    role === 'TEAM_LEAD' ? 'Team Lead' : 'Contributor';

  const HERO_STATS = [
    { icon: Ticket,        label: 'Open',        value: '—', color: 'rgba(59,130,246,0.85)'  },
    { icon: Clock,         label: 'In Progress', value: '—', color: 'rgba(245,158,11,0.85)'  },
    { icon: AlertTriangle, label: 'In Review',   value: '—', color: 'rgba(168,85,247,0.85)'  },
    { icon: CheckCircle,   label: 'Done',        value: '—', color: 'rgba(16,185,129,0.85)'  },
  ];

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', paddingBottom: 72 }}>

      {/* ── V2 PREVIEW BANNER ────────────────────────────────────────────── */}
      <div
        className="mb-5 px-4 py-2.5 rounded-xl flex items-center gap-3 flex-wrap"
        style={{
          background: 'color-mix(in srgb, #8b5cf6 8%, transparent)',
          border: '1px solid color-mix(in srgb, #8b5cf6 22%, transparent)',
        }}
      >
        <FlaskConical size={13} style={{ color: '#8b5cf6', flexShrink: 0 }} />
        <span style={{ fontSize: 10, fontWeight: 800, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8b5cf6' }}>
          Home V2 · Phase 1 Preview
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Hidden route — production Home is at{' '}
          <code style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)' }}>/dashboard</code>.
          All metrics shown are mock data.
        </span>
        <Link
          href="/dashboard"
          className="ml-auto text-xs font-semibold flex items-center gap-1 flex-shrink-0 transition-opacity hover:opacity-70"
          style={{ color: '#8b5cf6' }}
        >
          Go to live Home <ArrowRight size={11} />
        </Link>
      </div>

      {/* ── SKY-BLUE HERO ────────────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="mb-5 rounded-3xl overflow-hidden relative"
        style={{
          background: 'linear-gradient(135deg, #0EA5E9 0%, #2563EB 52%, #7C3AED 100%)',
          padding: '44px 40px 36px',
        }}
      >
        {/* Decorative blobs */}
        <div style={{ position: 'absolute', top: -80, right: -80, width: 260, height: 260, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 24, right: 100, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -40, left: '40%', width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', pointerEvents: 'none' }} />

        {/* Header row */}
        <div className="flex items-start justify-between gap-6 mb-8 relative">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={13} style={{ color: 'rgba(255,255,255,0.6)' }} />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                {roleLabel}
              </span>
            </div>
            <h1 style={{ fontSize: 40, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px', lineHeight: 1.05, marginBottom: 10 }}>
              {greeting},<br />{firstName}
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>{dateStr}</p>
          </div>

          <div className="flex flex-col gap-2.5 flex-shrink-0 pt-1">
            <button
              onClick={() => router.push('/tickets/new')}
              className="px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-opacity hover:opacity-90"
              style={{ background: '#fff', color: '#2563EB', boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}
            >
              + New Ticket
            </button>
            <button
              onClick={() => router.push('/dashboard')}
              className="px-5 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2 transition-opacity hover:opacity-80"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(8px)' }}
            >
              Live Dashboard <ArrowRight size={13} />
            </button>
          </div>
        </div>

        {/* Stat pills */}
        <div className="flex items-center gap-3 flex-wrap relative">
          {HERO_STATS.map(({ icon: Icon, label, value, color }) => (
            <div
              key={label}
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.2)' }}
            >
              <div style={{ width: 30, height: 30, borderRadius: 8, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={13} style={{ color: '#fff' }} />
              </div>
              <div>
                <p style={{ fontSize: 18, fontWeight: 900, color: '#fff', lineHeight: 1, fontFamily: 'monospace' }}>{value}</p>
                <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
              </div>
            </div>
          ))}
          <div
            className="ml-auto px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(8px)' }}
          >
            <span style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.5)' }}>
              Phase 1 · Mock Data
            </span>
          </div>
        </div>
      </motion.section>

      {/* ── ROW 2: WORKDAY CARD + SMART ORBIT ────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, delay: 0.1 }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5"
      >
        {/* Workday Preview Card */}
        <div
          className="rounded-[22px] overflow-hidden border flex flex-col"
          style={{ backgroundColor: '#0F172A', borderColor: '#1E293B' }}
        >
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #1E293B' }}>
            <div className="flex items-center gap-2">
              <Clock size={13} style={{ color: '#60a5fa' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Workday
              </span>
            </div>
            <span style={{ fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#a78bfa', background: 'rgba(139,92,246,0.12)', padding: '2px 8px', borderRadius: 999 }}>
              Phase 2
            </span>
          </div>

          <div className="p-5 flex-1 flex flex-col">
            {/* Clock face */}
            <div
              className="flex items-center justify-center rounded-2xl mb-5"
              style={{ height: 90, background: 'rgba(15,23,42,0.9)', border: '1px solid #1E293B' }}
            >
              <div className="text-center">
                <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'monospace', color: '#e2e8f0', letterSpacing: 3, lineHeight: 1 }}>
                  --:--
                </div>
                <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: 'monospace', marginTop: 4 }}>
                  No active session
                </div>
              </div>
            </div>

            {/* Session stats */}
            <div className="space-y-3">
              {(
                [
                  { label: 'Work Time',   value: '—',   icon: Clock  },
                  { label: 'Break Time',  value: '—',   icon: Zap    },
                  { label: 'Efficiency',  value: '—',   icon: Target },
                ] as { label: string; value: string; icon: LucideIcon }[]
              ).map(({ label, value, icon: Icon }) => (
                <div key={label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon size={12} style={{ color: '#334155' }} />
                    <span style={{ fontSize: 12, color: '#64748b' }}>{label}</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: '#94a3b8' }}>{value}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #1E293B', fontSize: 10, color: '#334155', textAlign: 'center', fontFamily: 'monospace' }}>
              Connects to live session in Phase 2
            </div>
          </div>
        </div>

        {/* Smart Orbit Graph */}
        <div
          className="lg:col-span-2 rounded-[22px] overflow-hidden border"
          style={{ backgroundColor: '#0F172A', borderColor: '#1E293B' }}
        >
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #1E293B' }}>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: 'rgba(59,130,246,0.12)' }}>
                <TrendingUp size={14} style={{ color: '#60a5fa' }} />
              </div>
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Smart Orbit</h3>
                <p style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace', marginTop: 1 }}>
                  7-Day KPI Velocity · Created vs Resolved
                </p>
              </div>
            </div>
            <span style={{ fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#a78bfa', background: 'rgba(139,92,246,0.12)', padding: '2px 8px', borderRadius: 999 }}>
              Mock · Phase 2
            </span>
          </div>

          <div className="px-5 pt-4 pb-5">
            <div className="flex items-center gap-5 mb-3">
              {[
                { label: 'Created',  color: '#3b82f6' },
                { label: 'Resolved', color: '#10b981' },
              ].map(({ label, color }) => (
                <span key={label} className="flex items-center gap-2" style={{ fontSize: 11, color: '#64748b' }}>
                  <span style={{ display: 'inline-block', width: 20, height: 2, borderRadius: 2, background: color }} />
                  {label}
                </span>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={MOCK_TREND} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                <defs>
                  <linearGradient id="h2v-grad-c" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}    />
                  </linearGradient>
                  <linearGradient id="h2v-grad-r" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.07)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    fontSize: 11, borderRadius: 10,
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    color: '#f1f5f9',
                  }}
                />
                <Area type="monotone" dataKey="created"  name="Created"  stroke="#3b82f6" strokeWidth={2} fill="url(#h2v-grad-c)" />
                <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#10b981" strokeWidth={2} fill="url(#h2v-grad-r)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </motion.div>

      {/* ── EXECUTIVE SCORECARDS ──────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, delay: 0.16 }}
        className="mb-5"
      >
        <div
          className="rounded-[22px] overflow-hidden border"
          style={{ backgroundColor: '#0F172A', borderColor: '#1E293B' }}
        >
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #1E293B' }}>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: 'rgba(139,92,246,0.12)' }}>
                <Star size={14} style={{ color: '#a78bfa' }} />
              </div>
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Executive Scorecards</h3>
                <p style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace', marginTop: 1 }}>
                  Performance pulse across your scope
                </p>
              </div>
            </div>
            <span style={{ fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#a78bfa', background: 'rgba(139,92,246,0.12)', padding: '2px 8px', borderRadius: 999 }}>
              Mock · Phase 2
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4">
            {MOCK_SCORECARDS.map((card, i) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className="p-6"
                  style={{
                    borderRight: i < 3 ? '1px solid #1E293B' : 'none',
                    borderBottom: i < 2 ? '1px solid #1E293B' : 'none',
                  }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 rounded-xl" style={{ background: card.color + '18' }}>
                      <Icon size={14} style={{ color: card.color }} />
                    </div>
                    <span style={{ fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#334155' }}>
                      Phase 2
                    </span>
                  </div>
                  <p style={{ fontSize: 32, fontWeight: 900, fontFamily: 'monospace', color: '#f1f5f9', lineHeight: 1, marginBottom: 6 }}>
                    {card.value}
                  </p>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 2 }}>{card.label}</p>
                  <p style={{ fontSize: 10, color: '#475569' }}>{card.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </motion.section>

      {/* ── WORKFORCE USAGE TRACKING ─────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, delay: 0.2 }}
        className="mb-5"
      >
        <div
          className="rounded-[22px] overflow-hidden border"
          style={{ backgroundColor: '#0F172A', borderColor: '#1E293B' }}
        >
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #1E293B' }}>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: 'rgba(16,185,129,0.1)' }}>
                <Users size={14} style={{ color: '#34d399' }} />
              </div>
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Workforce Usage Tracking</h3>
                <p style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace', marginTop: 1 }}>
                  Team capacity · Ticket load · Presence
                </p>
              </div>
            </div>
            <span style={{ fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#a78bfa', background: 'rgba(139,92,246,0.12)', padding: '2px 8px', borderRadius: 999 }}>
              Mock · Phase 2
            </span>
          </div>

          {MOCK_WORKFORCE.map((person, i) => {
            const loadColor = person.load >= 80 ? '#ef4444' : person.load >= 60 ? '#f97316' : '#10b981';
            return (
              <div
                key={person.name}
                className="px-5 py-4 flex items-center gap-5"
                style={{ borderBottom: i < MOCK_WORKFORCE.length - 1 ? '1px solid #1E293B' : 'none' }}
              >
                {/* Avatar */}
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-black text-base"
                  style={{
                    background: person.online ? 'rgba(16,185,129,0.12)' : 'rgba(51,65,85,0.4)',
                    color: person.online ? '#34d399' : '#475569',
                    border: `1.5px solid ${person.online ? 'rgba(16,185,129,0.35)' : '#1E293B'}`,
                  }}
                >
                  {person.name[0]}
                </div>

                {/* Name + role */}
                <div style={{ width: 120, flexShrink: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{person.name}</p>
                  <p style={{ fontSize: 10, color: '#475569' }}>{person.role}</p>
                </div>

                {/* Load bar */}
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <span style={{ fontSize: 10, color: '#475569' }}>Load</span>
                    <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'monospace', color: loadColor }}>
                      {person.load}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: '#1E293B' }}>
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${person.load}%`, background: loadColor, transition: 'width 0.6s ease' }}
                    />
                  </div>
                </div>

                {/* Tasks + status */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span style={{ fontSize: 12, color: '#64748b' }}>{person.tasks} tasks</span>
                  <span
                    className="px-2.5 py-1 rounded-full font-bold"
                    style={{
                      fontSize: 10,
                      background: person.online ? 'rgba(16,185,129,0.1)' : 'rgba(51,65,85,0.3)',
                      color: person.online ? '#34d399' : '#475569',
                    }}
                  >
                    {person.online ? '● Online' : '○ Away'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </motion.section>

      {/* ── SIX BENTO CARDS ──────────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, delay: 0.22 }}
        className="mb-5"
      >
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {BENTO_CARDS.map((card, i) => {
            const Icon = card.icon;
            return (
              <motion.button
                key={card.id}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.18, delay: 0.22 + i * 0.04 }}
                whileHover={{ y: -3 }}
                onClick={() => router.push(card.href)}
                className="text-left rounded-[22px] overflow-hidden border p-5 group"
                style={{ backgroundColor: '#0F172A', borderColor: '#1E293B' }}
              >
                <div className="flex items-start justify-between mb-5">
                  <div className="p-3 rounded-2xl" style={{ background: card.bg }}>
                    <Icon size={18} style={{ color: card.color }} />
                  </div>
                  <ChevronRight size={14} style={{ color: '#334155', marginTop: 4 }} />
                </div>
                <p style={{ fontSize: 30, fontWeight: 900, fontFamily: 'monospace', color: '#f1f5f9', lineHeight: 1, marginBottom: 6 }}>
                  {card.count}
                </p>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>
                  {card.title}
                </p>
                <p style={{ fontSize: 11, color: '#475569' }}>{card.label}</p>
              </motion.button>
            );
          })}
        </div>
      </motion.section>

      {/* ── QUICK NAVIGATION DOCK ────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, delay: 0.28 }}
      >
        <div
          className="rounded-[22px] border px-5 py-4"
          style={{ backgroundColor: '#0F172A', borderColor: '#1E293B' }}
        >
          <p style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#334155', marginBottom: 12 }}>
            Quick Navigation
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            {QUICK_NAV.map(({ label, icon: Icon, href }) => (
              <Link
                key={label}
                href={href}
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl transition-all"
                style={{
                  background: '#1E293B',
                  border: '1px solid #334155',
                  color: '#64748b',
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = '#475569';
                  (e.currentTarget as HTMLAnchorElement).style.color = '#e2e8f0';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = '#334155';
                  (e.currentTarget as HTMLAnchorElement).style.color = '#64748b';
                }}
              >
                <Icon size={13} />
                {label}
              </Link>
            ))}
          </div>
        </div>
      </motion.section>
    </div>
  );
}
