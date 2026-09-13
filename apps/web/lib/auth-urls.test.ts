import { describe, expect, it } from 'vitest';
import { googleSignInUrl, googleSignOutUrl } from './auth-urls';

describe('auth urls', () => {
  it('sends Google sign-in back to /app on the web origin', () => {
    expect(googleSignInUrl('http://localhost:4000', 'http://localhost:3000')).toBe(
      'http://localhost:4000/auth/signin/google?callbackUrl=http%3A%2F%2Flocalhost%3A3000%2Fapp',
    );
  });

  it('sends sign-out back to the landing page', () => {
    expect(googleSignOutUrl('http://localhost:4000', 'http://localhost:3000')).toBe(
      'http://localhost:4000/auth/signout?callbackUrl=http%3A%2F%2Flocalhost%3A3000%2F',
    );
  });
});
