import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { parse as parseCookies } from 'cookie';
import { REQUEST_ID_HEADER, type AppRequest } from './request-context';

const REQUEST_ID_MAX_LENGTH = 128;

/** Mints/echoes `X-Request-Id` and parses cookies for downstream guards. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId =
      incoming !== undefined && incoming.length > 0 && incoming.length <= REQUEST_ID_MAX_LENGTH
        ? incoming
        : randomUUID();
    const appReq = req as AppRequest;
    appReq.requestId = requestId;
    appReq.cookies = parseCookieHeader(req.header('cookie'));
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (header === undefined) {
    return {};
  }
  const parsed = parseCookies(header);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}
