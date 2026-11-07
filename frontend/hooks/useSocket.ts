import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { onSocketReconnect } from '@apex/shared-auth';

const SOCKET_URL =
  (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/api\/?$/, '');

export interface SocketEvents {
  onTicketCreated?: (data: { ticket: any }) => void;
  onTicketStatusChanged?: (data: { ticketId: string; newStatus: string; updatedBy: string }) => void;
  onNotificationNew?: (data: { notification: any }) => void;
  onLeaveStatusChanged?: (data: { leaveId: string; status: string }) => void;
  onBreakWarningChanged?: (data: { breakLogId: string }) => void;
}

const SOCKET_EVENTS: Array<[string, keyof SocketEvents]> = [
  ['ticket:created', 'onTicketCreated'],
  ['ticket:status_changed', 'onTicketStatusChanged'],
  ['notification:new', 'onNotificationNew'],
  ['leave:status_changed', 'onLeaveStatusChanged'],
  ['break-warning:changed', 'onBreakWarningChanged'],
];

// One authenticated connection per tab, shared by every useSocket() caller.
// Each caller only adds its handlers; the connection closes with the last one.
let sharedSocket: Socket | null = null;
let reconnectClient: QueryClient | null = null;
const subscribers = new Set<{ current: SocketEvents }>();

function acquireSocket(token: string, queryClient: QueryClient): Socket {
  reconnectClient = queryClient;
  if (sharedSocket) return sharedSocket;

  const socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    // Keep trying with capped backoff. A cap of 5 attempts (~10 s) meant a
    // short backend restart ended live updates until the page was reloaded.
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000,
  });

  for (const [event, handler] of SOCKET_EVENTS) {
    socket.on(event, (data) => {
      subscribers.forEach((subscriber) => (subscriber.current[handler] as ((payload: any) => void) | undefined)?.(data));
    });
  }

  socket.on('connect_error', (err) => {
    console.debug('[Socket] connection error:', err.message);
  });

  // The backend is reachable again: retry, once, the reads on screen that had
  // failed (their polling is backed off).
  socket.io.on('reconnect', () => { if (reconnectClient) void onSocketReconnect(reconnectClient); });

  sharedSocket = socket;
  return socket;
}

export function useSocket(events: SocketEvents = {}) {
  const socketRef = useRef<Socket | null>(null);
  // Keep a stable ref to the latest callbacks so we don't re-subscribe on every render
  const eventsRef = useRef<SocketEvents>(events);
  eventsRef.current = events;
  const queryClient = useQueryClient();

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('apex_token') : null;
    if (!token) return;

    subscribers.add(eventsRef);
    socketRef.current = acquireSocket(token, queryClient);

    return () => {
      subscribers.delete(eventsRef);
      socketRef.current = null;
      if (subscribers.size === 0 && sharedSocket) {
        sharedSocket.disconnect();
        sharedSocket = null;
      }
    };
  }, [queryClient]); // the token won't change without a page reload

  return socketRef.current;
}
