/** Self-contained: Chrome serializes this function into the isolated world. */
export async function runAutofill(command: unknown) {
  const fields = [
    ['email', 'Email Address', 50],
    ['legalBusinessName', 'Legal Business Name', 90],
    ['businessNameOnCard', 'Business Name on Card', 20],
    ['companyDBAName', 'Company DBA Name', 90],
    ['firstName', 'First Name', 15],
    ['lastName', 'Last Name', 20],
    ['nameOnCard', 'Name on Card', 20],
  ] as const;
  type Status =
    | 'ready'
    | 'filled'
    | 'missing'
    | 'ambiguous'
    | 'mismatch'
    | 'unavailable'
    | 'existing-value'
    | 'no-value'
    | 'invalid-value'
    | 'changed'
    | 'validation-error'
    | 'failed';
  const results: { field: string; status: Status }[] = [];
  const output = {
    make(state: 'ok' | 'blocked' | 'invalid-command') {
      return { state, fields: results };
    },
  };
  // Kept self-contained for Chrome serialization; tested against classifyTarget.
  const url = new URL(location.href);
  const kind =
    url.href === 'http://127.0.0.1:4173/autofill-fixture'
      ? 'fixture'
      : url.origin === 'https://www.americanexpress.com' &&
          /^\/en-us\/credit-cards\/apply\/business\/business-platinum-charge-card\/\d{5}-\d-\d\/?$/.test(
            url.pathname,
          )
        ? 'amex'
        : undefined;
  if (window !== window.top || !kind || url.username || url.password)
    return output.make('blocked');
  if (!command || typeof command !== 'object' || Array.isArray(command))
    return output.make('invalid-command');
  const c = command as Record<string, unknown>;
  if (
    Object.keys(c).some(
      (k) => !['action', 'values', 'source', 'expectedUrl'].includes(k),
    ) ||
    (c.action !== 'inspect' && c.action !== 'fill')
  )
    return output.make('invalid-command');
  const values = c.values;
  if (
    c.action === 'fill' &&
    (!values || typeof values !== 'object' || Array.isArray(values))
  )
    return output.make('invalid-command');
  if (c.action === 'inspect' && values !== undefined)
    return output.make('invalid-command');
  if (
    c.action === 'fill' &&
    ((kind === 'amex' &&
      (c.source !== 'vault-file' || c.expectedUrl !== url.href)) ||
      (kind === 'fixture' && c.source !== 'local-test'))
  )
    return output.make('blocked');
  const data = (values ?? {}) as Record<string, unknown>;
  if (
    Object.keys(data).some((key) => !fields.some((f) => f[0] === key)) ||
    Object.values(data).some((value) => typeof value !== 'string')
  )
    return output.make('invalid-command');

  const written: {
    el: HTMLInputElement;
    value: string;
    result: { field: string; status: Status };
  }[] = [];
  for (const [id, label, maxLength] of fields) {
    const result: { field: string; status: Status } = {
      field: id,
      status: 'missing',
    };
    results.push(result);
    if (location.href !== url.href) {
      result.status = 'changed';
      continue;
    }
    const byId = document.querySelectorAll(`#${id}`);
    const byName = document.querySelectorAll(`[name="${id}"]`);
    if (!byId.length && !byName.length) continue;
    if (byId.length > 1 || byName.length > 1) {
      result.status = 'ambiguous';
      continue;
    }
    const el = byId[0];
    if (
      !(el instanceof HTMLInputElement) ||
      el !== byName[0] ||
      el.type !== 'text' ||
      el.getAttribute('role') ||
      !el.labels?.length ||
      !Array.from(el.labels).every(
        (l) => l.textContent?.trim().replace(/\s*\*$/, '') === label,
      )
    ) {
      result.status = 'mismatch';
      continue;
    }
    if (
      !el.isConnected ||
      el.matches(':disabled') ||
      el.readOnly ||
      el.closest('[inert],[hidden],[aria-hidden="true"]') ||
      el.getAttribute('aria-disabled') === 'true' ||
      !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
      el.getClientRects().length === 0
    ) {
      result.status = 'unavailable';
      continue;
    }
    if (el.value !== '') {
      result.status = 'existing-value';
      continue;
    }
    result.status = 'ready';
    if (c.action === 'inspect') continue;
    const value = data[id];
    if (typeof value !== 'string' || value === '') {
      result.status = 'no-value';
      continue;
    }
    if (
      value.length > maxLength ||
      (el.maxLength >= 0 && value.length > el.maxLength) ||
      (el.minLength > 0 && value.length < el.minLength) ||
      !value.trim() ||
      Array.from(value).some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
      ) ||
      el.hasAttribute('pattern')
    ) {
      result.status = 'invalid-value';
      continue;
    }
    try {
      // Native setter plus input/change supports controlled inputs; never click, focus, blur or submit.
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      if (!setter) {
        result.status = 'failed';
        continue;
      }
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      // A handler may replace, lock, or change the element synchronously.
      if (
        !el.isConnected ||
        el.value !== value ||
        el.matches(':disabled') ||
        el.readOnly
      ) {
        result.status = 'changed';
        continue;
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      result.status =
        el.isConnected && el.value === value ? 'filled' : 'changed';
      if (result.status === 'filled') written.push({ el, value, result });
    } catch {
      result.status = 'failed';
    }
  }
  if (written.length) {
    // Catch framework rerenders/reverts after the synchronous event handlers.
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const { el, value, result } of written) {
      if (location.href !== url.href || !el.isConnected || el.value !== value)
        result.status = 'changed';
      else if (el.getAttribute('aria-invalid') === 'true' || !el.validity.valid)
        result.status = 'validation-error';
    }
  }
  // Only fixed field identifiers/statuses cross back to the extension, never DOM text/values.
  return output.make('ok');
}
