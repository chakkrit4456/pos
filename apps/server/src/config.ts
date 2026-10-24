import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import type { ConnectionConfig } from '@flexpos/db';

export interface StoredDbConfig {
  kind: 'sqlite' | 'postgres' | 'mysql';
  file?: string;
  host?: string;
  port?: number;
  user?: string;
  /** AES-256-GCM encrypted, base64 iv.tag.data */
  passwordEnc?: string;
  database?: string;
  ssl?: boolean;
}

export interface AppConfig {
  version: 1;
  mode: 'host' | 'client';
  hostUrl: string | null;
  db: StoredDbConfig | null;
  /** random secret for JWT and PIN hashing */
  secret: string;
  installId: string;
}

export function machineKey(): Buffer {
  // Derived from stable machine attributes so the config file is useless on another machine.
  let user = 'user';
  try {
    user = userInfo().username;
  } catch {
    /* some sandboxes have no user info */
  }
  return createHash('sha256').update(`flexpos|${hostname()}|${user}|v1`).digest();
}

export function encryptSecret(plain: string, key = machineKey()): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(enc: string, key = machineKey()): string {
  const [iv, tag, data] = enc.split('.').map((s) => Buffer.from(s, 'base64'));
  if (!iv || !tag || !data) throw new Error('Corrupt secret');
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

export class ConfigStore {
  readonly file: string;
  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'config.json');
  }

  load(): AppConfig {
    if (existsSync(this.file)) {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as AppConfig;
      return raw;
    }
    const cfg: AppConfig = {
      version: 1,
      mode: 'host',
      hostUrl: null,
      db: null,
      secret: randomBytes(32).toString('hex'),
      installId: randomBytes(8).toString('hex'),
    };
    this.save(cfg);
    return cfg;
  }

  save(cfg: AppConfig): void {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  defaultSqliteFile(): string {
    return join(this.dataDir, 'flexpos.db');
  }

  toConnection(db: StoredDbConfig): ConnectionConfig {
    if (db.kind === 'sqlite') return { kind: 'sqlite', file: db.file ?? this.defaultSqliteFile() };
    return {
      kind: db.kind,
      host: db.host ?? 'localhost',
      port: db.port ?? (db.kind === 'postgres' ? 5432 : 3306),
      user: db.user ?? '',
      password: db.passwordEnc ? decryptSecret(db.passwordEnc) : '',
      database: db.database ?? 'flexpos',
      ssl: !!db.ssl,
    };
  }
}

/** Env override for servers/Docker: FLEXPOS_DB_URL=postgres://user:pass@host:5432/db or mysql://... */
export function dbFromEnv(): StoredDbConfig | null {
  const url = process.env.FLEXPOS_DB_URL;
  if (!url) return null;
  if (url.startsWith('sqlite:')) return { kind: 'sqlite', file: url.slice('sqlite:'.length) };
  const u = new URL(url);
  const kind = u.protocol.startsWith('postgres') ? 'postgres' : u.protocol.startsWith('mysql') ? 'mysql' : null;
  if (!kind) throw new Error(`Unsupported FLEXPOS_DB_URL protocol ${u.protocol}`);
  return {
    kind,
    host: u.hostname,
    port: Number(u.port) || (kind === 'postgres' ? 5432 : 3306),
    user: decodeURIComponent(u.username),
    passwordEnc: encryptSecret(decodeURIComponent(u.password)),
    database: u.pathname.replace(/^\//, ''),
    ssl: u.searchParams.get('ssl') === 'true',
  };
}
