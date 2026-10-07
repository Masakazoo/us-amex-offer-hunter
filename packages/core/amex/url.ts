/** Observed URL syntax, not an official Amex specification. Never scan opaque values. */
export function parseApplicationCode(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'www.americanexpress.com' ||
      url.username ||
      url.password
    )
      return;
    const values = [...url.searchParams].filter(
      ([key]) => key === 'applicationCode',
    );
    // An explicit but ambiguous/invalid query must not silently fall back to a path.
    if (values.length > 1) return;
    const value =
      values.length === 1 ? values[0]?.[1] : url.pathname.split('/').at(-1);
    return value && /^\d{5}-\d-\d$/.test(value) ? value : undefined;
  } catch {
    return;
  }
}
