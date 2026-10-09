import {
  fieldSpecs,
  profileSchema,
  storedProfileSchema,
  profileKey,
} from './profile.js';
import { runAutofill } from './autofill.js';
import { runFullAutofill } from './full-autofill.js';
import { fullFieldSpecs, profileIssues } from './full-profile.js';
import { classifyTarget, type TargetKind } from './target.js';
import {
  nativeStateKey,
  nativeStateSchema,
  nativeStatusText,
} from './native-vault.js';
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
let target:
  | { tabId: number; documentId: string; kind: TargetKind; url: string }
  | undefined;
let busy = false;
let vaultMode = false;
let nativeLoading = false;
const nativeStatus = document.querySelector<HTMLElement>('#native-status')!;
const fileInput = document.querySelector<HTMLInputElement>('#vault-file')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;
const lock = document.querySelector<HTMLButtonElement>('#lock')!;
function refreshControls() {
  const disabled = busy || nativeLoading;
  buttons.forEach((button) => (button.disabled = disabled));
  fileInput.disabled = disabled;
  save.disabled = disabled || vaultMode;
  lock.disabled = disabled || !vaultMode;
  fill.disabled =
    disabled || !target || (target.kind === 'amex' ? !vaultMode : vaultMode);
  inputs.forEach((input) => {
    input.readOnly = vaultMode || disabled;
    input.type = vaultMode ? 'password' : 'text';
  });
}
function displayProfile(profile: Record<string, string>) {
  inputs.forEach((input, key) => {
    input.value = profile[key] ?? '';
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
  matched: '登録内容と一致',
  conditional: '選択条件により入力不要',
  'not-present': '現在は未表示（住所入力後に確認）',
  'address-review': '住所候補の確認が必要',
  filled: '入力済み',
  missing: '見つかりません',
  ambiguous: '候補が複数',
  mismatch: '属性が一致しません',
  unavailable: '非表示・無効',
  'existing-value': '既存値を保持',
  'no-value': '指定なし',
  'invalid-value': '入力条件に不適合',
  changed: '画面が変更されました',
  'validation-error': 'ページの入力エラーを確認してください',
  failed: '失敗',
};
function showResult(
  result:
    | Awaited<ReturnType<typeof runAutofill>>
    | Awaited<ReturnType<typeof runFullAutofill>>
    | undefined,
) {
  results.replaceChildren();
  if (!result || result.state !== 'ok') throw new Error('Blocked');
  for (const field of result.fields) {
    const label = fullFieldSpecs.find(
      (spec) => spec.key === field.field,
    )?.title;
    if (!label || !statusText[field.status]) throw new Error('Invalid result');
    const li = document.createElement('li');
    li.textContent = `${label}: ${statusText[field.status]}`;
    results.append(li);
  }
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const kind = classifyTarget(tab?.url);
  if (tab?.id === undefined || !tab.url || !kind) throw new Error('Blocked');
  return { tabId: tab.id, kind, url: tab.url };
}
async function action(work: () => Promise<void>) {
  if (busy || nativeLoading) return;
  busy = true;
  refreshControls();
  try {
    await work();
  } catch {
    target = undefined;
    results.replaceChildren();
    message.textContent =
      '操作できませんでした。対象の申込ページまたは模擬フォームを開き、再検出してください。';
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
      await chrome.storage.session.remove([sessionProfileKey, nativeStateKey]);
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
      const selected = await activeTab();
      const [injection] =
        selected.kind === 'amex'
          ? await chrome.scripting.executeScript({
              target: { tabId: selected.tabId, frameIds: [0] },
              world: 'ISOLATED',
              func: runFullAutofill,
              args: [{ command: { action: 'inspect' }, specs: fullFieldSpecs }],
            })
          : await chrome.scripting.executeScript({
              target: { tabId: selected.tabId, frameIds: [0] },
              world: 'ISOLATED',
              func: runAutofill,
              args: [{ action: 'inspect' }],
            });
      showResult(injection?.result);
      if (!injection?.documentId) throw new Error('Missing document');
      target = { ...selected, documentId: injection.documentId };
      message.textContent =
        selected.kind === 'amex'
          ? vaultMode
            ? 'Amex申込ページを検出しました。「Amexへ入力」を押すと、読み込んだ本人情報を空欄へ渡します。ページが情報を送信する場合があります。'
            : 'Amex申込ページを検出しました。保管庫のprofile.yamlを読み込んでから、再検出してください。'
          : vaultMode
            ? '検出しました。本人情報は模擬フォームへ入力しません。'
            : '検出しました。Fill Nowで入力可能な空欄だけに現在の入力内容を反映します。';
      fill.textContent =
        selected.kind === 'amex' ? 'Amexへ入力（申込送信なし）' : 'Fill Now';
    }),
);
fill.addEventListener(
  'click',
  () =>
    void action(async () => {
      const selected = target;
      target = undefined;
      const current = await activeTab();
      if (
        !selected ||
        selected.tabId !== current.tabId ||
        selected.url !== current.url
      )
        throw new Error('Changed tab');
      if (selected.kind === 'amex' ? !vaultMode : vaultMode)
        throw new Error('Blocked');
      // Read the trusted session again, so cleared/replaced data cannot be sent from stale UI.
      const profile =
        selected.kind === 'amex'
          ? sessionProfileSchema.parse(
              (await chrome.storage.session.get(sessionProfileKey))[
                sessionProfileKey
              ],
            ).values
          : values();
      if (selected.kind === 'amex') {
        const issues = profileIssues(profile);
        if (issues.length) {
          message.textContent =
            '保管庫の登録が不足、または形式が違います。登録画面で確認してください。';
          results.replaceChildren();
          for (const issue of issues) {
            const li = document.createElement('li');
            li.textContent = fullFieldSpecs.find(
              (s) => s.key === issue.field,
            )!.title;
            results.append(li);
          }
          return;
        }
      }
      const command = {
        action: 'fill',
        source: selected.kind === 'amex' ? 'vault-file' : 'local-test',
        expectedUrl: selected.url,
        values: profile,
      };
      const [injection] =
        selected.kind === 'amex'
          ? await chrome.scripting.executeScript({
              target: {
                tabId: selected.tabId,
                documentIds: [selected.documentId],
              },
              world: 'ISOLATED',
              func: runFullAutofill,
              args: [{ command, specs: fullFieldSpecs }],
            })
          : await chrome.scripting.executeScript({
              target: {
                tabId: selected.tabId,
                documentIds: [selected.documentId],
              },
              world: 'ISOLATED',
              func: runAutofill,
              args: [command],
            });
      showResult(injection?.result);
      message.textContent =
        '処理が終わりました。項目ごとの結果と申込画面を確認してください。申込送信はしていません。';
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
      await chrome.storage.session.remove([sessionProfileKey, nativeStateKey]);
      const profile =
        file && file.size <= maxProfileBytes
          ? parseVaultProfile(await file.text())
          : undefined;
      if (!profile) {
        message.textContent =
          '読み込めません。保管庫の登録画面で保存したprofile.yamlを選択してください。値やファイル名は記録しません。';
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
        '申込情報をメモリに読み込みました。Amex申込ページでフォームを検出してください。';
    }),
);
lock.addEventListener(
  'click',
  () =>
    void action(async () => {
      await chrome.storage.session.remove([sessionProfileKey, nativeStateKey]);
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
  if (area !== 'session') return;
  if (Object.hasOwn(changes, nativeStateKey)) {
    showNativeState(changes[nativeStateKey]?.newValue);
    refreshControls();
  }
  if (!Object.hasOwn(changes, sessionProfileKey)) return;
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

function showNativeState(value: unknown) {
  const parsed = nativeStateSchema.safeParse(value);
  nativeLoading = parsed.success && parsed.data.status === 'loading';
  nativeStatus.textContent = parsed.success
    ? nativeStatusText[parsed.data.status]
    : 'パスワード入力だけで読み込みます。ファイル選択とTerminal操作は不要です。';
}
async function startNativeLoad() {
  const selected = await activeTab();
  if (selected.kind !== 'amex') {
    message.textContent =
      '保管庫の自動読み込みはAmex申込ページで使ってください。';
    return;
  }
  target = undefined;
  results.replaceChildren();
  const response: unknown = await chrome.runtime.sendMessage({
    type: 'load-vault',
  });
  if (
    !response ||
    typeof response !== 'object' ||
    !('accepted' in response) ||
    response.accepted !== true
  )
    message.textContent =
      '読み込みを開始できませんでした。申込ページで再試行してください。';
}
document
  .querySelector('#unlock-vault')!
  .addEventListener('click', () => void action(startNativeLoad));

void action(async () => {
  await chrome.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  await chrome.storage.session.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  const memory = await chrome.storage.session.get([
    sessionProfileKey,
    nativeStateKey,
  ]);
  const session = memory[sessionProfileKey];
  showNativeState(memory[nativeStateKey]);
  if (session !== undefined) {
    vaultMode = true;
    const profile = sessionProfileSchema.parse(session);
    displayProfile(profile.values);
    message.textContent =
      'メモリの本人情報を再利用します。Amex申込ページでフォームを検出してください。';
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
  // Only an actual toolbar popup auto-starts. Extension tabs/test fixtures do not.
  if (
    memory[nativeStateKey] === undefined &&
    chrome.extension.getViews({ type: 'popup' }).includes(window)
  ) {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (classifyTarget(tab?.url) === 'amex') await startNativeLoad();
  }
});
