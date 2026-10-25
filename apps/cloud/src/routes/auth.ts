import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { t } from '@flexpos/shared';
import type { CloudContext } from '../context.js';
import { audit, hashPassword, issueTokens, loadSession, normEmail, requireUser, revokeRefresh, rotateRefresh, session, verifyPassword } from '../auth.js';
import { badRequest, unauthorized } from '../errors.js';

export function authRoutes(app: FastifyInstance, ctx: CloudContext) {
  const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  const me = async (userId: string) => {
    const s = await loadSession(ctx, userId);
    if (!s) throw unauthorized(t('บัญชีนี้ถูกปิดการใช้งาน'));
    return { id: s.id, email: s.email, name: s.name, isSuperadmin: s.isSuperadmin };
  };

  app.post('/api/auth/login', limited, async (req, reply) => {
    const b = z.object({ email: z.string().min(3), password: z.string().min(1) }).parse(req.body);
    const u = await ctx.db.selectFrom('cloud_users').selectAll().where('email', '=', normEmail(b.email)).executeTakeFirst();
    if (!u || !(await verifyPassword(u.password_hash, b.password))) throw unauthorized(t('อีเมลหรือรหัสผ่านไม่ถูกต้อง'));
    if (u.disabled === 1) throw unauthorized(t('บัญชีนี้ถูกปิดการใช้งาน'));
    const tokens = await issueTokens(ctx, reply, u.id);
    req.cloudUser = { id: u.id, email: u.email, name: u.name, isSuperadmin: u.is_superadmin === 1, memberships: new Map() };
    await audit(ctx, req, 'auth.login', 'user', u.id);
    return { ...tokens, user: await me(u.id) };
  });

  app.post('/api/auth/refresh', limited, async (req, reply) => {
    const b = z.object({ refreshToken: z.string().min(10) }).parse(req.body);
    const userId = await rotateRefresh(ctx, b.refreshToken);
    if (!userId) throw unauthorized();
    const user = await me(userId);
    return { ...(await issueTokens(ctx, reply, userId)), user };
  });

  app.post('/api/auth/logout', async (req) => {
    const b = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    if (b.refreshToken) await revokeRefresh(ctx, b.refreshToken);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireUser(ctx) }, async (req) => me(session(req).id));

  app.put('/api/auth/password', { preHandler: requireUser(ctx), ...limited }, async (req) => {
    const b = z.object({ current: z.string().min(1), next: z.string().min(8) }).parse(req.body);
    const s = session(req);
    const u = await ctx.db.selectFrom('cloud_users').select('password_hash').where('id', '=', s.id).executeTakeFirstOrThrow();
    if (!(await verifyPassword(u.password_hash, b.current))) throw badRequest(t('รหัสผ่านปัจจุบันไม่ถูกต้อง'));
    await ctx.db.updateTable('cloud_users').set({ password_hash: await hashPassword(b.next) }).where('id', '=', s.id).execute();
    await ctx.db.updateTable('cloud_refresh_tokens').set({ revoked: 1 }).where('user_id', '=', s.id).execute();
    await audit(ctx, req, 'auth.password', 'user', s.id);
    return { ok: true };
  });
}
