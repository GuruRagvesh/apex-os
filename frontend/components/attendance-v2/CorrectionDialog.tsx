'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AttendanceDialog } from './AttendanceDialog';
import { DaySummary } from './DayDetailDrawer';
import { getMyAttendanceDayV2 } from './my-attendance-v2-api';
import { getMyRegularizations, stageLabel } from '../attendance/regularization-api';
import { RequestCorrectionForm } from '../attendance/RequestCorrectionForm';
export function CorrectionDialog({ date, onClose }: { date: string; onClose: () => void }) {
  const client = useQueryClient();
  const requests = useQuery({ queryKey: ['my-regularizations'], queryFn: getMyRegularizations, retry: false });
  const detail = useQuery({ queryKey: ['my-attendance-v2-day', date], queryFn: () => getMyAttendanceDayV2(date), retry: false });
  const pending = requests.data?.find(row => row.date.slice(0, 10) === date && (row.status === 'PENDING' || row.status === 'MANAGER_APPROVED'));
  return <AttendanceDialog title="Request a Correction" onClose={onClose}>
    <section aria-label="Correction form">
      {requests.isError ? <p role="alert">Correction requests unavailable. <button onClick={() => requests.refetch()}>Try again</button></p> : requests.isPending ? <p>Checking correction requests…</p> : pending ? <p role="status">Correction {stageLabel(pending.status).toLowerCase()}</p> :
        <RequestCorrectionForm allowScreenshots businessDate={date} onCancel={onClose} onDone={() => { client.invalidateQueries({ queryKey: ['my-attendance-v2'] }); client.invalidateQueries({ queryKey: ['my-attendance-v2-day', date] }); client.invalidateQueries({ queryKey: ['my-attendance-v2-year-records'] }); onClose(); }} />}
    </section>
    {detail.isError ? <p role="alert">Day Summary unavailable. <button onClick={() => detail.refetch()}>Try again</button></p> : detail.data ? <DaySummary day={detail.data} /> : <p>Loading Day Summary…</p>}
  </AttendanceDialog>;
}
