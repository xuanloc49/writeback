export function googleSignInUrl(apiUrl: string, appOrigin: string): string {
  const callbackUrl = `${appOrigin}/app`;
  return `${apiUrl}/auth/signin/google?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

export function googleSignOutUrl(apiUrl: string, appOrigin: string): string {
  return `${apiUrl}/auth/signout?callbackUrl=${encodeURIComponent(`${appOrigin}/`)}`;
}
