import { createTestApp, type TestApp } from './helpers/app';
import { flushRedis, resetDatabase } from './helpers/db';
import { createAllowlistEmail, createLemma, createTopic, createUser } from './helpers/factories';

const CSRF_COOKIE_NAME = 'authjs.csrf-token';
const GOOGLE_AUTHORIZE_ORIGIN = 'https://accounts.google.com';

function setCookieHeader(res: {
  headers: Record<string, string | string[] | undefined>;
}): string[] {
  const raw = res.headers['set-cookie'];
  if (raw === undefined) {
    return [];
  }
  return Array.isArray(raw) ? raw : [raw];
}

/** Turns `Set-Cookie` headers into a single request `Cookie` header value. */
function cookieHeaderFrom(setCookies: string[]): string {
  return setCookies.map((line) => line.split(';')[0] ?? '').join('; ');
}

describe('Auth.js mount at /auth (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await flushRedis(t.config.redisUrl);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  afterAll(async () => {
    await t.close();
  });

  it('GET /auth/providers lists google', async () => {
    const res = await t.http.get('/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body.google).toMatchObject({ id: 'google', type: 'oidc' });
    expect(res.body.google.callbackUrl).toMatch(/\/auth\/callback\/google$/);
  });

  it('GET /auth/csrf returns a token and sets the csrf cookie', async () => {
    const res = await t.http.get('/auth/csrf');
    expect(res.status).toBe(200);
    expect(typeof res.body.csrfToken).toBe('string');
    expect(res.body.csrfToken.length).toBeGreaterThan(0);
    const cookies = setCookieHeader(res);
    expect(cookies.some((line) => line.startsWith(`${CSRF_COOKIE_NAME}=`))).toBe(true);
    expect(cookies.some((line) => /HttpOnly/i.test(line))).toBe(true);
  });

  it('POST /auth/signin/google redirects to Google with redirect_uri under AUTH_URL', async () => {
    const authUrl = t.config.authUrl ?? '';
    expect(authUrl).not.toBe('');
    const csrf = await t.http.get('/auth/csrf');
    const cookie = cookieHeaderFrom(setCookieHeader(csrf));

    const res = await t.http
      .post('/auth/signin/google')
      .set('Host', new URL(authUrl).host)
      .set('Origin', t.config.appOrigin)
      .set('Cookie', cookie)
      .type('form')
      .send({ csrfToken: csrf.body.csrfToken, callbackUrl: `${t.config.appOrigin}/app` });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location ?? '');
    expect(location.origin).toBe(GOOGLE_AUTHORIZE_ORIGIN);
    expect(location.searchParams.get('client_id')).toBe(t.config.authGoogleId);
    expect(location.searchParams.get('redirect_uri')).toBe(`${authUrl}/auth/callback/google`);
    expect(location.searchParams.get('scope')).toContain('email');
    // Auth.js remembers where to land after the callback (web origin only).
    const callbackCookie = setCookieHeader(res).find((line) => line.includes('callback-url='));
    expect(callbackCookie).toBeDefined();
    expect(decodeURIComponent(callbackCookie ?? '')).toContain(`${t.config.appOrigin}/app`);
  });

  it('POST /auth/signin/google from a foreign Origin is rejected by the CSRF origin check', async () => {
    const csrf = await t.http.get('/auth/csrf');
    const res = await t.http
      .post('/auth/signin/google')
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookieHeaderFrom(setCookieHeader(csrf)))
      .type('form')
      .send({ csrfToken: csrf.body.csrfToken });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /auth/session without a cookie returns an empty session', async () => {
    const res = await t.http.get('/auth/session');
    expect(res.status).toBe(200);
    expect(res.body ?? null).toBeNull();
  });

  it('existing database session cookie still authenticates GET /v1/me', async () => {
    const { user, cookie } = await createUser(t.prisma);
    const res = await t.http.get('/v1/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
    expect(res.body.email).toBe(user.email);
  });

  it('Auth.js reads the same wb.session cookie for GET /auth/session', async () => {
    const { user, cookie } = await createUser(t.prisma);
    const res = await t.http.get('/auth/session').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(user.email);
  });
});

describe('beta allowlist gate (integration, BETA_ALLOWLIST_ENABLED=true)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ config: { betaAllowlistEnabled: true } });
    await flushRedis(t.config.redisUrl);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await flushRedis(t.config.redisUrl);
  });

  afterAll(async () => {
    await t.close();
  });

  async function onboardedTopicId(): Promise<string> {
    const topic = await createTopic(t.prisma);
    await createLemma(t.prisma, { topicId: topic.id, includedInFree: true });
    return topic.id;
  }

  it('blocks a non-staff user who is not on the allowlist with 403 BETA_BLOCKED', async () => {
    const topicId = await onboardedTopicId();
    const { cookie } = await createUser(t.prisma, { onboardingTopicIds: [topicId] });
    const res = await t.http.post('/v1/rewrite/start').set('Cookie', cookie).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BETA_BLOCKED');

    const me = await t.http.get('/v1/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.learningBlockedReason).toBe('BETA_BLOCKED');
  });

  it('lets an allowlisted e-mail through the gate (reaches NO_PROMPT)', async () => {
    const topicId = await onboardedTopicId();
    const { user: admin } = await createUser(t.prisma, { role: 'admin' });
    const email = 'Invited.User@Example.com';
    await createAllowlistEmail(t.prisma, email, admin.id);
    const { cookie } = await createUser(t.prisma, { email, onboardingTopicIds: [topicId] });
    const res = await t.http.post('/v1/rewrite/start').set('Cookie', cookie).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_PROMPT');
  });

  it('staff (editor) bypasses the allowlist', async () => {
    const topicId = await onboardedTopicId();
    const { cookie } = await createUser(t.prisma, {
      role: 'editor',
      onboardingTopicIds: [topicId],
    });
    const res = await t.http.post('/v1/rewrite/start').set('Cookie', cookie).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_PROMPT');
  });
});
