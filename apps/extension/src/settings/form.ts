import {
  fullFieldSpecs,
  type FullProfile,
  type FullFieldSpec,
} from '../full-profile.js';
import {
  hint,
  inactive,
  optionLabel,
  sections,
  sensitiveFields,
  unverifiedLabels,
  type FieldIssue,
  type Section,
} from './fields.js';
const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
export type FieldView = {
  spec: FullFieldSpec;
  wrapper: HTMLDivElement;
  controls: (HTMLInputElement | HTMLSelectElement)[];
  error: HTMLParagraphElement;
};
const order = [
  'email',
  'companyStructure',
  'legalBusinessName',
  'industryType',
  'businessNameOnCard',
  'yearsInBusiness',
  'doingBusinessAs',
  'companyDBAName',
  'businessAddressLine1',
  'businessAddressLine2',
  'businessCity',
  'businessState',
  'businessZipCode',
  'businessPhoneNumber',
  'numberOfEmployees',
  'annualBusinessRevenue',
  'estimatedMonthlySpend',
  'federalTaxId',
  'roleInCompany',
  'firstName',
  'lastName',
  'middleName',
  'nameOnCard',
  'cellPhone',
  'dateOfBirth',
  'ssn',
  'sameAddress',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'zipCode',
  'totalAnnualIncome',
  'nonTaxableAnnualIncome',
  'cardDesign',
  'cardMaterial',
];
export function buildFields(container: HTMLElement): Map<string, FieldView> {
  const views = new Map<string, FieldView>();
  for (const section of sections.filter((s) => s.id !== 'security')) {
    const panel = make('section', undefined, 'card panel');
    panel.id = `panel-${section.id}`;
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', `heading-${section.id}`);
    const heading = make('h2', section.title);
    heading.id = `heading-${section.id}`;
    heading.append(make('span', section.english));
    panel.append(heading, make('p', section.description, 'muted'));
    const note = make('div', undefined, 'source-note');
    note.append(
      make(
        'p',
        '英語ラベルは過去の申込画面の記録を参照しています。未確認の項目はその旨を表示しています。',
      ),
    );
    note.append(
      make(
        'p',
        '選択肢の一覧は実画面で未確認です。申込時に実際の選択肢をご確認ください。',
      ),
    );
    panel.append(note);
    const grid = make('div', undefined, 'field-grid');
    const specs = fullFieldSpecs
      .filter((s) => s.section === section.id)
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    for (const spec of specs) {
      const wrapper = make(
        'div',
        undefined,
        `field${spec.kind === 'checkbox' || spec.kind === 'radio' ? ' wide' : ''}`,
      );
      wrapper.dataset.field = spec.key;
      const label = make('label', spec.title);
      label.htmlFor = `field-${spec.key}`;
      const requirement = make(
        'span',
        spec.optional ? '任意' : '必須',
        `requirement ${spec.optional ? '' : 'required'}`,
      );
      if (spec.kind !== 'checkbox') label.append(requirement);
      label.append(make('span', spec.label, 'english'));
      wrapper.append(label);
      const description = make('p', hint(spec), 'hint');
      description.id = `hint-${spec.key}`;
      const error = make('p', undefined, 'field-error');
      error.id = `error-${spec.key}`;
      const controls: (HTMLInputElement | HTMLSelectElement)[] = [];
      if (spec.kind === 'radio') {
        label.id = `label-${spec.key}`;
        label.removeAttribute('for');
        const group = make('div', undefined, 'choice-group');
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-labelledby', label.id);
        for (const [index, value] of ['', ...spec.options!].entries()) {
          const choice = make('label');
          const control = make('input');
          control.type = 'radio';
          control.name = spec.key;
          control.value = value;
          control.id =
            index === 0 ? `field-${spec.key}` : `field-${spec.key}-${index}`;
          control.defaultChecked = index === 0;
          choice.append(
            control,
            document.createTextNode(value ? optionLabel(value) : '指定しない'),
          );
          group.append(choice);
          controls.push(control);
        }
        wrapper.append(group);
      } else if (spec.kind === 'select') {
        const control = make('select');
        control.id = `field-${spec.key}`;
        control.name = spec.key;
        const blank = make('option', '選択してください');
        blank.value = '';
        control.append(blank);
        for (const value of spec.options!) {
          const option = make('option', optionLabel(value));
          option.value = value;
          control.append(option);
        }
        wrapper.append(control);
        controls.push(control);
      } else {
        const control = make('input');
        control.id = `field-${spec.key}`;
        control.name = spec.key;
        control.type = sensitiveFields.has(spec.key)
          ? 'password'
          : spec.kind === 'checkbox'
            ? 'checkbox'
            : spec.key === 'email'
              ? 'email'
              : spec.kind === 'tel'
                ? 'tel'
                : 'text';
        control.autocomplete = 'off';
        control.spellcheck = false;
        if (control.type !== 'checkbox') {
          control.maxLength = spec.max;
          if (spec.format)
            control.inputMode = spec.format === 'money' ? 'decimal' : 'numeric';
        }
        if (spec.kind === 'checkbox') {
          label.classList.add('checkline');
          const text = make('span');
          while (label.firstChild) text.append(label.firstChild);
          label.append(control, text);
        } else if (sensitiveFields.has(spec.key)) {
          const secret = make('div', undefined, 'secret-input');
          const reveal = make('button', '表示', 'reveal quiet');
          reveal.type = 'button';
          reveal.dataset.for = control.id;
          reveal.setAttribute('aria-pressed', 'false');
          reveal.setAttribute('aria-label', `${spec.title}を表示`);
          secret.append(control, reveal);
          wrapper.append(secret);
        } else wrapper.append(control);
        controls.push(control);
      }
      if (unverifiedLabels.has(spec.key))
        wrapper.append(make('span', '実画面の英語表記は未確認', 'unverified'));
      for (const control of controls) {
        control.setAttribute(
          'aria-describedby',
          `${description.id} ${error.id}`,
        );
        control.required =
          !spec.optional && spec.kind !== 'checkbox' && spec.kind !== 'radio';
      }
      wrapper.append(description, error);
      grid.append(wrapper);
      views.set(spec.key, { spec, wrapper, controls, error });
    }
    panel.append(grid);
    container.append(panel);
  }
  return views;
}
export function readFields(
  views: Map<string, FieldView>,
  forSave = false,
): FullProfile {
  const values: FullProfile = {};
  for (const [key, view] of views) {
    const control = view.controls[0]!;
    values[key] =
      view.spec.kind === 'checkbox'
        ? (control as HTMLInputElement).checked
          ? 'yes'
          : 'no'
        : view.spec.kind === 'radio'
          ? (view.controls.find((c) => (c as HTMLInputElement).checked)
              ?.value ?? '')
          : control.value;
  }
  if (forSave)
    for (const key of Object.keys(values))
      if (inactive(key, values)) values[key] = '';
  return values;
}
export function writeFields(
  views: Map<string, FieldView>,
  profile: FullProfile,
  busy: boolean,
): void {
  for (const [key, view] of views)
    for (const control of view.controls) {
      if (view.spec.kind === 'checkbox')
        (control as HTMLInputElement).checked = profile[key] === 'yes';
      else if (view.spec.kind === 'radio')
        (control as HTMLInputElement).checked =
          control.value === (profile[key] ?? '');
      else control.value = profile[key] ?? '';
    }
  updateConditions(views, busy);
}
export function updateConditions(
  views: Map<string, FieldView>,
  busy: boolean,
): void {
  const values = readFields(views);
  for (const [key, view] of views) {
    const hidden = inactive(key, values);
    view.wrapper.hidden = hidden;
    for (const control of view.controls) {
      control.disabled = busy || hidden;
      control.required =
        !hidden &&
        !view.spec.optional &&
        !['checkbox', 'radio'].includes(view.spec.kind);
    }
    if (hidden) {
      view.error.textContent = '';
      for (const control of view.controls)
        control.removeAttribute('aria-invalid');
    }
  }
}
export function showFieldErrors(
  views: Map<string, FieldView>,
  issues: FieldIssue[],
  summary: HTMLElement,
  selectSection: (section: Section) => void,
): void {
  for (const view of views.values()) {
    view.error.textContent = '';
    for (const control of view.controls)
      control.removeAttribute('aria-invalid');
  }
  summary.replaceChildren();
  summary.hidden = issues.length === 0;
  if (!issues.length) return;
  summary.append(make('strong', `${issues.length}項目を確認してください。`));
  const list = make('ul');
  for (const issue of issues) {
    const view = views.get(issue.field);
    if (!view) continue;
    const message =
      issue.reason === 'required'
        ? '入力または選択してください。'
        : issue.reason === 'inconsistent'
          ? '事業形態と業種の組み合わせを確認してください。'
          : `入力形式を確認してください。${hint(view.spec)}`;
    view.error.textContent = message;
    for (const control of view.controls)
      control.setAttribute('aria-invalid', 'true');
    const row = make('li');
    const link = make('button', view.spec.title);
    link.type = 'button';
    link.addEventListener('click', () => {
      selectSection(view.spec.section);
      view.controls[0]!.focus();
    });
    row.append(link);
    list.append(row);
  }
  summary.append(list);
  summary.focus();
}
