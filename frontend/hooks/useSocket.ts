import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL =
  (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/api\/?$/, '');

export interface SocketEvents {
  onTicketCreated?: (data: { ticket: any }) => void;
  onTicketStatusChanged?: (data: { ticketId: string; newStatus: string; updatedBy: string }) => void;
  onNotificationNew?: (data: { notification: any }) => void;
  onLeaveStatusChanged?: (data: { leaveId: string; status: string }) => void;
}

export function useSocket(events: SocketEvents = {}) {
  const socketRef = useRef<Socket | null>(null);
  // Keep a stable ref to the latest callbacks so we don't re-subscribe on every render
  const eventsRef = useRef<SocketEvents>(events);
  eventsRef.current = events;

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('nexus_token') : null;
    if (!token) return;

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    socket.on('ticket:created', (data) => eventsRef.current.onTicketCreated?.(data));
    socket.on('ticket:status_changed', (data) => eventsRef.current.onTicketStatusChanged?.(data));
    socket.on('notification:new', (data) => eventsRef.current.onNotificationNew?.(data));
    socket.on('leave:status_changed', (data) => eventsRef.current.onLeaveStatusChanged?.(data));

    socket.on('connect_error', (err) => {
      console.warn('[Socket] connection error:', err.message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []); // intentionally empty — token won't change without a page reload

  return socketRef.current;
}
