'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = ['#6366f1', '#f59e0b', '#ec4899', '#10b981', '#3b82f6', '#64748b'];

const CATEGORY_LABELS: Record<string, string> = {
  IT: 'IT', FACILITIES: 'Facilities', HR: 'HR',
  OPERATIONS: 'Operations', PROJECT: 'Project', ADMIN: 'Admin',
};

export function CategoryChart({ data }: { data: any[] }) {
  if (!data?.length) return <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No data</div>;

  const formatted = data.map((d) => ({
    name: CATEGORY_LABELS[d.category] || d.category,
    value: d.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie
          data={formatted}
          cx="50%"
          cy="45%"
          innerRadius={40}
          outerRadius={65}
          paddingAngle={3}
          dataKey="value"
        >
          {formatted.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
