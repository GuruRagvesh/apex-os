import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { randomUUID } from 'crypto';

// Every request gets an id, returned as the X-Request-Id response header. A
// 500 used to reach the Render log as an unlabelled stack trace, so a failing
// request seen in the browser could not be matched to its cause. Now each 5xx
// is logged once with its id, method, path, query-parameter NAMES, user id and
// a sanitized error, and the id is in the JSON body the browser receives.
//
// What a log line never carries: query values (searches, names, emails), the
// request body, the raw Prisma message (it quotes the query's arguments),
// newlines or other control characters, or anything unbounded.

export const REQUEST_ID_HEADER = 'X-Request-Id';

// An id from a proxy is reused only if it is short and plain, so it cannot
// inject text into a log line.
const SAFE_INCOMING_ID = /^[A-Za-z0-9._-]{8,64}$/;
const MAX_PATH = 200;
const MAX_QUERY_KEYS = 20;
const MAX_ERROR_TEXT = 300;
const MAX_STACK_FRAMES = 10;
// Prisma meta fields that hold schema names only, never row data.
const SAFE_META_KEYS = ['code', 'column', 'field_name', 'modelName', 'table', 'target', 'constraint'];

export function resolveRequestId(incoming: unknown): string {
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  return typeof value === 'string' && SAFE_INCOMING_ID.test(value) ? value : randomUUID();
}

/** Express middleware: assigns req.requestId and sets the response header. */
export function requestIdMiddleware(req: any, res: any, next: () => void): void {
  const id = resolveRequestId(req.headers?.['x-request-id']);
  req.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

/** Printable ASCII only (no newline or other control character), whitespace collapsed, length capped. */
function printable(text: string, max: number): string {
  const clean = text.replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

/**
 * The request URL for a log line: the path, left percent-encoded (so %0A stays
 * three characters), plus the NAMES of its query parameters. Values are never
 * logged:  /api/tickets?status=IN_PROGRESS&search=alice  ->  /api/tickets?{status,search}
 */
export function logUrl(url: string): string {
  const q = url.indexOf('?');
  const path = printable(q < 0 ? url : url.slice(0, q), MAX_PATH).replace(/\s/g, '');
  if (q < 0) return path;
  const keys = new Set<string>();
  for (const pair of url.slice(q + 1).split('&')) {
    if (keys.size >= MAX_QUERY_KEYS) break;
    const key = pair.split('=')[0].replace(/[^A-Za-z0-9_.[\]-]/g, '').slice(0, 40);
    if (key) keys.add(key);
  }
  return keys.size ? `${path}?{${[...keys].join(',')}}` : path;
}

/**
 * Removes anything in an error's text that could be a value: quoted strings,
 * email addresses and long numbers. `Backtick` names are kept: Prisma uses
 * them for tables, columns and arguments, which name the schema, not data.
 */
export function redactValues(text: string): string {
  return text
    .replace(/"(?:[^"\\]|\\.)*"/g, '"[value]"')
    .replace(/'(?:[^'\\]|\\.)*'/g, "'[value]'")
    .replace(/[^\s@`"']+@[^\s@`"']+/g, '[email]')
    .replace(/\d{6,}/g, '[number]');
}

/**
 * One bounded line describing an error: its class, Prisma code, schema-only
 * meta, and the LAST line of its message. A Prisma message starts with the
 * failing call and its arguments (search text, ids, emails); its last line is
 * the reason, e.g. "The column `users.x` does not exist in the current database."
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return printable(redactValues(String(error)), MAX_ERROR_TEXT);
  const name = printable(error.constructor?.name ?? error.name, 60);
  const rawCode = (error as any).code;
  const code = typeof rawCode === 'string' ? ` ${printable(rawCode, 20)}` : '';
  const meta = (error as any).meta && typeof (error as any).meta === 'object' ? (error as any).meta : {};
  const safeMeta = SAFE_META_KEYS
    .filter((k) => meta[k] !== undefined && meta[k] !== null)
    .map((k) => `${k}=${printable(redactValues(Array.isArray(meta[k]) ? meta[k].join('|') : String(meta[k])), 80)}`);
  const reason = String(error.message ?? '').split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
  const text = `${name}${code}: ${redactValues(reason)}${safeMeta.length ? ` [${safeMeta.join(' ')}]` : ''}`;
  return printable(text, MAX_ERROR_TEXT);
}

/** Stack frames only ("at fn (file:line)"), at most MAX_STACK_FRAMES; the message line is dropped. */
export function safeStack(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;
  const frames = error.stack.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('at '));
  return frames.slice(0, MAX_STACK_FRAMES).map((l) => printable(l, 200)).join('\n') || undefined;
}

/**
 * The status Nest answers for this exception: an HttpException's own, an
 * http-errors status (body-parser's 400 bad JSON or 413 too large), else 500.
 */
export function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  const s = (exception as any)?.statusCode;
  if (typeof s === 'number' && s >= 400 && s < 600 && typeof (exception as any)?.message === 'string') return s;
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

/**
 * Global HTTP exception filter. Client errors (4xx) are answered exactly as
 * before. Server errors are logged with the request id; an unexpected error
 * (anything that is not an HttpException) answers the same generic 500 body
 * Nest gave, plus requestId.
 */
@Catch()
export class RequestIdExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return super.catch(exception, host);

    const http = host.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const status = statusOf(exception);

    // An HttpException's body is the application's own; Nest writes it and logs nothing.
    if (exception instanceof HttpException && status < 500) return super.catch(exception, host);

    const requestId: string = req?.requestId ?? resolveRequestId(undefined);
    if (status >= 500) {
      const userId = printable(String(req?.user?.id ?? 'anonymous'), 40);
      const method = printable(String(req?.method ?? ''), 10);
      this.logger.error(
        `[req ${requestId}] ${method} ${logUrl(String(req?.originalUrl ?? req?.url ?? ''))} -> ${status} user=${userId} ${describeError(exception)}`,
        safeStack(exception),
      );
    }

    if (exception instanceof HttpException) return super.catch(exception, host);
    // Anything else is answered here rather than by Nest's default handler,
    // which would log the raw error message (a Prisma message quotes the query's
    // arguments; a body-parser message can quote the request body).
    if (res.headersSent) return void res.end?.();
    if (!res.getHeader?.(REQUEST_ID_HEADER)) res.setHeader?.(REQUEST_ID_HEADER, requestId);
    res.status(status).json(status >= 500
      ? { statusCode: status, message: 'Internal server error', requestId }
      // body-parser's own 4xx (bad JSON, too large): the same answer Nest gave.
      : { statusCode: status, message: String((exception as any)?.message ?? '') });
  }
}
