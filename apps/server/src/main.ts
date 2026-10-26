import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';
import { IS_LITE } from '@flexpos/shared';
import { advertise, buildServer } from './app.js';

export async function startServer(opts: { port?: number; host?: string; dataDir?: string; webDir?: string | null; fontsDir?: string; logger?: boolean } = {}) {
  const here = dirname(fileURLToPath(import.meta.url));
  const port = opts.port ?? Number(process.env.PORT ?? 4100);
  // Lite is licensed for one machine: only this computer may reach the server.
  const host = IS_LITE ? '127.0.0.1' : (opts.host ?? process.env.HOST ?? '0.0.0.0');
  const dataDir = opts.dataDir ?? process.env.FLEXPOS_DATA_DIR ?? resolve(process.cwd(), 'data');
  const webDir = opts.webDir !== undefined ? opts.webDir : (process.env.FLEXPOS_WEB_DIR ?? join(here, '..', '..', 'web', 'dist'));
  const server = await buildServer({ dataDir: resolve(dataDir), webDir: webDir ? resolve(webDir) : null, fontsDir: opts.fontsDir ?? process.env.FLEXPOS_FONTS_DIR, logger: opts.logger ?? process.env.NODE_ENV !== 'test' });
  await server.app.listen({ port, host });
  const stopAdvertise = IS_LITE ? () => undefined : await advertise(port, server.ctx.settings.store.name || hostname());
  return {
    ...server,
    port,
    async close() {
      stopAdvertise();
      await server.close();
    },
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer()
    .then((s) => {
      console.log(`FlexPOS server running on http://localhost:${s.port}`);
      const stop = async () => {
        await s.close();
        process.exit(0);
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
