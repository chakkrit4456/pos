import { hostname } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_CLOUD_URL, t } from '@flexpos/shared';
import type { AppContext } from '../context.js';
import { audit, requireAuth } from '../auth.js';
import { badRequest } from '../errors.js';
import { machineId, type LicenseService } from '../services/license.js';
import type { CloudSync } from '../services/cloudSync.js';

/** FlexPOS Cloud address; FLEXPOS_CLOUD_URL points machines at a staging/test cloud. */
const vendorCloud = () => process.env.FLEXPOS_CLOUD_URL ?? DEFAULT_CLOUD_URL;

export function cloudRoutes(app: FastifyInstance, ctx: AppContext, sync: CloudSync, license: LicenseService) {
  const auth = { preHandler: requireAuth(ctx, 'settings.manage') };

  app.get('/api/cloud/status', auth, async () => {
    const lic = license.status();
    return { ...(await sync.status()), defaultUrl: vendorCloud(), license: { state: lic.state, licensee: lic.licensee, maxDevices: lic.maxDevices, hasKey: !!license.key() } };
  });

  app.post('/api/cloud/connect', { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z
      .object({
        mode: z.enum(['cloud', 'self']),
        url: z.string().max(300).optional(),
        /** FlexPOS Cloud: the key from the vendor (installed here too); empty = use the installed one */
        licenseKey: z.string().max(4000).optional(),
        /** own server: a manager account its superadmin created */
        username: z.string().max(120).optional(),
        password: z.string().max(200).optional(),
        tenantId: z.string().optional(),
        deviceName: z.string().max(120).optional(),
      })
      .parse(req.body);
    const deviceName = b.deviceName || hostname();
    let r: { tenantId: string; tenantName: string };
    if (b.mode === 'cloud') {
      if (b.licenseKey?.trim()) {
        try {
          license.activate(b.licenseKey);
        } catch (e) {
          throw badRequest((e as Error).message);
        }
      }
      const key = license.key();
      if (!key) throw badRequest(t('ใส่ License key ที่ได้รับจากผู้ให้บริการก่อนเชื่อมต่อ FlexPOS Cloud'));
      r = await sync.connect({ mode: 'cloud', url: vendorCloud(), licenseKey: key, deviceName, machineId: machineId() });
    } else {
      if (!b.url || !b.username || !b.password) throw badRequest(t('กรอกที่อยู่เซิร์ฟเวอร์ ชื่อผู้ใช้ และรหัสผ่านของผู้จัดการ'));
      r = await sync.connect({ mode: 'self', url: b.url, username: b.username, password: b.password, tenantId: b.tenantId, deviceName, machineId: machineId() });
    }
    await audit(ctx, ctx.db, req, 'cloud.connect', 'cloud', r.tenantId, { mode: b.mode, url: b.mode === 'self' ? b.url : vendorCloud(), store: r.tenantName });
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
