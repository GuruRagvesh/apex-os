"use client";

// Sales CRM — Audit log store
// Ported from intern source (src/lib/audit-log.ts). Storage key renamed from
// the generic "crm_audit_logs" to a namespaced key so it can never collide
// with an unrelated Apex OS or browser-global key.

import { useSyncExternalStore } from "react";
import { AuditLogRecord } from "../../shared/types/audit";

const AUDIT_STORE_KEY = "salescrm_audit_logs";
const MAX_LOGS = 500;

let listeners: Array<() => void> = [];

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

let cachedSnapshot: AuditLogRecord[] | null = null;
let cachedRaw: string | null = null;

const SEED_LOG: AuditLogRecord = {
  id: `audit-seed-${Date.now()}`,
  timestamp: new Date().toISOString(),
  userId: "system",
  userName: "System",
  userRole: "SYSTEM",
  action: "settings_update",
  collection: "System",
  details: "Audit logging initialized.",
  metadata: { demo: true },
};

function readStorage(): AuditLogRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(AUDIT_STORE_KEY);
    if (raw === cachedRaw && cachedSnapshot) return cachedSnapshot;

    if (!raw) {
      const initial = [SEED_LOG];
      localStorage.setItem(AUDIT_STORE_KEY, JSON.stringify(initial));
      cachedRaw = JSON.stringify(initial);
      cachedSnapshot = initial;
      return cachedSnapshot;
    }

    cachedRaw = raw;
    cachedSnapshot = JSON.parse(raw) as AuditLogRecord[];
    return cachedSnapshot;
  } catch {
    cachedRaw = null;
    cachedSnapshot = [];
    return cachedSnapshot;
  }
}

function writeStorage(logs: AuditLogRecord[]) {
  // Enforce capacity limits
  const cappedLogs = logs.slice(0, MAX_LOGS);
  const json = JSON.stringify(cappedLogs);
  localStorage.setItem(AUDIT_STORE_KEY, json);
  cachedRaw = json;
  cachedSnapshot = cappedLogs;
  emitChange();
}

export function logAction(record: Omit<AuditLogRecord, "id" | "timestamp">) {
  if (typeof window === "undefined") return;

  const currentLogs = readStorage();
  const newLog: AuditLogRecord = {
    ...record,
    id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
  };

  // Prepend to keep newest first
  writeStorage([newLog, ...currentLogs]);
}

function getSnapshot(): AuditLogRecord[] {
  return readStorage();
}

function getServerSnapshot(): AuditLogRecord[] {
  return [];
}

export function useAuditLogs() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
