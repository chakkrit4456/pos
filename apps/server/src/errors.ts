import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { t, translate } from '@flexpos/shared';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details);
export const notFound = (what = t('ข้อมูล')) => new AppError(404, 'not_found', t('ไม่พบ{0}', what));
export const forbidden = (msg = t('คุณไม่มีสิทธิ์ทำรายการนี้')) => new AppError(403, 'forbidden', msg);
export const conflict = (msg: string) => new AppError(409, 'conflict', msg);
export const unauthorized = (msg = t('กรุณาเข้าสู่ระบบอีกครั้ง')) => new AppError(401, 'unauthorized', msg);

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path = first?.path.join('.') ?? '';
    return reply.status(400).send({
      error: 'validation',
      message: first ? `${path ? path + ': ' : ''}${translate(first.message)}` : t('ข้อมูลไม่ถูกต้อง'),
      details: err.issues,
    });
  }
  if (err instanceof AppError) {
    return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details });
  }
  const fe = err as FastifyError;
  if (fe.statusCode === 429) {
    return reply.status(429).send({ error: 'rate_limited', message: t('ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่') });
  }
  if (fe.statusCode && fe.statusCode < 500) {
    return reply.status(fe.statusCode).send({ error: fe.code ?? 'error', message: fe.message });
  }
  req.log.error({ err }, 'unhandled error');
  return reply.status(500).send({ error: 'internal', message: t('เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่ หากยังไม่หายให้ติดต่อผู้ดูแล') });
}
