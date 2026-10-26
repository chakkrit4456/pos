import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { t } from '@flexpos/shared';
import type { CloudContext } from './context.js';
import type { DevicesTable, TenantsTable } from './schema.js';
import { forbidden, notFound, unauthorized } from './errors.js';

export type Role = 'manager' | 'viewer';

export interface CloudSession {
  id: string;
  email: string;
  name: string;
  isSuperadmin: boolean;
  memberships: Map<string, Role>;
}

declare module 'fastify' {
  interface FastifyRequest {
    cloudUser?: CloudSession;
    device?: DevicesTable & { schema_name: string };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; typ: 'access' };
    user: { sub: string; typ: 'access' };
  }
}

export const uuid = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hashPassword = (pw: string) => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);
export const newToken = () => randomBytes(32).toString('base64url');
/** Sign-in name: an email or a plain username (e.g. the same one used on the POS). */
export const normLogin = (e: string) => e.trim().toLowerCase();
export const loginSchema = z.string().trim().min(3).max(120).regex(/^[^\s]+$/, 'ชื่อผู้ใช้ต้องไม่มีช่องว่าง');

export async function loadSession(ctx: CloudContext, userId: string): Promise<CloudSession | null> {
  const u = await ctx.db.selectFrom('cloud_users').select(['id', 'email', 'name', 'is_superadmin', 'disabled']).where('id', '=', userId).executeTakeFirst();
  if (!u || u.disabled === 1) return null;
  const ms = await ctx.db.selectFrom('memberships').select(['tenant_id', 'role']).where('user_id', '=', userId).execute();
  return { id: u.id, email: u.email, name: u.name, isSuperadmin: u.is_superadmin === 1, memberships: new Map(ms.map((m) => [m.tenant_id, m.role as Role])) };
}

export async function issueTokens(ctx: CloudContext, reply: FastifyReply, userId: string) {
  const accessToken = await reply.jwtSign({ sub: userId, typ: 'access' }, { expiresIn: '2h' });
  const refreshToken = newToken();
  await ctx.db
    .insertInto('cloud_refresh_tokens')
    .values({ id: uuid(), user_id: userId, token_hash: sha256(refreshToken), expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(), created_at: nowIso(), revoked: 0 })
    .execute();
  await ctx.db.updateTable('cloud_users').set({ last_login_at: nowIso() }).where('id', '=', userId).execute();
  return { accessToken, refreshToken };
}

export async function rotateRefresh(ctx: CloudContext, token: string): Promise<string | null> {
  const row = await ctx.db.selectFrom('cloud_refresh_tokens').selectAll().where('token_hash', '=', sha256(token)).executeTakeFirst();
  if (!row || row.revoked === 1 || row.expires_at < nowIso()) return null;
  await ctx.db.updateTable('cloud_refresh_tokens').set({ revoked: 1 }).where('id', '=', row.id).execute();
  return row.user_id;
}

export async function revokeRefresh(ctx: CloudContext, token: string) {
  await ctx.db.updateTable('cloud_refresh_tokens').set({ revoked: 1 }).where('token_hash', '=', sha256(token)).execute();
}

/** preHandler: a signed-in, enabled web user. */
export function requireUser(ctx: CloudContext) {
  return async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthorized();
    }
    const s = await loadSession(ctx, req.user.sub);
    if (!s) throw unauthorized(t('บัญชีนี้ถูกปิดการใช้งาน'));
    req.cloudUser = s;
  };
}

export function requireSuperadmin(ctx: CloudContext) {
  const base = requireUser(ctx);
  return async (req: FastifyRequest) => {
    await base(req);
    if (!req.cloudUser?.isSuperadmin) throw forbidden();
  };
}

export function session(req: FastifyRequest): CloudSession {
  if (!req.cloudUser) throw unauthorized();
  return req.cloudUser;
}

/**
 * The only way store routes reach a tenant: checks membership (or superadmin) and role.
 * Suspended stores are visible to the superadmin only.
 */
export async function tenantFor(ctx: CloudContext, req: FastifyRequest, tenantId: string, need: Role = 'viewer'): Promise<TenantsTable & { role: Role | 'superadmin' }> {
  const s = session(req);
  const role = s.isSuperadmin ? 'superadmin' : s.memberships.get(tenantId);
  if (!role) throw notFound(t('ร้าน'));
  if (need === 'manager' && role === 'viewer') throw forbidden(t('ต้องเป็นผู้จัดการร้านจึงจะทำรายการนี้ได้'));
  const tenant = await ctx.db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
  if (!tenant) throw notFound(t('ร้าน'));
  if (tenant.status !== 'active' && role !== 'superadmin') throw forbidden(t('ร้านนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ให้บริการ'));
  return { ...tenant, role };
}

/** preHandler for POS machines: `Authorization: Bearer <device token>`. */
export function requireDevice(ctx: CloudContext) {
  return async (req: FastifyRequest) => {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) throw unauthorized(t('เครื่องนี้ยังไม่ได้เชื่อมต่อกับคลาวด์'));
    const d = await ctx.db
      .selectFrom('devices')
      .innerJoin('tenants', 'tenants.id', 'devices.tenant_id')
      .selectAll('devices')
      .select(['tenants.schema_name', 'tenants.status'])
      .where('devices.token_hash', '=', sha256(token))
      .executeTakeFirst();
    if (!d || d.revoked === 1) throw unauthorized(t('เครื่องนี้ถูกยกเลิกการเชื่อมต่อ กรุณาเชื่อมต่อใหม่'));
    if (d.status !== 'active') throw forbidden(t('ร้านนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ให้บริการ'));
    const { status: _s, ...device } = d;
    req.device = device;
  };
}

export async function audit(
  ctx: CloudContext,
  req: FastifyRequest | null,
  action: string,
  entity: string,
  entityId: string,
  detail: Record<string, unknown> = {},
  tenantId: string | null = null,
) {
  const u = req?.cloudUser;
  await ctx.db
    .insertInto('cloud_audit_logs')
    .values({ id: uuid(), user_id: u?.id ?? null, user_email: u?.email ?? (req?.device ? `device:${req.device.name}` : 'system'), tenant_id: tenantId, action, entity, entity_id: entityId, detail: JSON.stringify(detail), ip: req?.ip ?? '', created_at: nowIso() })
    .execute();
}
