'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@apex/core-identity';
import { Zap, Users, ArrowRight } from 'lucide-react';

export default function SelectModePage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [lastMode, setLastMode] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Defensive: role may be an object { name } or a plain string
    const roleName = (user?.role as any)?.name || (user?.role as any) || '';
    // Non-SUPER_ADMIN users go straight to dashboard
    if (user && roleName !== 'SUPER_ADMIN') {
      router.replace('/dashboard');
      return;
    }
    setLastMode(localStorage.getItem('apexMode'));
    setHydrated(true);
  }, [user, router]);

  const selectMode = (mode: 'super_admin' | 'team_lead') => {
    localStorage.setItem('apexMode', mode);
    router.push('/dashboard');
  };

  if (!hydrated) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">

        {/* Header */}
        <div className="text-center mb-10">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5 shadow-lg"
            style={{ background: 'linear-gradient(135deg, #1e40af 0%, #4f46e5 100%)' }}
          >
            <span className="text-white text-2xl font-bold">A</span>
          </div>
          <h1 className="text-3xl font-bold text-white">
            Welcome, {user?.name?.split(' ')[0]} 👋
          </h1>
          <p className="text-slate-400 mt-2 text-sm">Choose how you'd like to work today</p>
        </div>

        {/* Mode Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* ── Super Admin ── */}
          <button
            onClick={() => selectMode('super_admin')}
            className="group relative text-left rounded-2xl p-8 transition-all duration-200 hover:scale-[1.02] cursor-pointer"
            style={{
              background: 'linear-gradient(135deg, rgba(88,28,135,0.7) 0%, rgba(109,40,217,0.5) 100%)',
              border: lastMode === 'super_admin'
                ? '1px solid rgba(167,139,250,0.65)'
                : '1px solid rgba(139,92,246,0.25)',
              boxShadow: lastMode === 'super_admin'
                ? '0 0 0 1px rgba(167,139,250,0.25), 0 12px 40px rgba(88,28,135,0.35)'
                : '0 4px 24px rgba(0,0,0,0.2)',
            }}
          >
            {lastMode === 'super_admin' && (
              <span className="absolute top-4 right-4 flex items-center gap-1.5 text-xs bg-purple-400/20 text-purple-200 px-2.5 py-1 rounded-full border border-purple-400/30 font-medium">
                <span className="w-1.5 h-1.5 bg-purple-300 rounded-full animate-pulse" />
                Last used
              </span>
            )}

            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6"
              style={{
                background: 'rgba(139,92,246,0.22)',
                border: '1px solid rgba(167,139,250,0.3)',
              }}
            >
              <Zap size={28} className="text-purple-300" />
            </div>

            <h2 className="text-2xl font-bold text-white mb-3">Super Admin</h2>
            <p className="text-purple-200/75 text-sm leading-relaxed">
              Full company access — all departments, all tickets, all employees, system settings
            </p>

            <div className="mt-6 pt-4 border-t border-purple-400/20 flex items-center justify-between">
              <div className="flex flex-wrap gap-3 text-xs text-purple-300/65">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-purple-400 rounded-full" /> All departments
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-purple-400 rounded-full" /> System settings
                </span>
              </div>
              <ArrowRight
                size={16}
                className="text-purple-300/40 group-hover:text-purple-300 group-hover:translate-x-1 transition-all flex-shrink-0 ml-2"
              />
            </div>
          </button>

          {/* ── AI & R&D Team Lead ── */}
          <button
            onClick={() => selectMode('team_lead')}
            className="group relative text-left rounded-2xl p-8 transition-all duration-200 hover:scale-[1.02] cursor-pointer"
            style={{
              background: 'linear-gradient(135deg, rgba(30,64,175,0.7) 0%, rgba(79,70,229,0.5) 100%)',
              border: lastMode === 'team_lead'
                ? '1px solid rgba(147,197,253,0.65)'
                : '1px solid rgba(96,165,250,0.25)',
              boxShadow: lastMode === 'team_lead'
                ? '0 0 0 1px rgba(147,197,253,0.25), 0 12px 40px rgba(30,64,175,0.35)'
                : '0 4px 24px rgba(0,0,0,0.2)',
            }}
          >
            {lastMode === 'team_lead' && (
              <span className="absolute top-4 right-4 flex items-center gap-1.5 text-xs bg-blue-400/20 text-blue-200 px-2.5 py-1 rounded-full border border-blue-400/30 font-medium">
                <span className="w-1.5 h-1.5 bg-blue-300 rounded-full animate-pulse" />
                Last used
              </span>
            )}

            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6"
              style={{
                background: 'rgba(96,165,250,0.18)',
                border: '1px solid rgba(147,197,253,0.3)',
              }}
            >
              <Users size={28} className="text-blue-300" />
            </div>

            <h2 className="text-2xl font-bold text-white mb-3">AI & R&D Lead</h2>
            <p className="text-blue-200/75 text-sm leading-relaxed">
              Your team view — manage Sonali, Snehal, Pratik, Shama and AI & R&D tasks
            </p>

            <div className="mt-6 pt-4 border-t border-blue-400/20 flex items-center justify-between">
              <div className="flex flex-wrap gap-3 text-xs text-blue-300/65">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" /> 4 team members
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" /> AI & R&D focus
                </span>
              </div>
              <ArrowRight
                size={16}
                className="text-blue-300/40 group-hover:text-blue-300 group-hover:translate-x-1 transition-all flex-shrink-0 ml-2"
              />
            </div>
          </button>

        </div>

        <p className="text-center text-slate-600 text-xs mt-8">
          You can switch modes anytime from the top bar
        </p>
      </div>
    </div>
  );
}
