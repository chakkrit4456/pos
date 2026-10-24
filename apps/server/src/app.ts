import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import type { WsEvent } from '@flexpos/shared';
import { AppContext } from './context.js';
import { errorHandler } from './errors.js';
import { loadSessionUser } from './auth.js';
import { LicenseService } from './services/license.js';
import { PrintService } from './services/printing.js';
import { BackupService } from './services/backup.js';
import { setupRoutes } from './routes/setup.js';
import { catalogRoutes } from './routes/catalog.js';
import { salesRoutes } from './routes/sales.js';
import { stockRoutes } from './routes/stock.js';
import { crmRoutes } from './routes/crm.js';
import { restaurantRoutes } from './routes/restaurant.js';
import { adminRoutes } from './routes/admin.js';
import { reportRoutes } from './routes/reports.js';

export interface ServerOptions {
  dataDir: string;
  webDir?: string | null;
  fontsDir?: string;
  logger?: boolean;
  /** start background workers (print queue, backups). Tests turn this off. */
  workers?: boolean;
}

export interface FlexServer {
  app: FastifyInstance;
  ctx: AppContext;
  license: LicenseService;
  printer: PrintService;
  backup: BackupService;
  close(): Promise<void>;
}

export async function buildServer(opts: ServerOptions): Promise<FlexServer> {
  const ctx = new AppContext({ dataDir: opts.dataDir, webDir: opts.webDir });
  if (ctx.config.db) {
    try {
      await ctx.openDb();
    } catch (e) {
      console.error('[flexpos] cannot open database; setup wizard will be shown', e);
      ctx.conn = null;
    }
  }
  const license = new LicenseService(opts.dataDir);
  const printer = new PrintService(ctx, opts.fontsDir);
  const backup = new BackupService(ctx);

  const app = Fastify({
    logger: opts.logger
      ? { level: 'info', redact: ['req.headers.authorization', 'req.body.password', 'req.body.pin', 'req.body.managerPin'] }
      : false,
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: true,
  });
  app.setErrorHandler(errorHandler);
  await app.register(cors, { origin: process.env.NODE_ENV === 'development' ? true : false });
  await app.register(jwt, { secret: ctx.config.secret });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
  await app.register(websocket);

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    return payload;
  });

  app.get('/api/health', async () => ({ ok: true, db: !!ctx.conn }));

  setupRoutes(app, ctx, license);
  catalogRoutes(app, ctx);
  salesRoutes(app, ctx, license, printer);
  stockRoutes(app, ctx);
  crmRoutes(app, ctx);
  restaurantRoutes(app, ctx, printer);
  adminRoutes(app, ctx, printer, backup, license);
  reportRoutes(app, ctx);

  /** Live events. Auth by access token in the query string (browsers cannot set WS headers). */
  app.get('/api/ws', { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token ?? '';
    let userId: string | null = null;
    try {
      userId = (app.jwt.verify<{ sub: string }>(token)).sub;
    } catch {
      socket.close(4401, 'unauthorized');
      return;
    }
    const user = ctx.conn ? await loadSessionUser(ctx, userId) : null;
    if (!user) {
      socket.close(4401, 'unauthorized');
      return;
    }
    const onEvent = (e: WsEvent) => {
      if (e.type === 'notification' && e.userId && e.userId !== user.id) return;
      if (socket.readyState === 1) socket.send(JSON.stringify(e));
    };
    ctx.bus.on('ws', onEvent);
    socket.on('message', (raw: Buffer) => {
      // Registers push customer-display updates through the server to the display screen.
      try {
        const msg = JSON.parse(raw.toString()) as WsEvent;
        if (msg.type === 'display.update') ctx.emit(msg);
      } catch {
        /* ignore malformed */
      }
    });
    const ping = setInterval(() => socket.readyState === 1 && socket.ping(), 25_000);
    socket.on('close', () => {
      clearInterval(ping);
      ctx.bus.off('ws', onEvent);
    });
  });

  const webDir = opts.webDir && existsSync(join(opts.webDir, 'index.html')) ? opts.webDir : null;
  if (webDir) {
    await app.register(fastifyStatic, { root: webDir, prefix: '/', wildcard: false, maxAge: '1h' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'not_found', message: 'ไม่พบ API นี้' });
      return reply.type('text/html').header('cache-control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not_found', message: 'ไม่พบหน้านี้' }));
  }

  if (opts.workers !== false) {
    printer.start();
    backup.start();
  }

  return {
    app,
    ctx,
    license,
    printer,
    backup,
    async close() {
      printer.stop();
      backup.stop();
      await app.close();
      await ctx.close();
    },
  };
}

/** Advertise this host on the LAN so tablets/terminals can find it in the setup wizard. */
export async function advertise(port: number, name: string) {
  try {
    const { Bonjour } = await import('bonjour-service');
    const b = new Bonjour();
    b.publish({ name: `FlexPOS ${name}`.slice(0, 60), type: 'flexpos', port });
    return () => b.unpublishAll(() => b.destroy());
  } catch (e) {
    console.warn('[flexpos] mDNS advertise failed', e);
    return () => undefined;
  }
}
