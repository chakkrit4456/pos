import { createHash, createHmac, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Permission, SessionUser } from '@flexpos/shared';
import type { AppContext, Tx } from './context.js';
import { forbidden, unauthorized } from './errors.js';
import { nowIso, parseJson, uuid } from './util.js';
import { t } from '@flexpos/shared';

declare module 'fastify' {
  interface FastifyRequest {
    sessionUser?: SessionUser;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; typ: 'access' };
    user: { sub: string; typ: 'access' };
  }
}

export const hashPassword = (pw: string) => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

/** PINs are short, so they are looked up by keyed HMAC (unique per user) and protected by rate limiting. */
export function pinHash(secret: string, pin: string): string {
  return createHmac('sha256', secret).update(`pin:${pin}`).digest('hex');
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const userCache = new Map<string, { user: SessionUser; at: number }>();
export const invalidateUserCache = () => userCache.clear();

export async function loadSessionUser(ctx: AppContext, userId: string): Promise<SessionUser | null> {
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.at < 15_000) return cached.user;
  const row = await ctx.db
    .selectFrom('users')
    .innerJoin('roles', 'roles.id', 'users.role_id')
    .select([
      'users.id',
      'users.name',
      'users.username',
      'users.role_id',
      'users.branch_id',
      'users.active',
      'roles.name as role_name',
      'roles.permissions',
    ])
    .where('users.id', '=', userId)
    .executeTakeFirst();
  if (!row || row.active !== 1) return null;
  const user: SessionUser = {
    id: row.id,
    name: row.name,
    username: row.username,
    roleId: row.role_id,
    roleName: row.role_name,
    permissions: parseJson<Permission[]>(row.permissions, []),
    branchId: row.branch_id,
  };
  userCache.set(userId, { user, at: Date.now() });
  return user;
}

export async function issueTokens(ctx: AppContext, reply: FastifyReply, userId: string) {
  const accessToken = await reply.jwtSign({ sub: userId, typ: 'access' }, { expiresIn: '2h' });
  const refreshToken = randomBytes(32).toString('base64url');
  await ctx.db
    .insertInto('refresh_tokens')
    .values({
      id: uuid(),
      user_id: userId,
      token_hash: sha256(refreshToken),
      expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
      created_at: nowIso(),
      revoked: 0,
    })
    .execute();
  await ctx.db.updateTable('users').set({ last_login_at: nowIso() }).where('id', '=', userId).execute();
  return { accessToken, refreshToken };
}

export async function rotateRefresh(ctx: AppContext, token: string): Promise<string | null> {
  const row = await ctx.db
    .selectFrom('refresh_tokens')
    .selectAll()
    .where('token_hash', '=', sha256(token))
    .executeTakeFirst();
  if (!row || row.revoked === 1 || row.expires_at < nowIso()) return null;
  await ctx.db.updateTable('refresh_tokens').set({ revoked: 1 }).where('id', '=', row.id).execute();
  return row.user_id;
}

export async function revokeRefresh(ctx: AppContext, token: string) {
  await ctx.db.updateTable('refresh_tokens').set({ revoked: 1 }).where('token_hash', '=', sha256(token)).execute();
}

/** preHandler factory: requires a valid access token and optional permission(s). */
export function requireAuth(ctx: AppContext, ...perms: Permission[]) {
  return async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthorized();
    }
    const user = await loadSessionUser(ctx, req.user.sub);
    if (!user) throw unauthorized(t('บัญชีนี้ถูกปิดการใช้งาน'));
    for (const p of perms) if (!user.permissions.includes(p)) throw forbidden();
    req.sessionUser = user;
  };
}

export function currentUser(req: FastifyRequest): SessionUser {
  if (!req.sessionUser) throw unauthorized();
  return req.sessionUser;
}

export function hasPerm(user: SessionUser, p: Permission) {
  return user.permissions.includes(p);
}

/**
 * Allow an action when the user has `perm`, or a manager authorises it with their PIN.
 * Returns the user who authorised (for audit).
 */
export async function authorizeWithPin(
  ctx: AppContext,
  user: SessionUser,
  perm: Permission,
  managerPin?: string,
): Promise<SessionUser> {
  if (hasPerm(user, perm)) return user;
  if (!managerPin) throw forbidden(t('ต้องใช้ PIN ผู้จัดการเพื่อทำรายการนี้'));
  const mgr = await ctx.db
    .selectFrom('users')
    .select('id')
    .where('pin_hash', '=', pinHash(ctx.config.secret, managerPin))
    .where('active', '=', 1)
    .executeTakeFirst();
  const m = mgr ? await loadSessionUser(ctx, mgr.id) : null;
  if (!m || !hasPerm(m, perm)) throw forbidden(t('PIN ผู้จัดการไม่ถูกต้อง หรือไม่มีสิทธิ์'));
  return m;
}

export function branchOf(ctx: AppContext, req: FastifyRequest): string {
  const user = currentUser(req);
  if (user.branchId) return user.branchId;
  const h = req.headers['x-branch-id'];
  if (typeof h === 'string' && h) return h;
  if (!ctx.defaultBranchId) throw unauthorized(t('ยังไม่มีสาขา'));
  return ctx.defaultBranchId;
}

export async function audit(
  ctx: AppContext,
  tx: Tx,
  req: FastifyRequest | null,
  action: string,
  entity: string,
  entityId: string,
  detail: Record<string, unknown> = {},
  by?: { id: string; name: string } | null,
) {
  const u = by ?? req?.sessionUser ?? null;
  await tx
    .insertInto('audit_logs')
    .values({
      id: uuid(),
      user_id: u?.id ?? null,
      user_name: u?.name ?? 'system',
      action,
      entity,
      entity_id: entityId,
      detail: JSON.stringify(detail),
      ip: req?.ip ?? '',
      created_at: nowIso(),
    })
    .execute();
}

export async function nextSeq(tx: Tx, key: string): Promise<number> {
  const res = await tx
    .updateTable('sequences')
    .set((eb) => ({ value: eb('value', '+', 1) }))
    .where('id', '=', key)
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) === 0) {
    await tx.insertInto('sequences').values({ id: key, value: 1 }).execute();
    return 1;
  }
  const row = await tx.selectFrom('sequences').select('value').where('id', '=', key).executeTakeFirstOrThrow();
  return Number(row.value);
}
