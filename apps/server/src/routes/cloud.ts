import { hostname } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_CLOUD_URL } from '@flexpos/shared';
import type { AppContext } from '../context.js';
import { audit, requireAuth } from '../auth.js';
import { machineId } from '../services/license.js';
import type { CloudSync } from '../services/cloudSync.js';

export function cloudRoutes(app: FastifyInstance, ctx: AppContext, sync: CloudSync) {
  const auth = { preHandler: requireAuth(ctx, 'settings.manage') };

  app.get('/api/cloud/status', auth, async () => ({ ...(await sync.status()), defaultUrl: DEFAULT_CLOUD_URL }));

  app.post('/api/cloud/connect', { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z
      .object({
        mode: z.enum(['cloud', 'self']),
        url: z.string().max(300).optional(),
        email: z.string().email(),
        password: z.string().min(8),
        createAccount: z.object({ name: z.string().min(1).max(120) }).optional(),
        tenantId: z.string().optional(),
        deviceName: z.string().max(120).optional(),
      })
      .parse(req.body);
    const url = b.mode === 'cloud' ? DEFAULT_CLOUD_URL : (b.url ?? '');
    const r = await sync.connect({ mode: b.mode, url, email: b.email, password: b.password, createAccount: b.createAccount, tenantId: b.tenantId, deviceName: b.deviceName || hostname(), machineId: machineId() });
    await audit(ctx, ctx.db, req, 'cloud.connect', 'cloud', r.tenantId, { url, email: r.email, store: r.tenantName });
    void sync.syncNow().catch(() => undefined);
    return { ok: true, ...r };
  });

  app.post('/api/cloud/local', auth, async (req) => {
    await sync.setLocal();
    await audit(ctx, ctx.db, req, 'cloud.local', 'cloud', '', {});
    return { ok: true };
  });

  app.post('/api/cloud/sync-now', auth, async () => {
    try {
      await sync.syncNow();
    } catch {
      /* reported in status */
    }
    return sync.status();
  });
}
