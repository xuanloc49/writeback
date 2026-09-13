import type { ExpressAuthConfig } from '@auth/express';
import Google from '@auth/express/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { Logger } from '@nestjs/common';
import { SESSION } from '@writeback/shared';
import type { Clock } from '../../common/clock';
import type { AppConfig } from '../../config/app-config';
import type { PrismaService } from '../../prisma/prisma.service';

/** Auth.js is mounted outside the `/v1` prefix (design §6.0 / §12.1). */
export const AUTH_BASE_PATH = '/auth';
/** Where the web app lands after a successful sign-in when no allowed `callbackUrl` was given. */
export const POST_SIGN_IN_PATH = '/app';
export const GOOGLE_PROVIDER_ID = 'google';
/** Used only when `AUTH_SECRET` is blank in local/test (config forbids that elsewhere). */
const LOCAL_DEV_SECRET = 'writeback-local-dev-secret-not-for-production';
/** `@auth/express` sets `basePath` from the request, so Auth.js always emits this when `AUTH_URL` is set. */
const IGNORED_WARNINGS = new Set(['env-url-basepath-redundant']);

export interface AuthJsDeps {
  config: AppConfig;
  prisma: PrismaService;
  clock: Clock;
  logger?: Logger;
}

/**
 * Builds the Auth.js configuration (design §3.1 cookies, §6.0 provider/session/events).
 * Pure with respect to its inputs so it can be unit-tested without an HTTP server.
 */
export function createAuthJsConfig({
  config,
  prisma,
  clock,
  logger,
}: AuthJsDeps): ExpressAuthConfig {
  const log = logger ?? new Logger('AuthJs');
  const secure = config.secureCookies;
  if (config.authSecret === null) {
    log.warn('AUTH_SECRET is blank; using the local development secret');
  }

  return {
    basePath: AUTH_BASE_PATH,
    trustHost: true,
    secret: config.authSecret ?? LOCAL_DEV_SECRET,
    adapter: PrismaAdapter(prisma),
    providers: [
      Google({
        clientId: config.authGoogleId ?? undefined,
        clientSecret: config.authGoogleSecret ?? undefined,
      }),
    ],
    session: {
      strategy: 'database',
      maxAge: SESSION.MAX_AGE_SECONDS,
      updateAge: SESSION.UPDATE_AGE_SECONDS,
    },
    useSecureCookies: secure,
    cookies: {
      sessionToken: {
        name: SESSION.COOKIE_NAME,
        options: {
          httpOnly: true,
          sameSite: 'lax',
          secure,
          path: '/',
          ...(config.cookieDomain !== null ? { domain: config.cookieDomain } : {}),
        },
      },
    },
    callbacks: {
      /** Google must vouch for the e-mail; otherwise the sign-in is denied (no session). */
      signIn({ account, profile }) {
        if (account?.provider !== GOOGLE_PROVIDER_ID) {
          return false;
        }
        return typeof profile?.email === 'string' && profile.email_verified === true;
      },
      /** Only ever redirect back to the web origin (design §3.1). */
      redirect({ url }) {
        return sanitizeRedirect(url, config.appOrigin);
      },
    },
    events: {
      async signIn({ user }) {
        if (user.id === undefined) {
          return;
        }
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: clock.now() },
        });
      },
    },
    logger: {
      error: (error) => log.error(error.message, error.stack),
      warn: (code) => {
        if (!IGNORED_WARNINGS.has(code)) {
          log.warn(code);
        }
      },
      debug: () => undefined,
    },
  };
}

/**
 * Relative paths are resolved against the web origin; absolute URLs are accepted only when they
 * share the web origin. Anything else falls back to `${appOrigin}/app`.
 */
export function sanitizeRedirect(url: string, appOrigin: string): string {
  const fallback = `${appOrigin}${POST_SIGN_IN_PATH}`;
  if (url.startsWith('/') && !url.startsWith('//')) {
    return `${appOrigin}${url}`;
  }
  try {
    return new URL(url).origin === new URL(appOrigin).origin ? url : fallback;
  } catch {
    return fallback;
  }
}
