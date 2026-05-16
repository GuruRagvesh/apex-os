'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

const roleColors: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  ADMIN: 'bg-red-500/20 text-red-300 border-red-500/30',
  MANAGER: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  TEAM_LEAD: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  EMPLOYEE: 'bg-green-500/20 text-green-300 border-green-500/30',
  INTERN: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

export default function WelcomePage() {
  const { user, hasHydrated } = useAuthStore();
  const router = useRouter();
  const [now, setNow] = useState(new Date());
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!user) { router.push('/login'); return; }
    if (localStorage.getItem('apexWelcomeSeen') === 'true') {
      const roleName = (user?.role as any)?.name ?? '';
      router.push(roleName === 'SUPER_ADMIN' ? '/select-mode' : '/dashboard');
      return;
    }
    setVisible(true);
  }, [hasHydrated, user, router]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const timeStr = now.toLocaleString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true, timeZone: 'Asia/Kolkata',
  });

  const roleName = (user?.role as any)?.name ?? (user?.role as any) ?? '';
  const deptName = (user?.department as any)?.name ?? '';
  const firstName = user?.name?.split(' ')[0] ?? '';

  const handleEnter = () => {
    localStorage.setItem('apexWelcomeSeen', 'true');
    router.push(roleName === 'SUPER_ADMIN' ? '/select-mode' : '/dashboard');
  };

  if (!visible) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a0f1e] via-[#0d1929] to-[#1a1040] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0f1e] via-[#0d1929] to-[#1a1040] relative overflow-hidden">
      {/* Animated background shapes */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 right-1/3 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* Live clock */}
      <div className="absolute top-6 right-6 text-right z-10">
        <div className="text-slate-400 text-sm font-mono">{timeStr}</div>
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 py-20">

        <div className="text-center mb-6">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-3">
            {greeting}, {firstName}! 👋
          </h1>
          <p className="text-slate-400 text-lg">
            Welcome to Apex OS — TechnoEdge&apos;s AI-powered command centre
          </p>
        </div>

        <div className="mb-10">
          <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium ${roleColors[roleName] ?? roleColors.EMPLOYEE}`}>
            {roleName.replace('_', ' ')} · {deptName}
          </span>
        </div>

        {/* 3 feature cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl w-full mb-10">
          {[
            { icon: '🎫', title: 'Track Everything', desc: 'Every task gets a ticket. Every ticket gets done.' },
            { icon: '🤖', title: 'AI Assistant', desc: 'Priority suggestions, daily digest, smart assignment' },
            { icon: '👥', title: 'Your Team', desc: 'Real-time updates, leave management, team analytics' },
          ].map((card, i) => (
            <div
              key={i}
              className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 text-center"
            >
              <div className="text-3xl mb-3">{card.icon}</div>
              <h3 className="text-white font-semibold mb-1">{card.title}</h3>
              <p className="text-slate-400 text-sm">{card.desc}</p>
            </div>
          ))}
        </div>

        {/* Quick guide */}
        <div className="text-center mb-10">
          <p className="text-slate-500 text-sm mb-2">Getting started</p>
          <div className="flex flex-col md:flex-row gap-2 md:gap-6 text-slate-400 text-sm">
            <span>1️⃣ Raise a ticket for any task</span>
            <span className="hidden md:block text-slate-600">·</span>
            <span>2️⃣ Update status as you work</span>
            <span className="hidden md:block text-slate-600">·</span>
            <span>3️⃣ Check your dashboard daily</span>
          </div>
        </div>

        {/* CTA button */}
        <button
          onClick={handleEnter}
          className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-10 py-4 rounded-xl font-semibold text-lg hover:shadow-2xl hover:shadow-blue-500/30 hover:scale-105 transition-all duration-200"
        >
          Enter Apex OS →
        </button>
      </div>

      <style jsx global>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
