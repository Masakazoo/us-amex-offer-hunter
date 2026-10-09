import {
  fullFieldSpecs,
  profileIssues,
  fullProfileSchema,
} from '../../apps/extension/src/full-profile.js';
const status = document.querySelector<HTMLElement>('#status')!;
const form = document.querySelector<HTMLFormElement>('#editor')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;
const controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
let revision = '';
let dirty = false;
const endpoint = (path: string) => new URL(path, location.href).href;
for (const [section, title] of [
  ['business', 'Business Information'],
  ['personal', 'Personal Information'],
  ['design', 'Card Design (Optional)'],
]) {
  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = title!;
  fieldset.append(legend);
  for (const spec of fullFieldSpecs.filter((s) => s.section === section)) {
    const label = document.createElement('label');
    label.textContent = `${spec.label}${spec.optional ? ' (Optional)' : ''}`;
    label.lang = 'en';
    const control = spec.options
      ? document.createElement('select')
      : document.createElement('input');
    control.name = spec.key;
    control.autocomplete = 'off';
    if (control instanceof HTMLSelectElement) {
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = spec.optional ? 'Use current selection' : 'Select';
      control.append(blank);
      for (const value of spec.options!) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent =
          spec.kind === 'checkbox' ? (value === 'yes' ? 'Yes' : 'No') : value;
        control.append(o);
      }
    } else {
      control.type = spec.kind === 'password' ? 'password' : 'text';
      control.maxLength = spec.max;
      control.spellcheck = false;
      if (['phone', 'zip', 'digits', 'tax', 'ssn'].includes(spec.format ?? ''))
        control.inputMode = 'numeric';
      if (spec.format === 'money') control.inputMode = 'decimal';
      if (spec.format === 'date') control.placeholder = 'MM-DD-YYYY';
    }
    label.append(control);
    fieldset.append(label);
    controls.set(spec.key, control);
  }
  document.querySelector('#fields')!.append(fieldset);
}
function values() {
  return Object.fromEntries([...controls].map(([key, c]) => [key, c.value]));
}
function refresh() {
  const v = values();
  for (const [key, c] of controls) {
    const skip =
      (key === 'companyDBAName' && v.doingBusinessAs === 'yes') ||
      (key === 'federalTaxId' &&
        v.companyStructure === 'Sole Proprietorship') ||
      (['addressLine1', 'addressLine2', 'zipCode', 'city', 'state'].includes(
        key,
      ) &&
        v.sameAddress === 'yes');
    c.disabled = skip;
    c.parentElement!.hidden = skip;
  }
  const industry = controls.get('industryType') as HTMLSelectElement;
  for (const o of industry.options)
    o.disabled =
      v.companyStructure === 'Sole Proprietorship' &&
      ['Government Entity', 'Insurance Services', 'Non-profit'].includes(
        o.value,
      );
}
form.addEventListener('input', () => {
  dirty = true;
  refresh();
});
form.addEventListener('change', () => {
  dirty = true;
  refresh();
});
window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    save.disabled = true;
    try {
      const v = fullProfileSchema.parse(values());
      const issues = profileIssues(v);
      controls.forEach((c) => c.removeAttribute('aria-invalid'));
      if (issues.length) {
        status.textContent = issues
          .map(
            (i) =>
              `${fullFieldSpecs.find((s) => s.key === i.field)!.label}: ${i.reason === 'required' ? '入力してください' : i.reason === 'inconsistent' ? '事業形態と選択肢を確認してください' : '形式を確認してください'}`,
          )
          .join('\n');
        issues.forEach((i) =>
          controls.get(i.field)?.setAttribute('aria-invalid', 'true'),
        );
        controls.get(issues[0]!.field)?.focus();
        return;
      }
      const response = await fetch(endpoint('save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: v, revision }),
      });
      if (!response.ok) throw new Error('Save failed');
      dirty = false;
      controls.forEach((c) => (c.value = ''));
      form.hidden = true;
      status.textContent =
        '保管庫に保存しました。Finderに表示されたprofile.yamlをAmex申込ページの拡張機能から読み込んでください。読み込み後、TerminalでEnterを押すと保管庫を閉じます。このタブは閉じてかまいません。';
    } catch {
      status.textContent =
        '保存できませんでした。保管庫が開いているか、別の画面でファイルを変更していないか確認してください。入力内容はこの画面に残しています。';
    } finally {
      save.disabled = false;
    }
  })();
});
void (async () => {
  try {
    const response = await fetch(endpoint('profile'), { cache: 'no-store' });
    if (!response.ok) throw new Error('Load failed');
    const data = (await response.json()) as {
      values: unknown;
      revision: string;
    };
    const v = fullProfileSchema.parse(data.values);
    revision = data.revision;
    controls.forEach((c, key) => (c.value = v[key] ?? ''));
    refresh();
    save.disabled = false;
    status.textContent =
      '未登録の項目を入力し、「保管庫に保存」を押してください。';
  } catch {
    status.textContent =
      '読み込めませんでした。保管庫の登録ランチャーから開き直してください。';
  }
})();
