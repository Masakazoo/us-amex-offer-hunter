import type { View } from './autofill-controller.js';
import { labels } from './settings/fields.js';
const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => byId<HTMLInputElement>(id);
const button = (id: string) => byId<HTMLButtonElement>(id);
let view: View | null = null;
let generation = 0;
let pending = false,
  refreshing = false,
  alive = true,
  composing = false;
const statusNames: Record<string, string> = {
  filled: '入力済み',
  matched: '一致済み',
  'existing-value': '既存値を保持・要確認',
  conditional: '条件により不要',
  'not-present': '未表示',
  missing: '未表示',
  ready: '未処理',
  'no-value': '登録値なし',
  ambiguous: '候補が複数・要確認',
  mismatch: '形式が不一致',
  unavailable: '非表示・無効',
  'invalid-value': '登録値の形式を確認',
  changed: '画面が変更されました',
  'validation-error': '入力エラーを確認',
  failed: '入力失敗',
  'address-review': '住所候補を確認',
};
const messages: Record<string, string> = {
  AUTH_OR_CORRUPT: 'パスワードが違うか、登録情報を開けません。',
  RATE_LIMITED: '少し待ってから再入力してください。',
  LOCKED: 'ロックされています。解除してから再実行してください。',
  NOT_REGISTERED: 'プロフィールを登録してください。',
  CONFLICT: '状態が変わりました。確認後に再実行してください。',
  CANCELLED: '対象ページまたは解除状態が変わりました。',
  STORAGE_WRITE: '状態を保存できません。拡張を再読み込みして確認してください。',
  UNSUPPORTED_VERSION: 'この登録情報は開けません。設定画面で確認してください。',
};
function notice(text: string, error = false) {
  byId('message').textContent = text;
  byId('message').dataset.error = String(error);
}
async function request(op: Record<string, unknown>, channel = 'autofill-v1') {
  const reply = await chrome.runtime.sendMessage({ channel, ...op });
  if (!reply?.ok)
    throw new Error(
      messages[reply?.error as string] ??
        '状態を確認できません。対象ページと設定を確認してください。',
    );
  return reply;
}
function render() {
  const busy = pending || !!view?.busy,
    status = view?.status,
    target = !!view?.target;
  byId('target-state').textContent = target
    ? '対応する申込フォームを検出しました'
    : '対応するAmex申込ページで使用してください';
  byId('vault-state').textContent = view?.unlocking
    ? '解除中…'
    : view?.busy
      ? '入力・選択・検証中…'
      : !status
        ? '確認中'
        : !status.registered
          ? '未登録'
          : status.unlocked
            ? '解除済み'
            : 'ロック中';
  byId('register').hidden = !status || status.registered;
  byId('unlock-form').hidden =
    !target || !status?.registered || status.unlocked || !!view?.busy;
  button('fill').hidden = !target || !status?.unlocked || !!view?.busy;
  button('fill').textContent = view?.run ? '再実行' : '自動入力';
  button('lock').hidden = !status?.unlocked && !view?.busy;
  button('cancel').hidden = !view?.busy || !!view.unlocking;
  for (const node of document.querySelectorAll<
    HTMLInputElement | HTMLButtonElement
  >('input,button'))
    node.disabled = busy;
  // A running job must remain stoppable from a reopened popup.
  button('cancel').disabled = pending;
  button('lock').disabled = pending;
  button('settings').disabled = pending;
  const run = view?.run;
  byId('outcome').hidden = !run;
  if (run) {
    byId('phase').textContent = {
      running: '入力・検証中',
      completed: '処理が完了しました',
      cancelled: '入力を停止しました',
      interrupted: '処理が中断されました。再検証して再実行してください。',
      failed: '処理できませんでした。解除状態とページを確認してください。',
      uncertain:
        '入力結果を保存できませんでした。ページの内容を確認してください。',
    }[run.phase];
    const count = (codes: string[]) =>
      run.fields.filter((f) => codes.includes(f.status)).length;
    byId('summary').textContent =
      `入力済み ${count(['filled'])} / 一致済み ${count(['matched'])} / 条件により不要 ${count(['conditional'])} / 未表示 ${count(['missing', 'not-present'])} / 要確認 ${count(['existing-value', 'address-review', 'ambiguous', 'no-value'])} / 失敗 ${count(['mismatch', 'unavailable', 'invalid-value', 'changed', 'validation-error', 'failed'])}`;
    byId('results').replaceChildren(
      ...run.fields.map((f) => {
        const li = document.createElement('li');
        li.textContent = `${labels.get(f.field) ?? f.field}: ${statusNames[f.status]}`;
        return li;
      }),
    );
  } else {
    byId('results').replaceChildren();
    byId('phase').textContent = '';
    byId('summary').textContent = '';
  }
}
async function refresh() {
  if (refreshing || !alive || pending) return;
  refreshing = true;
  const accepted = generation;
  try {
    const reply = await request({ op: 'view' });
    if (alive && accepted === generation) {
      view = reply.view as View;
      render();
    }
  } catch (error) {
    if (alive && accepted === generation) {
      view = null;
      render();
      notice(
        error instanceof Error ? error.message : '状態を確認できません。',
        true,
      );
    }
  } finally {
    refreshing = false;
  }
}
async function perform(work: () => Promise<void>) {
  if (pending) return;
  pending = true;
  ++generation;
  view = null;
  render();
  notice('');
  try {
    await work();
  } catch (error) {
    if (alive)
      notice(
        error instanceof Error ? error.message : '処理結果を確認できません。',
        true,
      );
  } finally {
    pending = false;
    if (alive) {
      await refresh();
      render();
    }
  }
}
button('settings').onclick = () => void chrome.runtime.openOptionsPage();
button('register').onclick = () => void chrome.runtime.openOptionsPage();
input('password').addEventListener('compositionstart', () => {
  composing = true;
});
input('password').addEventListener('compositionend', () => {
  composing = false;
});
byId<HTMLFormElement>('unlock-form').onsubmit = (event) => {
  event.preventDefault();
  if (pending || composing) return;
  const password = input('password').value,
    keep = input('keep').checked;
  input('password').value = '';
  if (!password) {
    notice('パスワードを入力してください。', true);
    return;
  }
  void perform(async () => {
    await request({ op: 'unlock', password, keep }, 'profile-vault-v1');
    notice('解除しました。「自動入力」で空欄へ入力します。');
  });
};
button('fill').onclick = () => {
  if (!view?.target || !view.status?.unlocked || view.busy || pending) return;
  const selected = view;
  void perform(async () => {
    await request({
      op: 'start',
      ...selected.target,
      revision: selected.status!.revision,
      epoch: selected.status!.epoch,
      operationId: crypto.randomUUID(),
    });
  });
};
button('lock').onclick = () =>
  void perform(async () => {
    input('password').value = '';
    await request({ op: 'lock' }, 'profile-vault-v1');
    notice('ロックしました。');
  });
button('cancel').onclick = () =>
  void perform(async () => {
    await request({ op: 'cancel' });
    notice('停止を要求しました。入力済みの内容はページで確認してください。');
  });
window.addEventListener('pagehide', () => {
  alive = false;
  input('password').value = '';
  clearInterval(timer);
});
const timer = setInterval(() => void refresh(), 500);
void refresh();
