import type { MeDto } from '@writeback/shared';

const LEARNING_PREFIXES = ['/app/rewrite', '/app/vocab', '/app/review', '/app/history'] as const;

export function isLearningRoute(pathname: string): boolean {
  if (pathname === '/app') {
    return true;
  }
  if (pathname === '/app/account' || pathname.startsWith('/app/account/')) {
    return false;
  }
  return LEARNING_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function afterAuthPath(me: MeDto): string {
  if (!me.learningBlocked || me.learningBlockedReason === 'TOS_REQUIRED') {
    return '/app';
  }
  return '/app/account';
}

export function learnerRedirect(me: MeDto | null, pathname: string): string | null {
  if (me === null) {
    return pathname === '/app' || pathname.startsWith('/app/') ? '/login' : null;
  }
  const reason = me.learningBlocked ? me.learningBlockedReason : null;
  if (reason === 'TOS_REQUIRED') {
    return pathname === '/login' ? '/app' : null;
  }
  if (reason === 'ONBOARDING_REQUIRED' || reason === 'BETA_BLOCKED') {
    if (pathname === '/login' || isLearningRoute(pathname)) {
      return '/app/account';
    }
    return null;
  }
  if (pathname === '/login') {
    return '/app';
  }
  return null;
}
