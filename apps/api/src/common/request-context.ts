import type { Request } from 'express';
import type { User } from '@prisma/client';

export interface Principal {
  /** Effective user: the impersonation target while a support session is open (design §12.8). */
  user: User;
  impersonatorId: string | null;
  /** The real session owner; equals `user` unless impersonating. */
  actor?: User;
}

/** Fields attached to the Express request by middleware/guards. */
export interface RequestContext {
  requestId: string;
  cookies: Record<string, string>;
  principal?: Principal;
}

export type AppRequest = Request & RequestContext;

export const REQUEST_ID_HEADER = 'x-request-id';
