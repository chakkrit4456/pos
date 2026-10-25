import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { t } from '@flexpos/shared';
import { CloudContext, ONLINE_MS, type CloudConfig, type CloudEvent } from './context.js';
import { loadSession } from './auth.js';
import { errorHandler } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { syncRoutes } from './routes/sync.js';
import { storeRoutes } from './routes/store.js';
import { adminRoutes } from './routes/admin.js';

export const VERSION = '1.0.0';

export interface CloudServer {
  app: FastifyInstance;
  ctx: CloudContext;
  close(): Promise<void>;
}

export async function buildCloud(config: CloudConfig, opts: { logger?: boolean; watchers?: boolean } = {}): Promise<CloudServer> {
  const ctx = await CloudContext.open(config);
  const app = Fastify({
    logger: opts.logger ? { level: 'info', file: config.logFile ?? undefined, redact: ['req.headers.authorization', 'req.body.password'] } : false,
    bodyLimit: 32 * 1024 * 1024,
    // Behind Cloudflare / nginx: trust the proxy for the client IP (CF-Connecting-IP wins below).
    trustProxy: true,
  });
  app.setErrorHandler(errorHandler);
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(rateLimit, { global: false, keyGenerator: (req) => (req.headers['cf-connecting-ip'] as string | undefined) ?? req.ip });
  await app.register(websocket);

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    return payload;
  });

  app.get('/api/health', async () => ({ ok: true, service: 'flexpos-cloud', version: VERSION }));

  authRoutes(app, ctx);
  syncRoutes(app, ctx);
  storeRoutes(app, ctx);
  adminRoutes(app, ctx);

  /**
   * Live updates for the web dashboard. Auth by access token in the query string; the client then
   * sends {"subscribe": "<tenantId>"} and only receives events for stores it may see.
   */
  app.get('/api/ws', { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token ?? '';
    let userId: string;
    try {
      userId = app.jwt.verify<{ sub: string }>(token).sub;
    } catch {
      socket.close(4401, 'unauthorized');
      return;
    }
    const s = await loadSession(ctx, userId);
    if (!s) {
      socket.close(4401, 'unauthorized');
      return;
    }
    const subs = new Set<string>();
    const onEvent = (e: CloudEvent) => {
      if ((subs.has(e.tenantId) || (s.isSuperadmin && subs.has('*'))) && socket.readyState === 1) socket.send(JSON.stringify(e));
    };
    ctx.bus.on('event', onEvent);
    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as { subscribe?: string; unsubscribe?: string };
        if (msg.subscribe && (s.isSuperadmin || s.memberships.has(msg.subscribe))) subs.add(msg.subscribe);
        if (msg.unsubscribe) subs.delete(msg.unsubscribe);
      } catch {
        /* ignore malformed */
      }
    });
    const ping = setInterval(() => socket.readyState === 1 && socket.ping(), 25_000);
    socket.on('close', () => {
      clearInterval(ping);
      ctx.bus.off('event', onEvent);
    });
  });

  // Online/offline transitions from device heartbeats.
  let watcher: NodeJS.Timeout | null = null;
  if (opts.watchers !== false) {
    const known = new Map<string, boolean>();
    watcher = setInterval(async () => {
      try {
        const rows = await ctx.db.selectFrom('tenants').select(['id', 'last_seen_at']).execute();
        for (const r of rows) {
          const online = !!r.last_seen_at && Date.now() - Date.parse(r.last_seen_at) < ONLINE_MS;
          if (known.has(r.id) && known.get(r.id) !== online) ctx.emit({ type: 'tenant.status', tenantId: r.id, online, lastSeenAt: r.last_seen_at });
          known.set(r.id, online);
        }
      } catch (e) {
        app.log.warn({ err: e }, 'status watcher failed');
      }
    }, 15_000);
  }

  const webDir = config.webDir && existsSync(join(config.webDir, 'index.html')) ? config.webDir : null;
  if (webDir) {
    await app.register(fastifyStatic, { root: webDir, prefix: '/', wildcard: false, maxAge: '1h' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'not_found', message: t('ไม่พบ API นี้') });
      return reply.type('text/html').header('cache-control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not_found', message: t('ไม่พบหน้านี้') }));
  }

  return {
    app,
    ctx,
    async close() {
      if (watcher) clearInterval(watcher);
      await app.close();
      await ctx.close();
    },
  };
}
