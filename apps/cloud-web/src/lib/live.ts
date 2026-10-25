import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { auth } from './api';

type CloudEvent =
  | { type: 'tenant.synced'; tenantId: string; at: string; tables: string[] }
  | { type: 'tenant.status'; tenantId: string; online: boolean; lastSeenAt: string | null }
  | { type: 'commands.changed'; tenantId: string };

/**
 * Live updates for one store ('*' = every store, superadmin). New POS data refreshes the open
 * pages; when the socket drops we reconnect with backoff and pages keep showing the last data.
 */
export function useLive(tenantId: string | null): { connected: boolean } {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!tenantId) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      if (stopped || !auth.accessToken) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/api/ws?token=${encodeURIComponent(auth.accessToken)}`);
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        ws?.send(JSON.stringify({ subscribe: tenantId }));
      };
      ws.onmessage = (m) => {
        try {
          const e = JSON.parse(String(m.data)) as CloudEvent;
          if (e.type === 'tenant.synced') {
            void qc.invalidateQueries({ queryKey: ['store', e.tenantId] });
            void qc.invalidateQueries({ queryKey: ['stores'] });
          } else if (e.type === 'tenant.status') {
            void qc.invalidateQueries({ queryKey: ['store', e.tenantId, 'info'] });
            void qc.invalidateQueries({ queryKey: ['stores'] });
          } else if (e.type === 'commands.changed') {
            void qc.invalidateQueries({ queryKey: ['store', e.tenantId, 'commands'] });
            void qc.invalidateQueries({ queryKey: ['store', e.tenantId, 'data'] });
          }
          if (tenantId === '*') void qc.invalidateQueries({ queryKey: ['admin'] });
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (stopped) return;
        timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
      };
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [tenantId, qc]);
  return { connected };
}
