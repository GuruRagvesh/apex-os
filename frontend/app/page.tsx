'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

const FEATURES = [
  { icon: '🎫', title: 'Ticket Management', desc: 'Raise, assign and track every task — from light bulb replacement to boardroom decisions' },
  { icon: '📋', title: 'Project Tracking', desc: 'Auto-ID projects, progress bars, member management and department organisation' },
  { icon: '🤖', title: 'AI Assistant', desc: 'Priority suggestions, daily digest emails, smart assignment based on workload' },
  { icon: '👥', title: 'Leave Management', desc: 'Apply, approve, reject — complete HRMS without a separate tool' },
  { icon: '⚡', title: 'Real-time Updates', desc: 'Socket.IO live notifications, instant activity feed, no page refresh needed' },
  { icon: '📊', title: 'Analytics', desc: 'Role-based dashboards for every management level with date range reporting' },
];

const STATS = [
  { value: '40', label: 'Employees' },
  { value: '11', label: 'Departments' },
  { value: 'AI', label: 'Powered' },
  { value: '⚡', label: 'Real-time' },
  { value: '🇮🇳', label: 'Built for India' },
];

const STEPS = [
  { step: '1', title: 'Raise a ticket', desc: 'Report any task, issue or request in seconds' },
  { step: '2', title: 'Assign to team', desc: 'Route to the right person automatically or manually' },
  { step: '3', title: 'Track progress', desc: 'Real-time status updates, SLA timers, comments' },
  { step: '4', title: 'Done ✓', desc: 'Mark resolved, notify stakeholders, log to analytics' },
];

export default function HomePage() {
  const { isAuthenticated, hasHydrated } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (hasHydrated && isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [hasHydrated, isAuthenticated, router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0f1e] via-[#0d1929] to-[#1a1040] text-white">
      {/* Animated blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-3/4 left-1/2 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* Topbar */}
      <header className="fixed top-0 w-full bg-white/5 backdrop-blur-md border-b border-white/10 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center font-bold text-lg">A</div>
            <span className="font-bold text-lg">Apex OS</span>
          </div>
          <Link
            href="/login"
            className="bg-gradient-to-r from-blue-500 to-indigo-600 px-5 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition-all"
          >
            Sign In →
          </Link>
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="min-h-screen flex flex-col items-center justify-center text-center px-6 pt-16">
          <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-full px-4 py-2 text-blue-300 text-sm mb-8">
            🚀 Built for TechnoEdge · Powered by AI
          </div>
          <h1 className="text-5xl md:text-7xl font-bold leading-tight mb-6 max-w-4xl">
            The AI-Powered<br />
            <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">Business OS</span>
          </h1>
          <p className="text-xl text-slate-400 max-w-2xl mb-10">
            Every task, every team, every decision — in one place
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link
              href="/login"
              className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-8 py-4 rounded-xl font-semibold hover:shadow-lg hover:shadow-blue-500/25 transition-all"
            >
              Sign In to Apex OS →
            </Link>
            <a
              href="#features"
              className="border border-white/20 text-white px-8 py-4 rounded-xl hover:bg-white/5 transition-all"
            >
              Learn More ↓
            </a>
          </div>
        </section>

        {/* Stats bar */}
        <section className="max-w-5xl mx-auto px-6 pb-20">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-wrap justify-around gap-6">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-2xl font-bold text-white">{s.value}</p>
                <p className="text-sm text-slate-400 mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="max-w-6xl mx-auto px-6 pb-24">
          <h2 className="text-3xl font-bold text-center mb-12">Everything your team needs</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-all">
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-slate-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="max-w-5xl mx-auto px-6 pb-24">
          <h2 className="text-3xl font-bold text-center mb-12">How Apex OS works</h2>
          <div className="flex flex-col md:flex-row gap-6 items-start">
            {STEPS.map((s, i) => (
              <div key={s.step} className="flex-1 text-center">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-lg mx-auto mb-3">
                  {s.step}
                </div>
                <h3 className="font-semibold text-white mb-1">{s.title}</h3>
                <p className="text-sm text-slate-400">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="text-center pb-24 px-6">
          <div className="max-w-2xl mx-auto bg-gradient-to-br from-blue-900/40 to-indigo-900/40 border border-white/10 rounded-2xl p-12">
            <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
            <p className="text-slate-400 mb-8">Sign in with your TechnoEdge account and take control of your workflow.</p>
            <Link
              href="/login"
              className="inline-block bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-10 py-4 rounded-xl font-semibold hover:shadow-xl hover:shadow-blue-500/30 hover:scale-105 transition-all"
            >
              Sign In to Apex OS →
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8 text-center text-slate-400 text-sm">
        <p>© 2026 TechnoEdge Learning Services · Apex OS v1.0</p>
        <div className="flex items-center justify-center gap-4 mt-2">
          <Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
          <a href="mailto:admin@technoedgels.com" className="hover:text-white transition-colors">Contact</a>
        </div>
      </footer>
    </div>
  );
}
