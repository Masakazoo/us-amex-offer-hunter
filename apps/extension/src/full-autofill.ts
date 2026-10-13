import type { FullFieldSpec } from './full-profile.js';

/** Serialized into ISOLATED world. Never returns text, values, URLs or exceptions. */
export async function runFullAutofill(input: {
  command: unknown;
  allowFixture?: boolean;
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
    make(state: 'ok' | 'blocked' | 'invalid-command' | 'cancelled') {
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
  const fixture =
    input.allowFixture === true &&
    start === 'http://127.0.0.1:4173/autofill-fixture';
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
      (k) =>
        ![
          'action',
          'values',
          'invalidFields',
          'source',
          'expectedUrl',
          'operationId',
        ].includes(k),
    ) ||
    !['inspect', 'fill'].includes(String(c.action))
  )
    return output.make('invalid-command');
  if (
    c.action === 'fill' &&
    (c.expectedUrl !== start ||
      c.source !== 'encrypted-vault' ||
      typeof c.operationId !== 'string')
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
  const invalidFields = c.invalidFields ?? [];
  if (
    !Array.isArray(invalidFields) ||
    invalidFields.length > specs.length ||
    invalidFields.some(
      (key) => typeof key !== 'string' || !specs.some((s) => s.key === key),
    ) ||
    new Set(invalidFields).size !== invalidFields.length ||
    (c.action === 'inspect' && invalidFields.length)
  )
    return output.make('invalid-command');
  const gate = async () => {
    if (location.href !== start) return false;
    if (c.action !== 'fill') return true;
    try {
      return (
        (
          await chrome.runtime.sendMessage({
            channel: 'autofill-v1',
            op: 'guard',
            operationId: c.operationId,
            fields: results,
          })
        )?.ok === true && location.href === start
      );
    } catch {
      return false;
    }
  };
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
      if (
        [
          'businessNameOnCard',
          'nameOnCard',
          'businessAddressLine1',
          'businessAddressLine2',
          'businessCity',
          'addressLine1',
          'addressLine2',
          'city',
        ].includes(spec.key)
      )
        return value
          .replace(/[a-z]/g, (letter) => letter.toUpperCase())
          .trim()
          .replace(/\s+/g, ' ');
      return value;
    },
    normalizeAddress(value: string) {
      return value.toLowerCase().trim().replace(/\s+/g, ' ');
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
  // Recheck after the last asynchronous gate/focus, directly before mutation.
  const safeControl = (
    el: HTMLInputElement | HTMLSelectElement,
    spec: FullFieldSpec,
  ) => {
    const same = document.querySelectorAll(`#${spec.key}`);
    const names = document.querySelectorAll(`[name="${spec.key}"]`);
    const labels = [...(el.labels ?? [])];
    const texts = labels
      .map((l) => helpers.label(l.textContent ?? ''))
      .filter(Boolean);
    return (
      location.href === start &&
      same.length === 1 &&
      same[0] === el &&
      names.length === 1 &&
      names[0] === el &&
      el.type === (spec.kind === 'select' ? 'select-one' : spec.kind) &&
      (spec.combobox
        ? el.getAttribute('role') === 'combobox'
        : !el.getAttribute('role')) &&
      texts.length > 0 &&
      texts.every((text) => text === spec.label) &&
      (spec.kind === 'checkbox'
        ? labels.some((l) => helpers.visible(l))
        : helpers.visible(el)) &&
      !el.matches(':disabled') &&
      !el.closest('[hidden],[inert],[aria-hidden="true"]') &&
      el.getAttribute('aria-disabled') !== 'true' &&
      (!(el instanceof HTMLInputElement) || !el.readOnly)
    );
  };
  const safeOption = (el: HTMLElement, list: HTMLElement, expected: string) =>
    ['DIV', 'LI'].includes(el.tagName) &&
    list.contains(el) &&
    helpers.visible(el) &&
    el.getAttribute('role') === 'option' &&
    el.getAttribute('aria-disabled') !== 'true' &&
    !el.closest('a,button,label,[inert]') &&
    !el.querySelector('a,button,input,select,textarea,form') &&
    helpers.normalizeAddress(el.textContent ?? '') === expected;
  // Only reveal the design panel; never select a design not present in the profile.
  if (specs.some((s) => s.kind === 'radio' && data[s.key])) {
    const buttons = [...document.querySelectorAll('button')].filter(
      (e) => e.textContent?.trim() === 'Show Card design options',
    );
    if (buttons.length === 1 && helpers.visible(buttons[0]!)) {
      if (!(await gate())) return output.make('cancelled');
      const liveButtons = [...document.querySelectorAll('button')].filter(
        (e) => e.textContent?.trim() === 'Show Card design options',
      );
      if (
        liveButtons.length !== 1 ||
        liveButtons[0] !== buttons[0] ||
        !helpers.visible(buttons[0]!) ||
        buttons[0]!.disabled ||
        buttons[0]!.type !== 'button'
      )
        return output.make('blocked');
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
    if (!(await gate())) return output.make('cancelled');
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
      (key === 'companyDBAName' && helpers.checked('doingBusinessAs'))
    ) {
      result.status = 'conditional';
      continue;
    }
    if (
      ['addressLine1', 'addressLine2', 'zipCode', 'city', 'state'].includes(
        key,
      ) &&
      helpers.checked('sameAddress')
    ) {
      // Same-address does not guarantee that the site completed the home fields.
      // Never copy the business address; flag exposed controls for manual review.
      const controls = [
        ...document.querySelectorAll(`#${key},[name="${key}"]`),
      ];
      result.status = controls.some(
        (el) =>
          (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) &&
          helpers.visible(el) &&
          ((!el.matches(':disabled') &&
            el.getAttribute('aria-disabled') !== 'true') ||
            (!spec.optional && !el.value.trim())),
      )
        ? 'address-review'
        : 'conditional';
      continue;
    }
    if (invalidFields.includes(key)) {
      result.status = 'invalid-value';
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
      if (group.some((node) => node.checked)) {
        result.status = 'existing-value';
        continue;
      }
      result.status = 'ready';
      if (c.action === 'inspect') continue;
      if (!(await gate())) return output.make('cancelled');
      const liveGroup = [
        ...document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      ].filter((e) => e.name.startsWith(prefix));
      const liveCandidates = liveGroup.filter((e) =>
        [...(e.labels ?? [])].some(
          (l) => helpers.label(l.textContent ?? '') === value,
        ),
      );
      if (
        liveCandidates.length !== 1 ||
        liveCandidates[0] !== el ||
        !el.isConnected ||
        el.matches(':disabled') ||
        el.getAttribute('aria-disabled') === 'true' ||
        el.closest('[inert],[hidden],[aria-hidden="true"]') ||
        !helpers.visible(labels[0]!) ||
        ![...(el.labels ?? [])].includes(labels[0]!) ||
        helpers.label(labels[0]!.textContent ?? '') !== value
      ) {
        result.status = 'changed';
        continue;
      }
      if (liveGroup.some((e) => e.checked)) {
        result.status = el.checked ? 'matched' : 'existing-value';
        continue;
      }
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
        if (el.checked) {
          result.status = 'existing-value';
          continue;
        }
        if (!(await gate())) return output.make('cancelled');
        if (
          !safeControl(el, spec) ||
          ![...(el.labels ?? [])].includes(label) ||
          !helpers.visible(label)
        ) {
          result.status = 'changed';
          continue;
        }
        if (el.checked) {
          result.status = wanted ? 'matched' : 'existing-value';
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
        if (el.value !== '') {
          result.status = 'existing-value';
          continue;
        }
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
      if (!(await gate())) return output.make('cancelled');
      if (!safeControl(el, spec)) {
        result.status = 'changed';
        continue;
      }
      if (el.value !== '') {
        result.status = (
          isSelect
            ? el.value === next
            : helpers.normalized(el.value, spec) ===
              helpers.normalized(value, spec)
        )
          ? 'matched'
          : 'existing-value';
        continue;
      }
      el.focus();
      if (!safeControl(el, spec)) {
        result.status = 'changed';
        continue;
      }
      if (el.value !== '') {
        result.status = (
          isSelect
            ? el.value === next
            : helpers.normalized(el.value, spec) ===
              helpers.normalized(value, spec)
        )
          ? 'matched'
          : 'existing-value';
        continue;
      }
      if (isSelect) {
        const options = [...el.options].filter(
          (o) =>
            !o.disabled &&
            o.value === next &&
            (['state', 'businessState'].includes(key)
              ? o.value === value
              : o.text.trim() === value),
        );
        if (options.length !== 1) {
          result.status = 'changed';
          continue;
        }
      } else if (
        (el.maxLength >= 0 && next.length > el.maxLength) ||
        (el.minLength > 0 && next.length < el.minLength) ||
        el.hasAttribute('pattern')
      ) {
        result.status = 'changed';
        continue;
      }
      Object.getOwnPropertyDescriptor(
        isSelect ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
        'value',
      )?.set?.call(el, next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (location.href !== start || !el.isConnected)
        return output.make('cancelled');
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
        const business = key === 'businessAddressLine1';
        // Exact registered address only. Unknown abbreviation/locality/unit
        // formatting requires user review, never substring matching.
        const expectedAddress = helpers.normalizeAddress(
          [
            value,
            data[business ? 'businessAddressLine2' : 'addressLine2'],
            data[business ? 'businessCity' : 'city'],
            data[business ? 'businessState' : 'state'],
            zip,
          ]
            .filter(Boolean)
            .join(' '),
        );
        const matched = suggestions.filter(
          (e) => zip && list && safeOption(e, list, expectedAddress),
        );
        if (suggestions.length) {
          if (matched.length === 1) {
            if (!(await gate())) return output.make('cancelled');
            if (
              !list ||
              el.getAttribute('aria-controls') !== listId ||
              document.getElementById(listId!) !== list ||
              !safeControl(el, spec) ||
              el.value !== next ||
              !safeOption(matched[0]!, list, expectedAddress) ||
              [...list.querySelectorAll<HTMLElement>('[role="option"]')].filter(
                (e) => safeOption(e, list, expectedAddress),
              ).length !== 1
            ) {
              result.status = 'address-review';
              continue;
            }
            matched[0]!.click();
            await helpers.wait(250);
          } else {
            result.status = 'address-review';
            if (!(await gate())) return output.make('cancelled');
            el.blur();
            continue;
          }
        }
      }
      if (!(await gate())) return output.make('cancelled');
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
