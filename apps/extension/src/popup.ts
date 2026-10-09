import {
  fieldSpecs,
  profileSchema,
  storedProfileSchema,
  profileKey,
} from './profile.js';
import { runAutofill } from './autofill.js';
import {
  maxProfileBytes,
  parseVaultProfile,
  sessionProfileKey,
  sessionProfileSchema,
} from './vault-profile.js';

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
let vaultMode = false;
const fileInput = document.querySelector<HTMLInputElement>('#vault-file')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;
const lock = document.querySelector<HTMLButtonElement>('#lock')!;
function refreshControls() {
  buttons.forEach((button) => (button.disabled = busy));
  fileInput.disabled = busy;
  save.disabled = busy || vaultMode;
  lock.disabled = busy || !vaultMode;
  fill.disabled = busy || !target || vaultMode;
  inputs.forEach((input) => {
    input.readOnly = vaultMode || busy;
    input.type = vaultMode ? 'password' : 'text';
  });
}
function displayProfile(profile: ReturnType<typeof profileSchema.parse>) {
  inputs.forEach((input, key) => {
    input.value = profile[key as keyof typeof profile];
  });
}

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
  refreshControls();
  try {
    await work();
  } catch {
    target = undefined;
    results.replaceChildren();
    message.textContent =
      '操作できませんでした。模擬フォームと入力内容を確認して、再検出してください。';
  } finally {
    busy = false;
    refreshControls();
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
      if (vaultMode) throw new Error('Blocked');
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
      await chrome.storage.session.remove(sessionProfileKey);
      vaultMode = false;
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
      message.textContent = vaultMode
        ? '検出しました。この版では本人情報を模擬フォームへ入力しません。'
        : '検出しました。Fill Nowで入力可能な空欄だけに現在の入力内容を反映します。';
    }),
);
fill.addEventListener(
  'click',
  () =>
    void action(async () => {
      if (vaultMode) throw new Error('Blocked');
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

fileInput.addEventListener(
  'change',
  () =>
    void action(async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      // Invalidate old session before attempting replacement; failures do not retain it.
      target = undefined;
      results.replaceChildren();
      inputs.forEach((input) => (input.value = ''));
      vaultMode = true;
      await chrome.storage.session.remove(sessionProfileKey);
      const profile =
        file && file.size <= maxProfileBytes
          ? parseVaultProfile(await file.text())
          : undefined;
      if (!profile) {
        message.textContent =
          '読み込めません。7項目・二重引用符・文字数を確認してください。値やファイル名は記録しません。';
        return;
      }
      await chrome.storage.session.setAccessLevel({
        accessLevel: 'TRUSTED_CONTEXTS',
      });
      await chrome.storage.session.set({
        [sessionProfileKey]: {
          version: 1,
          source: 'vault-file',
          values: profile,
        },
      });
      vaultMode = true;
      displayProfile(profile);
      message.textContent =
        '7項目の形式を確認し、メモリに読み込みました。模擬フォームへの入力と平文保存は無効です。';
    }),
);
lock.addEventListener(
  'click',
  () =>
    void action(async () => {
      await chrome.storage.session.remove(sessionProfileKey);
      inputs.forEach((input) => (input.value = ''));
      target = undefined;
      results.replaceChildren();
      vaultMode = false;
      message.textContent =
        'メモリの本人情報を削除しました。暗号化ファイルは変更しません。';
    }),
);
// Clear other open extension pages as soon as session data is removed/replaced.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !Object.hasOwn(changes, sessionProfileKey)) return;
  target = undefined;
  results.replaceChildren();
  inputs.forEach((input) => (input.value = ''));
  const parsed = sessionProfileSchema.safeParse(
    changes[sessionProfileKey]?.newValue,
  );
  vaultMode = parsed.success;
  if (parsed.success) displayProfile(parsed.data.values);
  refreshControls();
});

void action(async () => {
  await chrome.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  await chrome.storage.session.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  const session = (await chrome.storage.session.get(sessionProfileKey))[
    sessionProfileKey
  ];
  if (session !== undefined) {
    vaultMode = true;
    const profile = sessionProfileSchema.parse(session);
    displayProfile(profile.values);
    message.textContent =
      'メモリの本人情報を再利用します。模擬フォームへの入力と平文保存は無効です。';
    return;
  }
  const stored = (await chrome.storage.local.get(profileKey))[profileKey];
  if (stored !== undefined) {
    const profile = storedProfileSchema.parse(stored);
    inputs.forEach((input, key) => {
      input.value = profile.values[key as keyof typeof profile.values];
    });
    message.textContent = 'この端末の保存情報を読み込みました。';
  }
});
