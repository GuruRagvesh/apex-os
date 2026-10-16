import { HttpException, HttpStatus } from '@nestjs/common';
import { RemediationErrorBody, RemediationResult } from './remediation.types';
import { sanitizeRemediation } from './remediation.serializer';

/**
 * An HTTP error that carries a remediation. Serializes as
 * `{ statusCode, error: 'REMEDIATION', remediation, code, message, ...extra }`.
 * `code` and `message` stay for callers that predate the contract; `extra`
 * keeps fields an endpoint already returned (for example `reasons`).
 */
export class RemediationException extends HttpException {
  constructor(remediation: RemediationResult, status: number = HttpStatus.CONFLICT, message?: string, extra: Record<string, unknown> = {}) {
    const clean = sanitizeRemediation(remediation);
    const body: RemediationErrorBody & Record<string, unknown> = {
      ...extra,
      statusCode: status,
      error: 'REMEDIATION',
      remediation: clean,
      code: clean.code,
      message: message ?? clean.problem,
    };
    super(body, status);
  }
}

export function isRemediationBody(body: unknown): body is RemediationErrorBody {
  return !!body && typeof body === 'object' && (body as any).error === 'REMEDIATION' && !!(body as any).remediation;
}
