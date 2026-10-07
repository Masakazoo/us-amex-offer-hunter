/** Parse only an explicitly named, single application code. Never scan opaque URLs. */
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
    if (values.length !== 1) return;
    const value = values[0]?.[1];
    return value && /^\d{5}-\d-\d$/.test(value) ? value : undefined;
  } catch {
    return;
  }
}
