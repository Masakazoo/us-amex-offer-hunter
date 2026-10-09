import type { FullFieldSpec } from './full-profile.js';

/** Serialized into ISOLATED world. Never returns text, values, URLs or exceptions. */
export async function runFullAutofill(input: {
  command: unknown;
  specs: FullFieldSpec[];
}) {
  const { command, specs } = input;
  type Status =
    | 'ready'
    | 'filled'
    | 'matched'
    | 'missing'
    | 'ambiguous'
    | 'mismatch'
    | 'unavailable'
    | 'existing-value'
    | 'no-value'
    | 'invalid-value'
    | 'changed'
    | 'validation-error'
    | 'failed'
    | 'conditional'
    | 'not-present'
    | 'address-review';
  const results: { field: string; status: Status }[] = [];
  const output = {
    make(state: 'ok' | 'blocked' | 'invalid-command') {
      return { state, fields: results };
    },
  };
  const start = location.href;
  const url = new URL(start);
  const real =
    url.origin === 'https://www.americanexpress.com' &&
    /^\/en-us\/credit-cards\/apply\/business\/business-platinum-charge-card\/\d{5}-\d-\d\/?$/.test(
      url.pathname,
    );
  const fixture = start === 'http://127.0.0.1:4173/autofill-fixture';
  if (
    window !== window.top ||
    url.username ||
    url.password ||
    (!real && !fixture)
  )
    return output.make('blocked');
  if (!command || typeof command !== 'object' || Array.isArray(command))
    return output.make('invalid-command');
  const c = command as Record<string, unknown>;
  if (
    Object.keys(c).some(
      (k) => !['action', 'values', 'source', 'expectedUrl'].includes(k),
    ) ||
    !['inspect', 'fill'].includes(String(c.action))
  )
    return output.make('invalid-command');
  if (
    c.action === 'fill' &&
    (c.expectedUrl !== start ||
      c.source !== (real ? 'vault-file' : 'local-test'))
  )
    return output.make('blocked');
  if (c.action === 'inspect' && c.values !== undefined)
    return output.make('invalid-command');
  if (
    c.action === 'fill' &&
    (!c.values || typeof c.values !== 'object' || Array.isArray(c.values))
  )
    return output.make('invalid-command');
  const data = (c.values ?? {}) as Record<string, string>;
  if (
    Object.entries(data).some(
      ([key, value]) =>
        !specs.some((s) => s.key === key) || typeof value !== 'string',
    )
  )
    return output.make('invalid-command');
  const helpers = {
    wait(ms: number) {
      return new Promise<void>((r) => setTimeout(r, ms));
    },
    label(s: string) {
      return s
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s*\*$/, '');
    },
    visible(e: Element) {
      return (
        e.isConnected &&
        !e.closest('[hidden],[inert],[aria-hidden="true"]') &&
        e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
        e.getClientRects().length > 0
      );
    },
    normalized(value: string, spec: FullFieldSpec) {
      if (['phone', 'tax', 'ssn'].includes(spec.format ?? ''))
        return value.replace(/[ ()-]/g, '');
      if (spec.format === 'money') {
        const n = value.replace(/[$,\s]/g, '');
        return /^\d+(?:\.\d+)?$/.test(n) ? String(Number(n)) : value;
      }
      if (spec.format === 'date') return value.replace(/\//g, '-');
      return value;
    },
    normalizeAddress(value: string) {
      return value.toLowerCase().replace(/[^a-z0-9]/g, '');
    },
    checked(id: string) {
      const e = document.getElementById(id);
      return (
        e instanceof HTMLInputElement && e.type === 'checkbox' && e.checked
      );
    },
    sole() {
      const e = document.getElementById('companyStructure');
      return (
        e instanceof HTMLSelectElement &&
        e.selectedOptions[0]?.textContent?.trim() === 'Sole Proprietorship'
      );
    },
  };
  // Only reveal the design panel; never select a design not present in the profile.
  if (specs.some((s) => s.kind === 'radio' && data[s.key])) {
    const buttons = [...document.querySelectorAll('button')].filter(
      (e) => e.textContent?.trim() === 'Show Card design options',
    );
    if (buttons.length === 1 && helpers.visible(buttons[0]!)) {
      buttons[0]!.click();
      await helpers.wait(150);
    }
  }
  const order = [
    'companyStructure',
    'industryType',
    'doingBusinessAs',
    'email',
    'legalBusinessName',
    'businessNameOnCard',
    'companyDBAName',
    'businessZipCode',
    'businessAddressLine1',
    'businessAddressLine2',
    'businessCity',
    'businessState',
    'businessPhoneNumber',
    'yearsInBusiness',
    'numberOfEmployees',
    'annualBusinessRevenue',
    'estimatedMonthlySpend',
    'federalTaxId',
    'roleInCompany',
    'firstName',
    'middleName',
    'lastName',
    'nameOnCard',
    'sameAddress',
    'zipCode',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'cellPhone',
    'ssn',
    'dateOfBirth',
    'totalAnnualIncome',
    'nonTaxableAnnualIncome',
    'cardDesign',
    'cardMaterial',
  ];
  const written: {
    spec: FullFieldSpec;
    el: HTMLInputElement | HTMLSelectElement;
    value: string;
    result: { field: string; status: Status };
  }[] = [];
  for (const key of order) {
    const spec = specs.find((s) => s.key === key);
    if (!spec) continue;
    const result: { field: string; status: Status } = {
      field: key,
      status: 'missing',
    };
    results.push(result);
    if (location.href !== start) {
      result.status = 'changed';
      continue;
    }
    const value = data[key] ?? '';
    // Use actual live branching, not assumptions about a previous selected value.
    if (
      (key === 'federalTaxId' && helpers.sole()) ||
      (key === 'companyDBAName' && helpers.checked('doingBusinessAs')) ||
      (['addressLine1', 'addressLine2', 'zipCode', 'city', 'state'].includes(
        key,
      ) &&
        helpers.checked('sameAddress'))
    ) {
      result.status = 'conditional';
      continue;
    }
    if (spec.kind === 'radio') {
      if (!value) {
        result.status = 'no-value';
        continue;
      }
      if (!spec.options?.includes(value)) {
        result.status = 'invalid-value';
        continue;
      }
      const prefix = key === 'cardDesign' ? 'color-' : 'material-';
      const group = [
        ...document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      ].filter((e) => e.name.startsWith(prefix));
      const candidates = group.filter((e) =>
        [...(e.labels ?? [])].some(
          (l) => helpers.label(l.textContent ?? '') === value,
        ),
      );
      if (candidates.length !== 1) {
        result.status = candidates.length ? 'ambiguous' : 'missing';
        continue;
      }
      const el = candidates[0]!;
      const labels = [...(el.labels ?? [])].filter((l) => helpers.visible(l));
      if (el.disabled || labels.length !== 1) {
        result.status = 'unavailable';
        continue;
      }
      if (el.checked) {
        result.status = 'matched';
        continue;
      }
      result.status = 'ready';
      if (c.action === 'inspect') continue;
      labels[0]!.click();
      await helpers.wait(200);
      result.status = el.isConnected && el.checked ? 'filled' : 'changed';
      written.push({ spec, el, value, result });
      continue;
    }
    const byId = document.querySelectorAll(`#${key}`);
    const byName = document.querySelectorAll(`[name="${key}"]`);
    if (byId.length > 1 || byName.length > 1) {
      result.status = 'ambiguous';
      continue;
    }
    const el = byId[0];
    if (!el && !byName.length) {
      // City/state are conditional controls revealed by the site's address flow.
      if (['businessCity', 'businessState', 'city', 'state'].includes(key))
        result.status = 'not-present';
      continue;
    }
    const isSelect = el instanceof HTMLSelectElement;
    if (
      !(el instanceof HTMLInputElement || isSelect) ||
      el !== byName[0] ||
      el.type !== (spec.kind === 'select' ? 'select-one' : spec.kind) ||
      (!spec.combobox && el.getAttribute('role')) ||
      (spec.combobox && el.getAttribute('role') !== 'combobox')
    ) {
      result.status = 'mismatch';
      continue;
    }
    const labels = [...(el.labels ?? [])];
    const texts = labels
      .map((l) => helpers.label(l.textContent ?? ''))
      .filter(Boolean);
    if (!texts.length || !texts.every((t) => t === spec.label)) {
      result.status = 'mismatch';
      continue;
    }
    const display =
      spec.kind === 'checkbox'
        ? labels.some((l) => helpers.visible(l))
        : helpers.visible(el);
    if (
      !display ||
      el.matches(':disabled') ||
      el.closest('[inert],[hidden],[aria-hidden="true"]') ||
      el.getAttribute('aria-disabled') === 'true' ||
      (el instanceof HTMLInputElement && el.readOnly)
    ) {
      result.status = 'unavailable';
      continue;
    }
    result.status =
      c.action === 'inspect' &&
      el instanceof HTMLInputElement &&
      spec.kind !== 'checkbox' &&
      el.value !== ''
        ? 'existing-value'
        : 'ready';
    if (c.action === 'inspect') continue;
    if (!value) {
      result.status = 'no-value';
      continue;
    }
    if (
      value.length > spec.max ||
      Array.from(value).some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
      ) ||
      !value.trim() ||
      (spec.options && !spec.options.includes(value))
    ) {
      result.status = 'invalid-value';
      continue;
    }
    try {
      if (spec.kind === 'checkbox' && el instanceof HTMLInputElement) {
        const wanted = value === 'yes';
        if (el.checked === wanted) {
          result.status = 'matched';
          continue;
        }
        const label = labels.find((l) => helpers.visible(l));
        if (!label) {
          result.status = 'unavailable';
          continue;
        }
        label.click();
        await helpers.wait(250);
        result.status =
          el.isConnected && el.checked === wanted ? 'filled' : 'changed';
        written.push({ spec, el, value, result });
        continue;
      }
      let next = value;
      if (isSelect) {
        const options = [...el.options].filter(
          (o) =>
            !o.disabled &&
            (key === 'state' || key === 'businessState'
              ? o.value === value
              : o.text.trim() === value),
        );
        if (options.length !== 1) {
          result.status = options.length ? 'ambiguous' : 'invalid-value';
          continue;
        }
        next = options[0]!.value;
        if (el.value === next) {
          result.status = 'matched';
          continue;
        }
        // A profile explicitly chooses a dropdown value; do not infer a choice from its position.
      } else {
        next = ['phone', 'tax', 'ssn'].includes(spec.format ?? '')
          ? value.replace(/[ ()-]/g, '')
          : value;
        if (el.value !== '') {
          result.status =
            helpers.normalized(el.value, spec) ===
            helpers.normalized(value, spec)
              ? 'matched'
              : 'existing-value';
          continue;
        }
        if (
          (el.maxLength >= 0 && next.length > el.maxLength) ||
          (el.minLength > 0 && next.length < el.minLength) ||
          el.hasAttribute('pattern')
        ) {
          result.status = 'invalid-value';
          continue;
        }
      }
      el.focus();
      Object.getOwnPropertyDescriptor(
        isSelect ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
        'value',
      )?.set?.call(el, next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await helpers.wait(spec.combobox ? 650 : 150);
      if (spec.combobox && el instanceof HTMLInputElement) {
        // Select a suggestion only if street AND ZIP match the user's registered address.
        const listId = el.getAttribute('aria-controls');
        const list = listId ? document.getElementById(listId) : null;
        const suggestions = list
          ? [...list.querySelectorAll<HTMLElement>('[role="option"]')].filter(
              (e) => helpers.visible(e),
            )
          : [];
        const zip =
          data[
            key === 'businessAddressLine1' ? 'businessZipCode' : 'zipCode'
          ] ?? '';
        const matched = suggestions.filter(
          (e) =>
            helpers
              .normalizeAddress(e.textContent ?? '')
              .includes(helpers.normalizeAddress(value)) &&
            zip &&
            new RegExp(`\\b${zip}\\b`).test(e.textContent ?? ''),
        );
        if (suggestions.length) {
          if (matched.length === 1) {
            matched[0]!.click();
            await helpers.wait(250);
          } else {
            result.status = 'address-review';
            el.blur();
            continue;
          }
        }
      }
      el.blur();
      await helpers.wait(150);
      const expected = isSelect ? next : helpers.normalized(value, spec);
      result.status =
        el.isConnected &&
        (isSelect ? el.value : helpers.normalized(el.value, spec)) === expected
          ? 'filled'
          : 'changed';
      if (result.status === 'filled')
        written.push({ spec, el, value: isSelect ? next : value, result });
    } catch {
      result.status = 'failed';
    }
  }
  if (c.action === 'fill') {
    await helpers.wait(500);
    for (const { spec, el, value, result } of written) {
      if (location.href !== start || !el.isConnected) {
        result.status = 'changed';
        continue;
      }
      const same =
        spec.kind === 'checkbox'
          ? (el as HTMLInputElement).checked === (value === 'yes')
          : spec.kind === 'radio'
            ? (el as HTMLInputElement).checked
            : helpers.normalized(el.value, spec) ===
              helpers.normalized(value, spec);
      if (!same) result.status = 'changed';
      else if (el.getAttribute('aria-invalid') === 'true' || !el.validity.valid)
        result.status = 'validation-error';
    }
  }
  return output.make('ok');
}
