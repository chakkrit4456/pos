import type { FastifyInstance } from 'fastify';
import { editionAllows, t, type EditionFeature } from '@flexpos/shared';

/** API paths that belong to features this edition does not include. Reads answer empty, writes are refused. */
const GATED: { prefix: string; feature: EditionFeature; methods?: string[] }[] = [
  { prefix: '/api/modifier-groups', feature: 'modifiers' },
  { prefix: '/api/custom-fields', feature: 'customFields' },
  { prefix: '/api/promotions', feature: 'promotions' },
  { prefix: '/api/roles', feature: 'customRoles', methods: ['POST', 'PUT', 'PATCH', 'DELETE'] },
  { prefix: '/api/setup/client', feature: 'lanClient' },
  { prefix: '/api/setup/discover', feature: 'lanClient' },
];

export function editionGuard(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? req.url;
    const hit = GATED.find((g) => (path === g.prefix || path.startsWith(`${g.prefix}/`)) && (!g.methods || g.methods.includes(req.method)));
    if (!hit || editionAllows(hit.feature)) return;
    if (req.method === 'GET') return reply.send([]);
    return reply.code(404).send({ error: 'not_in_edition', message: t('ฟีเจอร์นี้ไม่มีใน FlexPOS Lite') });
  });
}
