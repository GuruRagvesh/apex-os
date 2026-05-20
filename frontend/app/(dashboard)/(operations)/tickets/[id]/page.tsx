'use client';

import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ticketsApi, commentsApi, usersApi, aiApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import {
  cn, PRIORITY_COLORS, STATUS_COLORS, CATEGORY_COLORS,
  STATUS_LABELS, PRIORITY_LABELS, CATEGORY_LABELS,
  formatDate, formatRelativeTime, getInitials,
} from '@/lib/utils';
import { SkeletonTicketDetail } from '@/components/ui/skeleton';
import { useSocket } from '@/hooks/useSocket';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Send, Trash2, Clock, Calendar, User, Building2, Tag,
  Copy, Timer, CheckCircle, XCircle, History, Paperclip, Upload,
  FileText, AlertTriangle, Sparkles, ChevronDown, ChevronUp, Loader2,
  Lightbulb, UserCheck, Hourglass, Download, Eye, Users, Edit2,
} from 'lucide-react';
import Link from 'next/link';
import { Breadcrumb } from '@/components/ui/breadcrumb';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CLOSED'];

const RECURRENCE_LABELS: Record<string, string> = {
  daily_morning: 'Every day — Morning (9 AM)',
  daily_evening: 'Every day — Evening (6 PM)',
  weekly: 'Every week',
  monthly: 'Every month',
  '1_month': 'Daily for 1 month',
  '6_months': 'Daily for 6 months',
};

// ─── SLA Timer ───────────────────────────────────────────────────────────────
function SlaTimer({ createdAt, slaHours, slaPercent, isOverdue }: {
  createdAt: string; slaHours?: number; slaPercent?: number; isOverdue?: boolean;
}) {
  const ms = Date.now() - new Date(createdAt).getTime();
  const totalMins = Math.floor(ms / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;

  const label = days > 0
    ? `${days}d ${hours}h open`
    : hours > 0
    ? `${hours}h ${mins}m open`
    : `${mins}m open`;

  const pct = slaPercent ?? 0;
  const barColor = isOverdue || pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-orange-400' : 'bg-emerald-400';

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <Timer size={13} className={isOverdue ? 'text-red-400' : 'text-slate-400'} />
        <span className={cn('text-xs', isOverdue ? 'text-red-500 font-medium' : 'text-slate-600 dark:text-gray-400')}>
          {label}{slaHours ? ` · SLA: ${slaHours}h` : ''}
        </span>
        {isOverdue && (
          <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
            <AlertTriangle size={9} /> OVERDUE
          </span>
        )}
      </div>
      {typeof pct === 'number' && (
        <div className="w-full h-1.5 bg-slate-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      )}
    </div>
  );
}

// ─── Copyable Ticket ID ───────────────────────────────────────────────────────
function CopyableId({ ticketId }: { ticketId: string }) {
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(ticketId).then(() =>
          toast.success(`Copied ${ticketId}`, { duration: 2000 }),
        );
      }}
      className="group flex items-center gap-1 text-slate-400 dark:text-gray-500 font-mono text-sm font-medium hover:text-slate-600 dark:hover:text-gray-300 transition-colors"
      title="Click to copy"
    >
      {ticketId}
      <Copy size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

// ─── History helpers ──────────────────────────────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  status: 'status',
  assignedToId: 'assignee',
  priority: 'priority',
  title: 'title',
};

const STATUS_DISPLAY: Record<string, string> = {
  OPEN: 'Open', IN_PROGRESS: 'In Progress', REVIEW: 'Under Review', DONE: 'Done', CLOSED: 'Closed',
};

function humanValue(field: string, value: string | null) {
  if (!value) return 'none';
  if (field === 'status') return STATUS_DISPLAY[value] ?? value;
  return value;
}

// ─── Attachment card ──────────────────────────────────────────────────────────
function AttachmentCard({ att }: { att: any }) {
  const isImage = att.mimeType?.startsWith('image/');
  const isPdf = att.mimeType === 'application/pdf';
  const isDoc = att.mimeType?.includes('word') || att.filename?.endsWith('.doc') || att.filename?.endsWith('.docx');
  const isRemote = att.url?.startsWith('http');
  const sizeKb = att.size ? Math.round(att.size / 1024) : null;

  const handleView = () => window.open(att.url, '_blank');
  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = att.url;
    a.download = att.filename;
    a.click();
  };

  return (
    <div className="flex items-start gap-2 p-2.5 border border-slate-200 dark:border-gray-700 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800/50 transition-colors">
      {/* Thumbnail / Icon */}
      <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-slate-100 dark:bg-gray-800 flex items-center justify-center">
        {isImage && isRemote ? (
          <img src={att.url} alt={att.filename} className="w-full h-full object-cover" />
        ) : isPdf ? (
          <FileText size={18} className="text-red-400" />
        ) : isDoc ? (
          <FileText size={18} className="text-blue-400" />
        ) : (
          <FileText size={18} className="text-slate-400 dark:text-gray-500" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-xs font-medium text-slate-700 dark:text-gray-300 truncate max-w-[120px]">{att.filename}</p>
          {att.isPoc && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded">
              POC
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">
          {sizeKb ? `${sizeKb} KB · ` : ''}
          {att.createdAt ? new Date(att.createdAt).toLocaleDateString() : ''}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={handleView}
          title="View"
          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-500 dark:text-gray-400 transition-colors"
        >
          <Eye size={13} />
        </button>
        <button
          onClick={handleDownload}
          title="Download"
          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-500 dark:text-gray-400 transition-colors"
        >
          <Download size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── AI Suggestions panel ────────────────────────────────────────────────────
function AiSuggestionsPanel({ ticketId }: { ticketId: string }) {
  const [open, setOpen] = useState(false);
  const [fetched, setFetched] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ai-suggestions', ticketId],
    queryFn: () => aiApi.ticketSuggestions(ticketId) as Promise<{
      nextAction?: string;
      suggestedAssignee?: string;
      estimatedTime?: string;
      result?: string;
      disabled?: boolean;
    }>,
    enabled: false, // only fetch on demand
    staleTime: 10 * 60 * 1000,
  });
  const aiDisabled = data?.disabled === true;

  const handleToggle = () => {
    if (!open && !fetched) {
      refetch();
      setFetched(true);
    }
    setOpen((v) => !v);
  };

  const rows = [
    { icon: <Lightbulb size={14} className="text-amber-500" />, label: 'Next Action', value: data?.nextAction },
    { icon: <UserCheck size={14} className="text-indigo-500" />, label: 'Suggested Assignee', value: data?.suggestedAssignee },
    { icon: <Hourglass size={14} className="text-emerald-500" />, label: 'Estimated Time', value: data?.estimatedTime },
  ];

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-indigo-100 dark:border-indigo-900/50 overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#1e40af,#4f46e5)' }}>
            <Sparkles size={12} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-700 dark:text-gray-300">AI Suggestions</span>
          <span className="text-[10px] font-medium bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded">GPT-4o mini</span>
        </div>
        {open
          ? <ChevronUp size={15} className="text-slate-400 dark:text-gray-500" />
          : <ChevronDown size={15} className="text-slate-400 dark:text-gray-500" />}
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="px-4 pb-4 border-t border-indigo-50 dark:border-gray-800">
          {isLoading && (
            <div className="flex items-center gap-2 py-4 text-sm text-slate-500 dark:text-gray-400">
              <Loader2 size={16} className="animate-spin text-indigo-400" />
              Analysing ticket with AI…
            </div>
          )}
          {error && !aiDisabled && (
            <p className="py-3 text-xs text-red-500">
              Failed to load suggestions. Please try again later.
            </p>
          )}
          {aiDisabled && (
            <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
              <Sparkles size={20} className="text-slate-300 dark:text-gray-600" />
              <p className="text-sm text-slate-600 dark:text-gray-400 font-medium">AI suggestions coming soon</p>
              <p className="text-xs text-slate-400 dark:text-gray-500">Smart next-action, assignee and time-estimate suggestions will appear here.</p>
            </div>
          )}
          {data && !aiDisabled && (
            <div className="pt-3 space-y-3">
              {rows.map((row) => (
                <div key={row.label} className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex-shrink-0">{row.icon}</div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-gray-500">{row.label}</p>
                    <p className="text-sm text-slate-700 dark:text-gray-300 mt-0.5">{row.value}</p>
                  </div>
                </div>
              ))}
              <button
                onClick={() => { setFetched(false); refetch(); }}
                className="text-xs text-indigo-500 hover:text-indigo-700 mt-1"
              >
                ↺ Refresh suggestions
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── POC Upload Modal ─────────────────────────────────────────────────────────
function PocUploadModal({
  ticketId,
  onUploadAndSubmit,
  onSkip,
  onClose,
  isUploading,
}: {
  ticketId: string;
  onUploadAndSubmit: (file: File) => void;
  onSkip: () => void;
  onClose: () => void;
  isUploading: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error('File must be under 5 MB'); return; }
    setSelectedFile(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
            <Paperclip size={18} className="text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800 dark:text-white text-base">Upload Proof of Completion</h3>
            <p className="text-xs text-slate-500 dark:text-gray-400">
              Moving this ticket to Review requires uploading proof of work completed.
            </p>
          </div>
        </div>

        {/* Drop zone */}
        <div
          className={cn(
            'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
            dragOver
              ? 'border-purple-400 bg-purple-50 dark:bg-purple-900/10'
              : 'border-slate-200 dark:border-gray-700 hover:border-purple-300',
          )}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
        >
          {selectedFile ? (
            <div className="flex items-center justify-center gap-2">
              <FileText size={18} className="text-purple-500" />
              <span className="text-sm font-medium text-slate-700 dark:text-gray-300 truncate max-w-[200px]">
                {selectedFile.name}
              </span>
              <span className="text-xs text-slate-400">({Math.round(selectedFile.size / 1024)} KB)</span>
            </div>
          ) : (
            <>
              <Upload size={24} className="mx-auto text-slate-400 dark:text-gray-500 mb-2" />
              <p className="text-sm font-medium text-slate-600 dark:text-gray-400">Drop files here or click to upload</p>
              <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">Supports: PDF, PNG, JPG, DOC (max 5MB)</p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onSkip}
            disabled={isUploading}
            className="flex-1 py-2.5 text-sm text-slate-600 dark:text-gray-400 border border-slate-200 dark:border-gray-700 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            Skip for now
          </button>
          <button
            onClick={() => selectedFile && onUploadAndSubmit(selectedFile)}
            disabled={!selectedFile || isUploading}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {isUploading ? (
              <><Loader2 size={14} className="animate-spin" /> Uploading…</>
            ) : (
              <><Upload size={14} /> Upload & Submit</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type Tab = 'comments' | 'history' | 'attachments';

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const [comment, setComment] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('comments');
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  // POC upload modal state
  const [showPocModal, setShowPocModal] = useState(false);
  const [pocUploading, setPocUploading] = useState(false);
  // Edit modal state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => ticketsApi.getOne(id) as Promise<any>,
  });

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll() as Promise<any[]>,
  });

  const { data: history } = useQuery({
    queryKey: ['ticket-history', id],
    queryFn: () => ticketsApi.getHistory(id) as Promise<any[]>,
    enabled: activeTab === 'history',
  });

  useSocket({
    onTicketStatusChanged: ({ ticketId: changedId, newStatus }) => {
      if (ticket && changedId === ticket.id) {
        qc.invalidateQueries({ queryKey: ['ticket', id] });
        toast(`Status changed to ${newStatus.replace('_', ' ')}`, { icon: '🔄', duration: 3000 });
      }
    },
  });

  const updateStatus = useMutation({
    mutationFn: (status: string) => ticketsApi.updateStatus(ticket.id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      qc.invalidateQueries({ queryKey: ['ticket-history', id] });
      toast.success('Status updated');
    },
  });

  // Intercept REVIEW click to show POC modal
  const handleStatusClick = (status: string) => {
    if (status === 'REVIEW') {
      setShowPocModal(true);
    } else {
      updateStatus.mutate(status);
    }
  };

  const handlePocUploadAndSubmit = async (file: File) => {
    setPocUploading(true);
    try {
      await ticketsApi.uploadAttachment(ticket.id, file, true);
      await ticketsApi.updateStatus(ticket.id, 'REVIEW');
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      qc.invalidateQueries({ queryKey: ['ticket-history', id] });
      toast.success('POC uploaded and ticket moved to Review');
      setShowPocModal(false);
    } catch {
      toast.error('Failed to upload POC or update status');
    } finally {
      setPocUploading(false);
    }
  };

  const handlePocSkip = async () => {
    setShowPocModal(false);
    updateStatus.mutate('REVIEW');
  };

  const assignMutation = useMutation({
    mutationFn: (assignedToId: string) => ticketsApi.assign(ticket.id, assignedToId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      qc.invalidateQueries({ queryKey: ['ticket-history', id] });
      toast.success('Assigned!');
    },
  });

  const addComment = useMutation({
    mutationFn: () => commentsApi.create(id, comment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      toast.success('Comment added');
      setComment('');
    },
    onError: () => toast.error('Failed to add comment'),
  });

  const deleteTicket = useMutation({
    mutationFn: () => ticketsApi.remove(ticket.id),
    onSuccess: () => { router.push('/tickets'); toast.success('Ticket deleted'); },
    onError: () => toast.error('Failed to delete ticket'),
  });

  const approveMutation = useMutation({
    mutationFn: () => ticketsApi.approve(ticket.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      qc.invalidateQueries({ queryKey: ['ticket-history', id] });
      toast.success('Ticket approved ✓');
    },
    onError: () => toast.error('Failed to approve ticket'),
  });

  const rejectMutation = useMutation({
    mutationFn: () => ticketsApi.reject(ticket.id, rejectComment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      qc.invalidateQueries({ queryKey: ['ticket-history', id] });
      toast.success('Ticket sent back to In Progress');
      setRejectMode(false);
      setRejectComment('');
    },
    onError: () => toast.error('Failed to reject ticket'),
  });

  const editMutation = useMutation({
    mutationFn: (data: any) => ticketsApi.update(ticket.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      toast.success('Ticket updated');
      setEditing(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Update failed'),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => ticketsApi.uploadAttachment(ticket.id, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      toast.success('File uploaded');
      setActiveTab('attachments');
    },
    onError: () => toast.error('Upload failed'),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('File must be under 5 MB'); return; }
    uploadMutation.mutate(file);
    e.target.value = '';
  };

  if (isLoading) return <SkeletonTicketDetail />;
  if (!ticket) return <div className="text-center py-12 text-slate-500">Ticket not found</div>;

  const roleName = (user?.role as any)?.name ?? (user?.role as any) ?? '';
  const isManagerPlus = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
  const isParticipant = ticket.createdById === user?.id || ticket.assignedToId === user?.id;
  const canEdit = isManagerPlus || isParticipant;
  const canDelete = isManagerPlus;
  const canApprove = isManagerPlus && ticket.status === 'REVIEW';
  const isDone = ticket.status === 'DONE' || ticket.status === 'CLOSED';

  const submitComment = () => { if (comment.trim()) addComment.mutate(); };

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'comments', label: 'Comments', count: ticket.comments?.length ?? 0 },
    { key: 'history', label: 'History' },
    { key: 'attachments', label: 'Attachments', count: ticket.attachments?.length ?? 0 },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* POC Upload Modal */}
      {showPocModal && (
        <PocUploadModal
          ticketId={ticket.id}
          onUploadAndSubmit={handlePocUploadAndSubmit}
          onSkip={handlePocSkip}
          onClose={() => setShowPocModal(false)}
          isUploading={pocUploading}
        />
      )}
      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <h3 className="font-bold text-slate-800 dark:text-white text-base">Edit Ticket</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Title</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm((f: any) => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Description</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((f: any) => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 resize-none"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Priority</label>
                  <select value={editForm.priority} onChange={(e) => setEditForm((f: any) => ({ ...f, priority: e.target.value }))} className="w-full px-2 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100">
                    {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Category</label>
                  <select value={editForm.category} onChange={(e) => setEditForm((f: any) => ({ ...f, category: e.target.value }))} className="w-full px-2 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100">
                    {['IT', 'FACILITIES', 'HR', 'OPERATIONS', 'PROJECT', 'ADMIN'].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Type</label>
                  <select value={editForm.type} onChange={(e) => setEditForm((f: any) => ({ ...f, type: e.target.value }))} className="w-full px-2 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100">
                    {['TASK', 'BUG', 'FEATURE', 'MAINTENANCE', 'SUPPORT', 'INCIDENT', 'REQUEST'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Due Date</label>
                  <input type="date" value={editForm.dueDate} onChange={(e) => setEditForm((f: any) => ({ ...f, dueDate: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1">Est. Hours</label>
                  <input type="number" min="0.5" step="0.5" value={editForm.estimatedTime} onChange={(e) => setEditForm((f: any) => ({ ...f, estimatedTime: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => editMutation.mutate({
                  ...editForm,
                  dueDate: editForm.dueDate ? new Date(editForm.dueDate).toISOString() : undefined,
                  estimatedTime: editForm.estimatedTime ? parseFloat(editForm.estimatedTime) : undefined,
                })}
                disabled={editMutation.isPending || !editForm.title?.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg text-sm disabled:opacity-50 transition-colors"
              >
                {editMutation.isPending ? 'Saving…' : 'Save Changes'}
              </button>
              <button onClick={() => setEditing(false)} className="flex-1 border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800 text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Breadcrumb */}
      <Breadcrumb items={[
        { label: 'Tickets', href: '/tickets' },
        { label: ticket.ticketId },
      ]} />
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/tickets" className="p-2 hover:bg-slate-100 dark:hover:bg-gray-800 rounded-lg transition-colors mt-0.5">
          <ArrowLeft size={18} className="text-slate-500 dark:text-gray-400" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <CopyableId ticketId={ticket.ticketId} />
            <span className={cn('text-xs px-2 py-0.5 rounded font-medium', CATEGORY_COLORS[ticket.category])}>
              {CATEGORY_LABELS[ticket.category] ?? ticket.category}
            </span>
            <span className={cn('text-xs px-2 py-0.5 rounded font-medium', PRIORITY_COLORS[ticket.priority])}>
              {PRIORITY_LABELS[ticket.priority] ?? ticket.priority}
            </span>
            <span className={cn('text-xs px-2.5 py-0.5 rounded-full font-medium', STATUS_COLORS[ticket.status])}>
              {STATUS_LABELS[ticket.status] ?? ticket.status}
            </span>
            {ticket.isOverdue && (
              <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                <AlertTriangle size={9} /> OVERDUE
              </span>
            )}
          </div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">{ticket.title}</h2>
          <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">
            Reported by {ticket.createdBy?.name} · {formatRelativeTime(ticket.createdAt)}
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => {
              setEditForm({
                title: ticket.title,
                description: ticket.description ?? '',
                priority: ticket.priority,
                category: ticket.category,
                type: ticket.type ?? 'TASK',
                dueDate: ticket.dueDate ? new Date(ticket.dueDate).toISOString().split('T')[0] : '',
                estimatedTime: ticket.estimatedTime ?? '',
              });
              setEditing(true);
            }}
            className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
            title="Edit ticket"
          >
            <Edit2 size={16} />
          </button>
        )}
        {canDelete && (
          <button
            onClick={() => { if (confirm('Delete this ticket? This cannot be undone.')) deleteTicket.mutate(); }}
            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete ticket"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Approvals Banner */}
      {canApprove && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-800 mb-3">
            This ticket is awaiting review — approve or send back
          </p>
          {rejectMode ? (
            <div className="space-y-2">
              <input
                type="text"
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                placeholder="Reason for rejection..."
                className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => rejectMutation.mutate()}
                  disabled={!rejectComment.trim() || rejectMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors"
                >
                  <XCircle size={14} /> Confirm Reject
                </button>
                <button
                  onClick={() => { setRejectMode(false); setRejectComment(''); }}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors"
              >
                <CheckCircle size={14} /> Approve
              </button>
              <button
                onClick={() => setRejectMode(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium rounded-lg border border-red-200 transition-colors"
              >
                <XCircle size={14} /> Reject
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Description */}
          {ticket.description && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-5">
              <h3 className="font-semibold text-slate-700 dark:text-gray-300 text-sm mb-3">Description</h3>
              <p className="text-sm text-slate-600 dark:text-gray-400 whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
            </div>
          )}

          {/* Tabs */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700">
            {/* Tab Header */}
            <div className="flex border-b border-slate-100 dark:border-gray-800 overflow-x-auto">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap',
                    activeTab === t.key
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200',
                  )}
                >
                  {t.key === 'history' && <History size={13} />}
                  {t.key === 'attachments' && <Paperclip size={13} />}
                  {t.label}
                  {typeof t.count === 'number' && (
                    <span className="text-xs bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 px-1.5 py-0.5 rounded-full">
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Comments Tab */}
            {activeTab === 'comments' && (
              <>
                <div className="divide-y divide-slate-50 dark:divide-gray-800">
                  {ticket.comments?.map((c: any) => (
                    <div key={c.id} className="px-5 py-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={cn(
                          'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
                          c.content?.startsWith('[REJECTED]') ? 'bg-red-500' : 'bg-blue-600',
                        )}>
                          <span className="text-white text-xs font-semibold">{getInitials(c.author?.name)}</span>
                        </div>
                        <span className="text-sm font-medium text-slate-800 dark:text-gray-200">{c.author?.name}</span>
                        <span className="text-xs text-slate-400 dark:text-gray-500 ml-auto">{formatRelativeTime(c.createdAt)}</span>
                      </div>
                      <p className={cn(
                        'text-sm ml-9',
                        c.content?.startsWith('[REJECTED]') ? 'text-red-600 font-medium' : 'text-slate-600 dark:text-gray-400',
                      )}>
                        {c.content}
                      </p>
                    </div>
                  ))}
                  {(!ticket.comments || ticket.comments.length === 0) && (
                    <div className="px-5 py-6 text-sm text-slate-400 dark:text-gray-500 text-center">No comments yet</div>
                  )}
                </div>
                {/* Add Comment */}
                <div className="px-5 py-4 border-t border-slate-100 dark:border-gray-800">
                  <div className="flex gap-3">
                    <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-semibold">{getInitials(user?.name || 'U')}</span>
                    </div>
                    <div className="flex-1 flex gap-2">
                      <input
                        type="text"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && submitComment()}
                        placeholder="Add a comment..."
                        className="flex-1 text-sm px-3 py-2 border border-slate-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500"
                      />
                      <button
                        onClick={submitComment}
                        disabled={!comment.trim() || addComment.isPending}
                        className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-40"
                      >
                        <Send size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
              <div className="divide-y divide-slate-50 dark:divide-gray-800">
                {!history ? (
                  <div className="px-5 py-6 text-sm text-slate-400 dark:text-gray-500 text-center">Loading...</div>
                ) : history.length === 0 ? (
                  <div className="px-5 py-6 text-sm text-slate-400 dark:text-gray-500 text-center">No changes recorded yet</div>
                ) : history.map((h: any) => (
                  <div key={h.id} className="px-5 py-3 flex items-start gap-3">
                    <div className="w-6 h-6 bg-slate-200 dark:bg-gray-700 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-slate-600 dark:text-gray-300 text-[10px] font-bold">{getInitials(h.changedBy?.name)}</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-slate-700 dark:text-gray-300">
                        <span className="font-medium">{h.changedBy?.name}</span>
                        {' changed '}
                        <span className="font-medium">{FIELD_LABELS[h.field] ?? h.field}</span>
                        {' from '}
                        <span className="text-slate-400 dark:text-gray-500 line-through">{humanValue(h.field, h.oldValue)}</span>
                        {' → '}
                        <span className="font-medium text-slate-800 dark:text-white">{humanValue(h.field, h.newValue)}</span>
                      </p>
                      <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{formatRelativeTime(h.changedAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Attachments Tab */}
            {activeTab === 'attachments' && (
              <div className="p-5 space-y-4">
                <div
                  className="border-2 border-dashed border-slate-200 dark:border-gray-700 rounded-xl p-6 text-center hover:border-blue-400 dark:hover:border-blue-500 transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (!file) return;
                    if (file.size > 5 * 1024 * 1024) { toast.error('File must be under 5 MB'); return; }
                    uploadMutation.mutate(file);
                  }}
                >
                  <Upload size={24} className="mx-auto text-slate-400 dark:text-gray-500 mb-2" />
                  <p className="text-sm text-slate-500 dark:text-gray-400 font-medium">
                    {uploadMutation.isPending ? 'Uploading...' : 'Drop a file or click to upload'}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">Max 5 MB · Images, PDFs, docs</p>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
                </div>

                {ticket.attachments?.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {ticket.attachments.map((att: any) => (
                      <AttachmentCard key={att.id} att={att} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 dark:text-gray-500 text-center">No attachments yet</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Status stepper */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-4">
            <h3 className="font-semibold text-slate-700 dark:text-gray-300 text-sm mb-3">Status</h3>
            {(() => {
              const steps = ['OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE'];
              const currentIdx = steps.indexOf(ticket.status);
              const isClosed = ticket.status === 'CLOSED';
              return (
                <div className="space-y-1.5">
                  {steps.map((s, i) => {
                    const isPast = i < currentIdx;
                    const isCurrent = i === currentIdx;
                    const isNext = i === currentIdx + 1;
                    const canClick = canEdit && !updateStatus.isPending && !pocUploading && (isNext || (isPast && !isClosed));
                    return (
                      <button
                        key={s}
                        onClick={() => canClick && handleStatusClick(s)}
                        disabled={!canClick}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2',
                          isCurrent
                            ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                            : isPast
                            ? 'bg-green-50 text-green-700 cursor-pointer hover:bg-green-100'
                            : isNext && canEdit
                            ? 'bg-slate-50 dark:bg-gray-800 text-slate-600 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-700 dark:hover:text-blue-400 cursor-pointer border border-dashed border-slate-200 dark:border-gray-700'
                            : 'bg-slate-50 dark:bg-gray-800 text-slate-300 dark:text-gray-600 cursor-not-allowed',
                        )}
                      >
                        <span className="flex-shrink-0">
                          {isPast ? '✓' : isCurrent ? '●' : '○'}
                        </span>
                        {STATUS_LABELS[s] ?? s}
                        {isNext && canEdit && !isClosed && (
                          <span className="ml-auto text-[10px] text-slate-400">→ advance</span>
                        )}
                      </button>
                    );
                  })}
                  {isClosed ? (
                    <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 text-xs font-medium flex items-center gap-2">
                      <span>✕</span> Closed
                    </div>
                  ) : canEdit && (
                    <button
                      onClick={() => updateStatus.mutate('CLOSED')}
                      disabled={updateStatus.isPending || pocUploading}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      Close ticket
                    </button>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Details */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-4 space-y-3">
            <h3 className="font-semibold text-slate-700 dark:text-gray-300 text-sm">Details</h3>

            {/* Assignee(s) */}
            <div>
              <p className="text-xs text-slate-400 dark:text-gray-500 mb-1.5 flex items-center gap-1">
                <Users size={11} /> Assignees
              </p>
              {canEdit ? (
                <select
                  value={ticket.assignedToId || ''}
                  onChange={(e) => assignMutation.mutate(e.target.value)}
                  className="w-full text-xs border border-slate-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100"
                >
                  <option value="">Unassigned</option>
                  {(Array.isArray(users) ? users : (users as any)?.users ?? []).map((u: any) => (
                    <option key={u.id} value={u.id}>{u.name} — {u.role?.name}</option>
                  ))}
                </select>
              ) : null}
              {/* Primary assignee */}
              <div className="flex flex-wrap gap-2 mt-2">
                {ticket.assignedTo ? (
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-[10px] font-bold">{getInitials(ticket.assignedTo.name)}</span>
                    </div>
                    <span className="text-xs text-slate-700 dark:text-gray-300">{ticket.assignedTo.name}</span>
                    <span className="text-[9px] text-slate-400 bg-slate-100 dark:bg-gray-800 px-1 py-0.5 rounded">Primary</span>
                  </div>
                ) : (
                  <span className="text-sm text-slate-400 dark:text-gray-500">Unassigned</span>
                )}
                {/* Additional assignees */}
                {(ticket.assignees ?? [])
                  .filter((a: any) => a.user?.id !== ticket.assignedToId)
                  .map((a: any) => (
                    <div key={a.id} className="flex items-center gap-1.5">
                      <div className="w-6 h-6 bg-indigo-500 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-[10px] font-bold">{getInitials(a.user?.name)}</span>
                      </div>
                      <span className="text-xs text-slate-700 dark:text-gray-300">{a.user?.name}</span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Reporter */}
            {ticket.createdBy && (
              <div>
                <p className="text-xs text-slate-400 dark:text-gray-500 mb-1.5 flex items-center gap-1"><User size={11} /> Reporter</p>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-slate-400 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-[10px] font-bold">{getInitials(ticket.createdBy.name)}</span>
                  </div>
                  <span className="text-sm text-slate-700 dark:text-gray-300">{ticket.createdBy.name}</span>
                </div>
              </div>
            )}

            <div className="space-y-2.5 pt-1 border-t border-slate-50 dark:border-gray-800">
              {ticket.department && (
                <div className="flex items-center gap-2">
                  <Building2 size={13} className="text-slate-400 dark:text-gray-500" />
                  <span className="text-xs text-slate-600 dark:text-gray-400">{ticket.department.name}</span>
                </div>
              )}
              {ticket.project && (
                <div className="flex items-center gap-2">
                  <Tag size={13} className="text-slate-400 dark:text-gray-500" />
                  <Link href={`/projects/${ticket.project.id}`} className="text-xs text-blue-600 hover:underline">
                    {ticket.project.projectId} — {ticket.project.name}
                  </Link>
                </div>
              )}
              {ticket.estimatedTime && (
                <div className="flex items-center gap-2">
                  <Clock size={13} className="text-slate-400 dark:text-gray-500" />
                  <span className="text-xs text-slate-600 dark:text-gray-400">Est. {ticket.estimatedTime}h</span>
                </div>
              )}
              {ticket.dueDate && (
                <div className="flex items-center gap-2">
                  <Calendar size={13} className={new Date(ticket.dueDate) < new Date() ? 'text-red-400' : 'text-slate-400 dark:text-gray-500'} />
                  <span className={cn('text-xs', new Date(ticket.dueDate) < new Date() ? 'text-red-500 font-medium' : 'text-slate-600 dark:text-gray-400')}>
                    Due {formatDate(ticket.dueDate)}
                  </span>
                </div>
              )}
              {ticket.scheduleRecurring && ticket.scheduleRecurring !== 'none' ? (
                <>
                  <div>
                    <span className="text-xs text-slate-500 dark:text-gray-400">Recurrence</span>
                    <p className="text-sm font-medium text-slate-800 dark:text-gray-200 mt-0.5">
                      🔁 {RECURRENCE_LABELS[ticket.scheduleRecurring] ?? ticket.scheduleRecurring}
                    </p>
                  </div>
                  {ticket.scheduleEndDate && (
                    <div>
                      <span className="text-xs text-slate-500 dark:text-gray-400">Until</span>
                      <p className="text-sm font-medium text-slate-800 dark:text-gray-200 mt-0.5">
                        {new Date(ticket.scheduleEndDate).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                </>
              ) : ticket.scheduledFor ? (
                <div>
                  <span className="text-xs text-slate-500 dark:text-gray-400">Scheduled</span>
                  <p className="text-sm font-medium text-slate-800 dark:text-gray-200 mt-0.5">
                    ⏰ {new Date(ticket.scheduledFor).toLocaleString()}
                  </p>
                </div>
              ) : null}
              {ticket.scheduledNote && (
                <div className="flex items-start gap-2">
                  <Clock size={13} className="text-slate-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
                  <span className="text-xs text-slate-500 dark:text-gray-400 italic">{ticket.scheduledNote}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Calendar size={13} className="text-slate-400 dark:text-gray-500" />
                <span className="text-xs text-slate-500 dark:text-gray-400">Created {formatDate(ticket.createdAt)}</span>
              </div>
              {ticket.updatedAt && ticket.updatedAt !== ticket.createdAt && (
                <div className="flex items-center gap-2">
                  <Calendar size={13} className="text-slate-400 dark:text-gray-500" />
                  <span className="text-xs text-slate-500 dark:text-gray-400">Updated {formatRelativeTime(ticket.updatedAt)}</span>
                </div>
              )}
              {!isDone && (
                <SlaTimer
                  createdAt={ticket.createdAt}
                  slaHours={ticket.slaHours}
                  slaPercent={ticket.slaPercent}
                  isOverdue={ticket.isOverdue}
                />
              )}
            </div>
          </div>

          {/* Type */}
          {ticket.type && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-4">
              <p className="text-xs text-slate-400 dark:text-gray-500 mb-1">Type</p>
              <span className="text-sm font-medium text-slate-700 dark:text-gray-300">{ticket.type}</span>
            </div>
          )}

          {/* Task Type */}
          {ticket.taskType && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-4">
              <p className="text-xs text-slate-500 dark:text-gray-400">Task Type</p>
              <p className="text-sm font-medium text-slate-800 dark:text-gray-200 mt-0.5">
                {ticket.taskType.name}
                {ticket.taskSubtype && (
                  <span className="text-slate-500 dark:text-gray-400"> / {ticket.taskSubtype.name}</span>
                )}
              </p>
            </div>
          )}

          {/* AI Suggestions */}
          <AiSuggestionsPanel ticketId={ticket.id} />
        </div>
      </div>
    </div>
  );
}
