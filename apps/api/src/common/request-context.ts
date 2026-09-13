import type { Request } from 'express';
import type { User } from '@prisma/client';

export interface Principal {
  user: User;
  impersonatorId: string | null;
}

/** Fields attached to the Express request by middleware/guards. */
export interface RequestContext {
  requestId: string;
  cookies: Record<string, string>;
  principal?: Principal;
}

export type AppRequest = Request & RequestContext;

export const REQUEST_ID_HEADER = 'x-request-id';
