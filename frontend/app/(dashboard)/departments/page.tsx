'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { departmentsApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Plus, Users, Ticket, FolderKanban } from 'lucide-react';
import toast from 'react-hot-toast';

export default function DepartmentsPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', color: '#6366f1' });

  const isAdmin = user?.role?.name === 'Admin';

  const { data: departments, isLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll() as Promise<any[]>,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => departmentsApi.create(data),
    onSuccess: () => { toast.success('Department created!'); qc.invalidateQueries({ queryKey: ['departments'] }); setShowNew(false); setForm({ name: '', description: '', color: '#6366f1' }); },
    onError: () => toast.error('Failed to create department'),
  });

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Departments</h2>
          <p className="text-sm text-slate-500">{Array.isArray(departments) ? departments.length : 0} departments</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            <Plus size={16} />New Department
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.isArray(departments) && departments.map((d: any) => (
            <div key={d.id} className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-all">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: d.color + '20' }}>
                  <div className="w-5 h-5 rounded-full" style={{ backgroundColor: d.color }} />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">{d.name}</h3>
                  {d.description && <p className="text-xs text-slate-500 mt-0.5">{d.description}</p>}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <div className="flex items-center justify-center mb-1"><Users size={14} className="text-slate-400" /></div>
                  <p className="text-lg font-bold text-slate-800">{d._count?.users || 0}</p>
                  <p className="text-xs text-slate-400">Members</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <div className="flex items-center justify-center mb-1"><Ticket size={14} className="text-slate-400" /></div>
                  <p className="text-lg font-bold text-slate-800">{d._count?.tickets || 0}</p>
                  <p className="text-xs text-slate-400">Tickets</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <div className="flex items-center justify-center mb-1"><FolderKanban size={14} className="text-slate-400" /></div>
                  <p className="text-lg font-bold text-slate-800">{d._count?.projects || 0}</p>
                  <p className="text-xs text-slate-400">Projects</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="font-bold text-slate-800 text-lg mb-5">New Department</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Name *</label>
                <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="e.g., Finance" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
                <input type="text" value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} className={inputCls} placeholder="Brief description" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Color</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={form.color} onChange={(e) => setForm(f => ({ ...f, color: e.target.value }))} className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer" />
                  <span className="text-sm text-slate-500">{form.color}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => form.name && createMutation.mutate(form)} disabled={createMutation.isPending || !form.name} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg disabled:opacity-50 text-sm">
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
              <button onClick={() => setShowNew(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-lg hover:bg-slate-50 text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
