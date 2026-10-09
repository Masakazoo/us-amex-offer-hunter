export type TargetKind = 'fixture' | 'amex';

/** URL/query values stay in extension memory and are never logged. */
export function classifyTarget(
  raw: string | undefined,
): TargetKind | undefined {
  if (!raw) return;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return;
    if (raw === 'http://127.0.0.1:4173/autofill-fixture') return 'fixture';
    if (
      url.origin === 'https://www.americanexpress.com' &&
      /^\/en-us\/credit-cards\/apply\/business\/business-platinum-charge-card\/\d{5}-\d-\d\/?$/.test(
        url.pathname,
      )
    )
      return 'amex';
  } catch {
    /* Unsupported URL. */
  }
}
