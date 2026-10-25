/**
 * FlexPOS Cloud.
 *   node dist/main.js                       start the server
 *   node dist/main.js create-superadmin --email you@example.com --password '…' [--name 'Owner']
 *   node dist/main.js reset-password --email you@example.com --password '…'
 */
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildCloud } from './app.js';
import { CloudContext, configFromEnv } from './context.js';
import { hashPassword, normEmail, nowIso, uuid } from './auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const config = configFromEnv();
if (!config.webDir) {
  for (const d of [join(here, 'web'), join(here, '../../cloud-web/dist')]) if (existsSync(join(d, 'index.html'))) config.webDir = d;
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'create-superadmin' || cmd === 'reset-password') {
  const { values } = parseArgs({ args: rest, options: { email: { type: 'string' }, password: { type: 'string' }, name: { type: 'string' } } });
  if (!values.email || !values.password || values.password.length < 8) {
    console.error('usage: --email <email> --password <at least 8 characters> [--name <name>]');
    process.exit(2);
  }
  const ctx = await CloudContext.open(config);
  const email = normEmail(values.email);
  const existing = await ctx.db.selectFrom('cloud_users').select('id').where('email', '=', email).executeTakeFirst();
  const password_hash = await hashPassword(values.password);
  if (existing) {
    await ctx.db.updateTable('cloud_users').set({ password_hash, disabled: 0, ...(cmd === 'create-superadmin' ? { is_superadmin: 1 } : {}) }).where('id', '=', existing.id).execute();
    console.log(`updated ${email}`);
  } else if (cmd === 'create-superadmin') {
    await ctx.db.insertInto('cloud_users').values({ id: uuid(), email, name: values.name ?? 'Superadmin', password_hash, is_superadmin: 1, disabled: 0, created_at: nowIso(), last_login_at: null }).execute();
    console.log(`superadmin ${email} created`);
  } else {
    console.error(`no account ${email}`);
    process.exitCode = 1;
  }
  await ctx.close();
} else {
  const server = await buildCloud(config, { logger: true });
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await server.app.listen({ port: config.port, host: config.host });
  const admins = await server.ctx.db.selectFrom('cloud_users').select('id').where('is_superadmin', '=', 1).execute();
  if (!admins.length) console.warn('[flexpos-cloud] no superadmin yet: run `node dist/main.js create-superadmin --email … --password …`');
}
