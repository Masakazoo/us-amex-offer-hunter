import {
  fieldSpecs,
  profileSchema,
  storedProfileSchema,
  profileKey,
} from './profile.js';
import { runAutofill } from './autofill.js';

const form = document.querySelector<HTMLFormElement>('#profile')!;
const message = document.querySelector<HTMLElement>('#message')!;
const results = document.querySelector<HTMLElement>('#results')!;
const fill = document.querySelector<HTMLButtonElement>('#fill')!;
const buttons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('button'),
);
const inputs = new Map<string, HTMLInputElement>();
let target: { tabId: number; documentId: string } | undefined;
let busy = false;

for (const [key, label, max] of fieldSpecs) {
  const wrapper = document.createElement('label');
  wrapper.textContent = label;
  const input = document.createElement('input');
  input.name = key;
  input.type = 'text';
  input.maxLength = max;
  input.autocomplete = 'off';
  input.spellcheck = false;
  wrapper.append(input);
  form.append(wrapper);
  inputs.set(key, input);
}
form.addEventListener('submit', (event) => event.preventDefault());

const statusText: Record<string, string> = {
  ready: '入力可能',
  filled: '入力済み',
  missing: '見つかりません',
  ambiguous: '候補が複数',
  mismatch: '属性が一致しません',
  unavailable: '非表示・無効',
  'existing-value': '既存値を保持',
  'no-value': '指定なし',
  'invalid-value': '入力条件に不適合',
  changed: '画面が変更されました',
  failed: '失敗',
};
function showResult(result: ReturnType<typeof runAutofill> | undefined) {
  results.replaceChildren();
  if (!result || result.state !== 'ok') throw new Error('Blocked');
  for (const field of result.fields) {
    const label = fieldSpecs.find((spec) => spec[0] === field.field)?.[1];
    if (!label || !statusText[field.status]) throw new Error('Invalid result');
    const li = document.createElement('li');
    li.textContent = `${label}: ${statusText[field.status]}`;
    results.append(li);
  }
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (
    tab?.id === undefined ||
    tab.url !== 'http://127.0.0.1:4173/autofill-fixture'
  )
    throw new Error('Blocked');
  return tab.id;
}
async function action(work: () => Promise<void>) {
  if (busy) return;
  busy = true;
  buttons.forEach((b) => (b.disabled = true));
  try {
    await work();
  } catch {
    target = undefined;
    results.replaceChildren();
    message.textContent =
      '操作できませんでした。模擬フォームと入力内容を確認して、再検出してください。';
  } finally {
    busy = false;
    buttons.forEach((b) => (b.disabled = false));
    fill.disabled = !target;
  }
}
function values() {
  return profileSchema.parse(
    Object.fromEntries(
      Array.from(inputs, ([key, input]) => [key, input.value]),
    ),
  );
}
document.querySelector('#save')!.addEventListener(
  'click',
  () =>
    void action(async () => {
      await chrome.storage.local.set({
        [profileKey]: { version: 1, values: values() },
      });
      message.textContent = 'この端末に保存しました。次回も読み込まれます。';
    }),
);
document.querySelector('#delete')!.addEventListener(
  'click',
  () =>
    void action(async () => {
      await chrome.storage.local.remove(profileKey);
      inputs.forEach((input) => (input.value = ''));
      target = undefined;
      results.replaceChildren();
      message.textContent =
        '保存情報と入力欄を全削除しました。対象ページの既存値は変更しません。';
    }),
);
document.querySelector('#inspect')!.addEventListener(
  'click',
  () =>
    void action(async () => {
      target = undefined;
      const tabId = await activeTab();
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        world: 'ISOLATED',
        func: runAutofill,
        args: [{ action: 'inspect' }],
      });
      showResult(injection?.result);
      if (!injection?.documentId) throw new Error('Missing document');
      target = { tabId, documentId: injection.documentId };
      message.textContent =
        '検出しました。Fill Nowで入力可能な空欄だけに現在の入力内容を反映します。';
    }),
);
fill.addEventListener(
  'click',
  () =>
    void action(async () => {
      const selected = target;
      target = undefined;
      if (!selected || selected.tabId !== (await activeTab()))
        throw new Error('Changed tab');
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: selected.tabId, documentIds: [selected.documentId] },
        world: 'ISOLATED',
        func: runAutofill,
        args: [{ action: 'fill', values: values() }],
      });
      showResult(injection?.result);
      message.textContent =
        '処理が終わりました。項目ごとの結果を確認してください。';
    }),
);

void action(async () => {
  await chrome.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  const stored = (await chrome.storage.local.get(profileKey))[profileKey];
  if (stored !== undefined) {
    const profile = storedProfileSchema.parse(stored);
    inputs.forEach((input, key) => {
      input.value = profile.values[key as keyof typeof profile.values];
    });
    message.textContent = 'この端末の保存情報を読み込みました。';
  }
});
