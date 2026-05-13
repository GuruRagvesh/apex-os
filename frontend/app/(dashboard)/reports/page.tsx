'use client';

import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';
import { cn, getInitials } from '@/lib/utils';

const DEPT_COLORS = ['#6366f1', '#f59e0b', '#ec4899', '#10b981', '#3b82f6'];
const PRIORITY_COLORS_MAP: Record<string, string> = { URGENT: '#ef4444', HIGH: '#f97316', MEDIUM: '#3b82f6', LOW: '#94a3b8' };
const STATUS_COLORS_MAP: Record<string, string> = { OPEN: '#eab308', IN_PROGRESS: '#3b82f6', REVIEW: '#a855f7', DONE: '#22c55e', CLOSED: '#94a3b8' };

export default function ReportsPage() {
  const { data: deptData } = useQuery({ queryKey: ['tickets-by-dept'], queryFn: () => dashboardApi.getTicketsByDepartment() as Promise<any[]> });
  const { data: workload } = useQuery({ queryKey: ['workload'], queryFn: () => dashboardApi.getWorkload() });
  const { data: overview } = useQuery({ queryKey: ['dashboard-overview'], queryFn: () => dashboardApi.getOverview() as Promise<any> });

  const stats = overview?.stats || {};

  const statusData = overview?.stats ? [
    { name: 'Open', value: stats.openTickets || 0, color: STATUS_COLORS_MAP.OPEN },
    { name: 'In Progress', value: stats.inProgressTickets || 0, color: STATUS_COLORS_MAP.IN_PROGRESS },
    { name: 'Done', value: stats.doneTickets || 0, color: STATUS_COLORS_MAP.DONE },
  ] : [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Reports & Analytics</h2>
        <p className="text-sm text-slate-500 mt-0.5">Performance metrics and insights</p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Resolution Rate', value: stats.totalTickets ? `${Math.round((stats.doneTickets / stats.totalTickets) * 100)}%` : '0%', sub: 'tickets resolved', good: true },
          { label: 'Overdue', value: stats.overdueTickets || 0, sub: 'past due date', good: false },
          { label: 'Unassigned', value: '—', sub: 'need assignment' },
          { label: 'Active Projects', value: stats.activeProjects || 0, sub: `of ${stats.totalProjects || 0} total` },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-2xl font-bold text-slate-800">{kpi.value}</p>
            <p className="text-sm font-medium text-slate-600 mt-0.5">{kpi.label}</p>
            <p className="text-xs text-slate-400 mt-0.5">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Dept Chart */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-800 mb-4">Tickets by Department</h3>
          {deptData?.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={deptData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="total" name="Total" radius={[4, 4, 0, 0]}>
                  {deptData.map((_: any, i: number) => (
                    <Cell key={i} fill={DEPT_COLORS[i % DEPT_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="h-40 flex items-center justify-center text-slate-400 text-sm">No data</div>}
        </div>

        {/* Status Breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-800 mb-4">Status Breakdown</h3>
          {statusData.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" outerRadius={80} paddingAngle={3} dataKey="value">
                  {statusData.map((entry: any, i: number) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="h-40 flex items-center justify-center text-slate-400 text-sm">No data</div>}
        </div>
      </div>

      {/* Workload Table */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Team Workload</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="text-left px-5 py-3">Team Member</th>
                <th className="text-left px-5 py-3">Department</th>
                <th className="text-center px-5 py-3">Total Assigned</th>
                <th className="text-center px-5 py-3">In Progress</th>
                <th className="text-center px-5 py-3">Urgent</th>
                <th className="text-center px-5 py-3">High</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {Array.isArray(workload) && workload.map((w: any) => (
                <tr key={w.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs font-semibold">{getInitials(w.name)}</span>
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">{w.name}</p>
                        <p className="text-xs text-slate-400">{w.role}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{w.department || '—'}</td>
                  <td className="px-5 py-3 text-center">
                    <span className="font-semibold text-slate-800">{w.totalAssigned}</span>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', w.inProgress > 0 ? 'bg-blue-100 text-blue-700' : 'text-slate-400')}>
                      {w.inProgress}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', w.urgent > 0 ? 'bg-red-100 text-red-700' : 'text-slate-400')}>
                      {w.urgent}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', w.high > 0 ? 'bg-orange-100 text-orange-700' : 'text-slate-400')}>
                      {w.high}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
