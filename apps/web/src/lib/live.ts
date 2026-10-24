import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WsEvent } from '@flexpos/shared';
import { auth } from './api';

type Handler = (e: WsEvent) => void;
const handlers = new Set<Handler>();
let socket: WebSocket | null = null;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const statusListeners = new Set<(online: boolean) => void>();
let online = false;

function setOnline(v: boolean) {
  online = v;
  statusListeners.forEach((l) => l(v));
}

function connect() {
  if (socket || !auth.accessToken) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/api/ws?token=${encodeURIComponent(auth.accessToken)}`);
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    setOnline(true);
  };
  ws.onmessage = (m) => {
    try {
      const e = JSON.parse(String(m.data)) as WsEvent;
      handlers.forEach((h) => h(e));
    } catch {
      /* ignore */
    }
  };
  ws.onclose = () => {
    socket = null;
    setOnline(false);
    if (!auth.accessToken) return;
    retry = Math.min(retry + 1, 6);
    timer = setTimeout(connect, 500 * 2 ** retry);
  };
}

auth.onChange(() => {
  if (!auth.accessToken) {
    if (timer) clearTimeout(timer);
    socket?.close();
    socket = null;
  } else connect();
});

export function sendLive(e: WsEvent) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(e));
}

/** Subscribe to server events. */
export function useLive(handler: Handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    connect();
    const h: Handler = (e) => ref.current(e);
    handlers.add(h);
    return () => {
      handlers.delete(h);
    };
  }, []);
}

export function useLiveStatus() {
  const [v, setV] = useState(online);
  useEffect(() => {
    connect();
    statusListeners.add(setV);
    return () => {
      statusListeners.delete(setV);
    };
  }, []);
  return v;
}

/** Map server events to query invalidations app-wide. */
export function useLiveInvalidation() {
  const qc = useQueryClient();
  useLive((e) => {
    switch (e.type) {
      case 'catalog.changed':
        qc.invalidateQueries({ queryKey: ['catalog'] });
        break;
      case 'settings.changed':
        qc.invalidateQueries({ queryKey: ['settings'] });
        break;
      case 'orders.changed':
        qc.invalidateQueries({ queryKey: ['floor'] });
        qc.invalidateQueries({ queryKey: ['orders'] });
        qc.invalidateQueries({ queryKey: ['order', e.orderId] });
        break;
      case 'kitchen.changed':
        qc.invalidateQueries({ queryKey: ['kitchen'] });
        break;
      case 'printer.status':
        qc.invalidateQueries({ queryKey: ['printers'] });
        qc.invalidateQueries({ queryKey: ['print-queue'] });
        break;
      case 'notification':
        qc.invalidateQueries({ queryKey: ['notifications'] });
        break;
      case 'sale.completed':
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        qc.invalidateQueries({ queryKey: ['shift'] });
        break;
    }
  });
}
