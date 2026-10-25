import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_ROLES,
  DEFAULT_SETTINGS,
  dbConfigSchema,
  loginSchema,
  mergeSettings,
  pinLoginSchema,
  setupCompleteSchema,
  templateSettings,
  type AuthResponse,
  type SetupStatus,
} from '@flexpos/shared';
import { testConnection } from '@flexpos/db';
import type { AppContext } from '../context.js';
import { VERSION } from '../context.js';
import { encryptSecret, type StoredDbConfig } from '../config.js';
import {
  audit,
  hashPassword,
  issueTokens,
  loadSessionUser,
  pinHash,
  requireAuth,
  revokeRefresh,
  rotateRefresh,
  verifyPassword,
} from '../auth.js';
import { badRequest, conflict, unauthorized } from '../errors.js';
import { nowIso, uuid } from '../util.js';
import { seedSampleData } from '../services/seed.js';
import type { LicenseService } from '../services/license.js';

async function hasOwner(ctx: AppContext): Promise<boolean> {
  if (!ctx.conn) return false;
  const u = await ctx.db.selectFrom('users').select('id').limit(1).executeTakeFirst();
  return !!u;
}

function dbErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/ECONNREFUSED/.test(msg)) return 'เชื่อมต่อไม่ได้: เซิร์ฟเวอร์ฐานข้อมูลไม่ตอบรับ ตรวจสอบ host/port และว่าฐานข้อมูลเปิดอยู่';
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'ไม่พบ host นี้ ตรวจสอบชื่อเครื่องหรือ IP';
  if (/password authentication failed|Access denied/i.test(msg)) return 'ชื่อผู้ใช้หรือรหัสผ่านฐานข้อมูลไม่ถูกต้อง';
  if (/does not exist|Unknown database/i.test(msg)) return 'ไม่พบฐานข้อมูลชื่อนี้ กรุณาสร้างฐานข้อมูลว่างก่อน';
  if (/timeout/i.test(msg)) return 'หมดเวลาเชื่อมต่อ ตรวจสอบเครือข่ายหรือไฟร์วอลล์';
  return `เชื่อมต่อไม่สำเร็จ: ${msg}`;
}

export function setupRoutes(app: FastifyInstance, ctx: AppContext, license: LicenseService) {
  const loginLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.get('/api/setup/status', async (): Promise<SetupStatus> => ({
    configured: !!ctx.conn,
    dbKind: ctx.config.db?.kind ?? null,
    hasOwner: await hasOwner(ctx),
    mode: ctx.config.mode,
    hostUrl: ctx.config.hostUrl,
    version: VERSION,
    license: license.status(),
    brand: {
      appName: ctx.settings.brand.appName || 'FlexPOS',
      appLogo: ctx.settings.brand.appLogo || ctx.settings.store.logo,
      primary: ctx.settings.brand.primary,
      accent: ctx.settings.brand.accent,
      sidebar: ctx.settings.brand.sidebar,
      loginTitle: ctx.settings.brand.loginTitle,
      loginSubtitle: ctx.settings.brand.loginSubtitle,
      storeName: ctx.settings.store.name,
    },
  }));

  /** Setup endpoints are open only until an owner exists; afterwards they require settings permission. */
  const guardSetup = async (req: Parameters<ReturnType<typeof requireAuth>>[0]) => {
    if (await hasOwner(ctx)) await requireAuth(ctx, 'settings.manage')(req);
  };

  app.post('/api/setup/test-db', { preHandler: guardSetup }, async (req) => {
    const cfg = dbConfigSchema.parse(req.body);
    if (cfg.kind === 'sqlite') return { ok: true, version: 'SQLite (ในเครื่อง)' };
    try {
      return await testConnection(cfg);
    } catch (e) {
      throw badRequest(dbErrorMessage(e));
    }
  });

  app.post('/api/setup/db', { preHandler: guardSetup }, async (req) => {
    const cfg = dbConfigSchema.parse(req.body);
    const stored: StoredDbConfig =
      cfg.kind === 'sqlite'
        ? { kind: 'sqlite', file: cfg.file || ctx.store.defaultSqliteFile() }
        : {
            kind: cfg.kind,
            host: cfg.host,
            port: cfg.port,
            user: cfg.user,
            passwordEnc: encryptSecret(cfg.password),
            database: cfg.database,
            ssl: cfg.ssl,
          };
    try {
      await ctx.openDb(stored);
    } catch (e) {
      throw badRequest(dbErrorMessage(e));
    }
    ctx.config = { ...ctx.config, db: stored, mode: 'host', hostUrl: null };
    ctx.store.save(ctx.config);
    return { ok: true, hasOwner: await hasOwner(ctx) };
  });

  app.post('/api/setup/client', { preHandler: guardSetup }, async (req) => {
    const { hostUrl } = z.object({ hostUrl: z.string().url() }).parse(req.body);
    const res = await fetch(new URL('/api/setup/status', hostUrl)).catch(() => null);
    if (!res || !res.ok) throw badRequest('ติดต่อเครื่อง Host ไม่ได้ ตรวจสอบว่าเครื่อง Host เปิดอยู่และอยู่ในวง LAN เดียวกัน');
    ctx.config = { ...ctx.config, mode: 'client', hostUrl: hostUrl.replace(/\/$/, '') };
    ctx.store.save(ctx.config);
    return { ok: true, hostUrl: ctx.config.hostUrl };
  });

  app.get('/api/setup/discover', async () => {
    const { Bonjour } = await import('bonjour-service');
    const b = new Bonjour();
    const found: { name: string; url: string }[] = [];
    await new Promise<void>((resolve) => {
      const browser = b.find({ type: 'flexpos' }, (s) => {
        const addr = s.addresses?.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? s.host;
        found.push({ name: s.name, url: `http://${addr}:${s.port}` });
      });
      setTimeout(() => {
        browser.stop();
        b.destroy();
        resolve();
      }, 2500);
    });
    return { hosts: found };
  });

  app.post('/api/setup/complete', async (req, reply): Promise<AuthResponse> => {
    if (!ctx.conn) throw badRequest('กรุณาเลือกฐานข้อมูลก่อน');
    if (await hasOwner(ctx)) throw conflict('ร้านนี้ตั้งค่าเรียบร้อยแล้ว');
    const input = setupCompleteSchema.parse(req.body);
    const ownerId = uuid();
    const branchId = uuid();
    const now = nowIso();
    const settings = mergeSettings(
      mergeSettings(DEFAULT_SETTINGS, templateSettings(input.businessType)),
      {
        store: {
          name: input.store.name,
          address: input.store.address,
          taxId: input.store.taxId,
          phone: input.store.phone,
          logo: input.store.logo,
          promptPayId: input.store.promptPayId,
        },
        tax: { ...input.tax },
        locale: { language: input.language },
      },
    );
    const pwHash = await hashPassword(input.owner.password);
    await ctx.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('branches')
        .values({
          id: branchId,
          code: '01',
          name: input.store.branchName || 'สำนักงานใหญ่',
          address: input.store.address,
          phone: input.store.phone,
          tax_branch_no: '00000',
          active: 1,
          created_at: now,
        })
        .execute();
      const roleIds: Record<string, string> = {};
      for (const r of DEFAULT_ROLES) {
        roleIds[r.code] = uuid();
        await tx
          .insertInto('roles')
          .values({ id: roleIds[r.code]!, code: r.code, name: r.name, permissions: JSON.stringify(r.permissions), system: r.code === 'owner' ? 1 : 0 })
          .execute();
      }
      await tx
        .insertInto('users')
        .values({
          id: ownerId,
          username: input.owner.username.toLowerCase(),
          name: input.owner.name,
          password_hash: pwHash,
          pin_hash: pinHash(ctx.config.secret, input.owner.pin),
          role_id: roleIds.owner!,
          branch_id: null,
          active: 1,
          created_at: now,
          last_login_at: null,
        })
        .execute();
      for (const m of DEFAULT_PAYMENT_METHODS) {
        await tx
          .insertInto('payment_methods')
          .values({ id: uuid(), code: m.code, name: m.name, kind: m.kind, active: m.code === 'credit' ? 0 : 1, sort: m.sort })
          .execute();
      }
      await tx.insertInto('price_tiers').values([
        { id: uuid(), name: 'ราคาส่ง' },
        { id: uuid(), name: 'ราคาสมาชิก' },
      ]).execute();
      await ctx.saveSettings(settings, tx);
      if (input.sampleData) await seedSampleData(tx, input.businessType, branchId, ownerId);
      await audit(ctx, tx, req, 'setup.complete', 'store', branchId, { businessType: input.businessType }, { id: ownerId, name: input.owner.name });
    });
    ctx.defaultBranchId = branchId;
    const tokens = await issueTokens(ctx, reply, ownerId);
    const user = await loadSessionUser(ctx, ownerId);
    return { ...tokens, user: user! };
  });

  /* ---------- Auth ---------- */

  app.post('/api/auth/login', loginLimit, async (req, reply): Promise<AuthResponse> => {
    const { username, password } = loginSchema.parse(req.body);
    const u = await ctx.db.selectFrom('users').select(['id', 'password_hash', 'active']).where('username', '=', username.toLowerCase()).executeTakeFirst();
    // Verify even when the user is missing to keep timing similar.
    const ok = await verifyPassword(u?.password_hash ?? '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$0000000000000000000000000000000000000000000', password);
    if (!u || !ok) throw unauthorized('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    if (u.active !== 1) throw unauthorized('บัญชีนี้ถูกปิดการใช้งาน');
    const tokens = await issueTokens(ctx, reply, u.id);
    const user = await loadSessionUser(ctx, u.id);
    await audit(ctx, ctx.db, req, 'auth.login', 'user', u.id, {}, user);
    return { ...tokens, user: user! };
  });

  app.post('/api/auth/pin', loginLimit, async (req, reply): Promise<AuthResponse> => {
    const { pin } = pinLoginSchema.parse(req.body);
    const u = await ctx.db
      .selectFrom('users')
      .select('id')
      .where('pin_hash', '=', pinHash(ctx.config.secret, pin))
      .where('active', '=', 1)
      .executeTakeFirst();
    if (!u) throw unauthorized('PIN ไม่ถูกต้อง');
    const tokens = await issueTokens(ctx, reply, u.id);
    const user = await loadSessionUser(ctx, u.id);
    return { ...tokens, user: user! };
  });

  app.post('/api/auth/refresh', loginLimit, async (req, reply): Promise<AuthResponse> => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(10) }).parse(req.body);
    const userId = await rotateRefresh(ctx, refreshToken);
    if (!userId) throw unauthorized();
    const user = await loadSessionUser(ctx, userId);
    if (!user) throw unauthorized('บัญชีนี้ถูกปิดการใช้งาน');
    const tokens = await issueTokens(ctx, reply, userId);
    return { ...tokens, user };
  });

  app.post('/api/auth/logout', async (req) => {
    const body = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    if (body.refreshToken) await revokeRefresh(ctx, body.refreshToken);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth(ctx) }, async (req) => req.sessionUser);

  /** Verify a manager PIN for an action without logging in as them (used by POS dialogs). */
  app.post('/api/auth/verify-pin', { ...loginLimit, preHandler: requireAuth(ctx) }, async (req) => {
    const { pin } = pinLoginSchema.parse(req.body);
    const u = await ctx.db.selectFrom('users').select('id').where('pin_hash', '=', pinHash(ctx.config.secret, pin)).where('active', '=', 1).executeTakeFirst();
    if (!u) throw unauthorized('PIN ไม่ถูกต้อง');
    const user = await loadSessionUser(ctx, u.id);
    return { id: user!.id, name: user!.name, permissions: user!.permissions };
  });

  /** Staff list for the PIN lock screen (names only). */
  app.get('/api/auth/staff', async () => {
    if (!ctx.conn) return [];
    return ctx.db.selectFrom('users').select(['id', 'name']).where('active', '=', 1).orderBy('name').execute();
  });

  app.post('/api/license/activate', { preHandler: requireAuth(ctx, 'settings.manage') }, async (req) => {
    const { key } = z.object({ key: z.string().min(20) }).parse(req.body);
    try {
      const s = license.activate(key);
      await audit(ctx, ctx.db, req, 'license.activate', 'license', s.machineId, { plan: s.plan });
      return s;
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'License key ไม่ถูกต้อง');
    }
  });
}
