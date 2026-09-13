export function withQuery(
  path: string,
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    qs.set(key, String(value));
  }
  const encoded = qs.toString();
  return encoded.length === 0 ? path : `${path}?${encoded}`;
}
