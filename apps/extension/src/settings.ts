import { fullProfileSchema } from './full-profile.js';
import { passwordValid, type ErrorCode } from './vault/crypto.js';
import type { Status } from './vault/service.js';
import type { VaultReply } from './vault/protocol.js';
import { sections, validateProfile, type Section } from './settings/fields.js';
import {
  buildFields,
  readFields,
  showFieldErrors,
  updateConditions,
  writeFields,
} from './settings/form.js';

const element = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const button = (id: string) => element<HTMLButtonElement>(id);
const form = element<HTMLFormElement>('profile-form');
const unlockForm = element<HTMLFormElement>('unlock-form');
const views = buildFields(element('profile-panels'));
const passwordIds = [
  'unlock-password',
  'new-password',
  'confirm-password',
  'change-password',
  'change-confirm',
];
let status: Status | null = null;
let credentials: { revision: string; epoch: string } | null = null;
let creating = false,
  dirty = false,
  busy = false,
  guarded = true,
  unavailable = false,
  recovery = false,
  alive = true,
  pendingRefresh = false;
let selected: Section = 'business';
let generation = 0,
  refreshNumber = 0;
class RequestError extends Error {
  constructor(readonly code: ErrorCode | 'CONNECTION') {
    super(code);
  }
}
const errorMessages: Record<ErrorCode | 'CONNECTION', string> = {
  NOT_REGISTERED: '登録情報が見つかりません。新しく登録してください。',
  LOCKED: 'ロックされました。もう一度解除してください。',
  AUTH_OR_CORRUPT:
    'パスワードが違うか、保存データを読み取れません。入力を確認してください。',
  INVALID_INPUT: '入力内容を確認してください。',
  UNSUPPORTED_VERSION:
    'このバージョンでは保存データを開けません。対応するバージョンの拡張を使用してください。',
  CONFLICT:
    '別の画面で登録情報または解除状態が変更されました。もう一度開いて確認してください。',
  UNAUTHORIZED: 'この画面から操作できません。拡張の設定を開き直してください。',
  STORAGE_READ:
    '保存データの状態を確認できません。時間をおいて状態を再確認してください。',
  STORAGE_WRITE:
    '保存領域の操作を確認できませんでした。拡張を再読み込みしてください。',
  COMMIT_UNKNOWN:
    '保存・削除の結果を確認できません。もう一度解除し、保存された内容を確認してください。パスワード変更後は新しいパスワードを試し、解除できない場合は以前のパスワードをお試しください。',
  CANCELLED:
    '操作はロックまたは別の操作により中断されました。状態を確認してください。',
  RATE_LIMITED:
    '解除を続けて試しています。1秒ほど待ってから、もう一度お試しください。',
  CONNECTION:
    '拡張からの応答を確認できません。操作が完了している場合があります。設定を開き直し、登録内容を確認してください。',
};
async function request(
  payload: Record<string, unknown>,
): Promise<Extract<VaultReply, { ok: true }>> {
  let reply: VaultReply;
  try {
    reply = (await chrome.runtime.sendMessage({
      channel: 'profile-vault-v1',
      ...payload,
    })) as VaultReply;
  } catch {
    throw new RequestError('CONNECTION');
  }
  if (!reply || typeof reply.ok !== 'boolean')
    throw new RequestError('CONNECTION');
  if (!reply.ok)
    throw new RequestError(
      reply.error in errorMessages ? reply.error : 'CONNECTION',
    );
  return reply;
}
async function fetchStatus(): Promise<Status> {
  const reply = await request({ op: 'status' });
  if (!reply.status) throw new RequestError('CONNECTION');
  return reply.status;
}
function notice(text: string, tone: 'info' | 'success' | 'error' = 'info') {
  const node = element('notice');
  node.textContent = text;
  node.dataset.tone = tone;
  node.hidden = !text;
}
function maskSecrets() {
  for (const reveal of document.querySelectorAll<HTMLButtonElement>(
    '.reveal',
  )) {
    const target = input(reveal.dataset.for!);
    target.type = 'password';
    reveal.textContent = '表示';
    reveal.setAttribute('aria-pressed', 'false');
    const title = target.name
      ? views.get(target.name)?.spec.title
      : 'パスワード';
    reveal.setAttribute('aria-label', `${title}を表示`);
  }
}
function clearPasswords() {
  for (const id of passwordIds) input(id).value = '';
  maskSecrets();
}
function wipe() {
  ++generation;
  credentials = null;
  creating = false;
  dirty = false;
  form.reset();
  clearPasswords();
  for (const id of [
    'new-password-error',
    'change-password-error',
    'unlock-error',
  ])
    element(id).textContent = '';
  showFieldErrors(views, [], element('error-summary'), selectSection);
  updateConditions(views);
}
function adopt(next: Status) {
  if (
    credentials &&
    (!next.unlocked ||
      next.revision !== credentials.revision ||
      next.epoch !== credentials.epoch)
  ) {
    wipe();
    notice(
      '解除状態または登録情報が変わったため、編集中の内容を消去しました。',
    );
  }
  if (creating && next.registered) wipe();
  status = next;
  unavailable = false;
  if (!next.registered) creating = true;
}
function render() {
  const editing = credentials !== null;
  const canEdit = creating || editing;
  element('vault-status').textContent = recovery
    ? '再読み込みが必要'
    : unavailable
      ? '確認できません'
      : !status
        ? '確認中'
        : !status.registered
          ? '未登録'
          : status.unlocked
            ? '解除済み'
            : 'ロック中';
  element('vault-status').dataset.state = editing ? 'editing' : '';
  const conceal = guarded || document.hidden || recovery;
  form.hidden = !canEdit || conceal;
  element('unlock-panel').hidden =
    canEdit || !status?.registered || conceal || unavailable;
  element('unlock-description').textContent = status?.unlocked
    ? '解除済みです。内容を表示して編集できます。'
    : 'パスワードでロックを解除してください。';
  unlockForm.hidden = !!status?.unlocked;
  button('open-editor').hidden = !status?.unlocked;
  button('lock').hidden = !status?.unlocked;
  element('unavailable-panel').hidden = !unavailable || recovery;
  element('recovery').hidden = !recovery;
  element('checking').hidden = !guarded || recovery || document.hidden;
  element('data-management').hidden =
    selected !== 'security' || recovery || !(status?.registered || unavailable);
  element('new-password-panel').hidden = !creating;
  element('change-password-panel').hidden = !editing;
  element('save-first').hidden = !dirty;
  for (const section of sections) {
    element(`panel-${section.id}`).hidden = selected !== section.id;
    const nav = button(`nav-${section.id}`);
    if (selected === section.id) nav.setAttribute('aria-current', 'page');
    else nav.removeAttribute('aria-current');
  }
  for (const node of document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLSelectElement
  >('button,input,select')) {
    if (node.closest('#reset-dialog')) continue;
    node.disabled = busy;
  }
  updateConditions(views);
  if (busy)
    for (const node of form.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >('input,select'))
      node.disabled = true;
  button('change-password-submit').disabled = busy || dirty || !editing;
  button('save-profile').disabled = busy || (!creating && !dirty) || !canEdit;
  button('confirm-reset').disabled =
    busy || !input('reset-acknowledge').checked;
  element('draft-status').textContent = busy
    ? '処理中…'
    : dirty
      ? '未保存の変更があります'
      : creating
        ? '新規登録'
        : '保存済み';
  element('save-help').textContent = creating
    ? '情報を入力し、セキュリティでパスワードを設定してください。'
    : '保存するとロックされ、画面の入力内容が消去されます。';
  form.setAttribute('aria-busy', String(busy));
}
function selectSection(section: Section) {
  selected = section;
  render();
}
for (const [index, section] of sections.entries()) {
  const nav = document.createElement('button');
  nav.type = 'button';
  nav.id = `nav-${section.id}`;
  const number = document.createElement('span');
  number.textContent = String(index + 1).padStart(2, '0');
  number.setAttribute('aria-hidden', 'true');
  nav.append(number, document.createTextNode(section.title));
  nav.addEventListener('click', () => selectSection(section.id));
  element('sections').append(nav);
}
function handleError(error: unknown, checkingStatus = false) {
  const code = error instanceof RequestError ? error.code : 'CONNECTION';
  const corruptStatus =
    code === 'AUTH_OR_CORRUPT' && (checkingStatus || !status?.registered);
  wipe();
  guarded = false;
  notice(
    corruptStatus
      ? '保存データの形式を確認できません。データは変更していません。セキュリティから初期化することもできます。'
      : errorMessages[code],
    'error',
  );
  if (code === 'STORAGE_WRITE') {
    recovery = true;
    unavailable = false;
    status = null;
  } else if (
    [
      'UNSUPPORTED_VERSION',
      'STORAGE_READ',
      'UNAUTHORIZED',
      'CONNECTION',
    ].includes(code) ||
    corruptStatus
  ) {
    unavailable = true;
    status = null;
  } else if (status?.registered)
    status = { ...status, unlocked: false, epoch: null };
  if (
    [
      'COMMIT_UNKNOWN',
      'CONFLICT',
      'NOT_REGISTERED',
      'LOCKED',
      'CANCELLED',
      'AUTH_OR_CORRUPT',
    ].includes(code) &&
    !corruptStatus
  )
    pendingRefresh = true;
  if (code === 'AUTH_OR_CORRUPT' && !corruptStatus) {
    element('unlock-error').textContent = errorMessages[code];
    input('unlock-password').setAttribute('aria-invalid', 'true');
  }
  render();
}
async function reconcile() {
  if (!alive || recovery) return;
  if (busy) {
    pendingRefresh = true;
    return;
  }
  const run = ++refreshNumber;
  guarded = true;
  render();
  try {
    const next = await fetchStatus();
    if (!alive || run !== refreshNumber) return;
    adopt(next);
    guarded = false;
    render();
  } catch (error) {
    if (alive && run === refreshNumber) handleError(error, true);
  }
}
async function perform(operation: () => Promise<void>) {
  if (busy || recovery) return;
  busy = true;
  ++refreshNumber;
  pendingRefresh = false;
  render();
  try {
    await operation();
  } catch (error) {
    if (alive) handleError(error);
  } finally {
    busy = false;
    if (alive) {
      guarded = false;
      render();
      if (pendingRefresh) {
        pendingRefresh = false;
        await reconcile();
      }
    }
  }
}
async function loadEditor() {
  const next = await fetchStatus();
  if (!next.unlocked || !next.revision || !next.epoch)
    throw new RequestError('LOCKED');
  const ticket = generation;
  const reply = await request({
    op: 'readForEditing',
    revision: next.revision,
    epoch: next.epoch,
  });
  const latest = await fetchStatus();
  if (!alive || ticket !== generation || document.hidden) return;
  if (
    !latest.unlocked ||
    latest.revision !== next.revision ||
    latest.epoch !== next.epoch
  )
    throw new RequestError('CONFLICT');
  const profile = fullProfileSchema.safeParse(reply.profile);
  if (!profile.success) throw new RequestError('AUTH_OR_CORRUPT');
  writeFields(views, profile.data);
  credentials = { revision: next.revision, epoch: next.epoch };
  creating = false;
  dirty = false;
  status = latest;
  unavailable = false;
  guarded = false;
  notice('');
  render();
}
function passwordPair(
  first: string,
  confirm: string,
  errorId: string,
): string | null {
  const password = input(first).value;
  let message = '';
  if (!passwordValid(password, true))
    message = 'パスワードは12文字以上、1024文字以内で入力してください。';
  else if (password !== input(confirm).value)
    message = '確認用パスワードが一致しません。';
  element(errorId).textContent = message;
  input(first).setAttribute('aria-invalid', String(!!message));
  input(confirm).setAttribute('aria-invalid', String(!!message));
  if (message) {
    selectSection('security');
    input(first).focus();
    return null;
  }
  return password;
}
form.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement;
  if (views.has(target.name)) {
    dirty = true;
    updateConditions(views);
  }
  render();
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy || guarded || recovery || (!creating && !credentials)) return;
  const profile = readFields(views, true);
  const issues = validateProfile(profile);
  showFieldErrors(views, issues, element('error-summary'), selectSection);
  if (issues.length) return;
  const password = creating
    ? passwordPair('new-password', 'confirm-password', 'new-password-error')
    : null;
  if (creating && password === null) return;
  const payload: Record<string, unknown> = creating
    ? { op: 'create', profile, password }
    : { op: 'update', profile, ...credentials };
  void perform(async () => {
    wipe();
    render();
    await request(payload);
    if (!alive) return;
    adopt(await fetchStatus());
    notice('暗号化して保存しました。ロックされています。', 'success');
  });
});
unlockForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy) return;
  const password = input('unlock-password').value;
  if (!passwordValid(password, false)) {
    element('unlock-error').textContent = 'パスワードを入力してください。';
    return;
  }
  const keep = input('keep-unlocked').checked;
  clearPasswords();
  void perform(async () => {
    await request({ op: 'unlock', password, keep });
    if (alive) await loadEditor();
  });
});
button('open-editor').addEventListener('click', () => void perform(loadEditor));
button('lock').addEventListener(
  'click',
  () =>
    void perform(async () => {
      wipe();
      render();
      await request({ op: 'lock' });
      if (!alive) return;
      adopt(await fetchStatus());
      notice('ロックしました。画面の入力内容を消去しました。');
    }),
);
button('change-password-submit').addEventListener('click', () => {
  if (!credentials || dirty || busy) return;
  const password = passwordPair(
    'change-password',
    'change-confirm',
    'change-password-error',
  );
  if (password === null) return;
  const current = { ...credentials };
  clearPasswords();
  void perform(async () => {
    wipe();
    render();
    await request({ op: 'changePassword', ...current, password });
    if (!alive) return;
    adopt(await fetchStatus());
    notice(
      'パスワードを変更しました。新しいパスワードで解除してください。',
      'success',
    );
  });
});
const dialog = element<HTMLDialogElement>('reset-dialog');
button('reset-profile').addEventListener('click', () => {
  input('reset-acknowledge').checked = false;
  button('confirm-reset').disabled = true;
  dialog.showModal();
  button('cancel-reset').focus();
});
input('reset-acknowledge').addEventListener('change', () => {
  button('confirm-reset').disabled = !input('reset-acknowledge').checked;
});
button('cancel-reset').addEventListener('click', () => dialog.close());
button('confirm-reset').addEventListener('click', () => {
  if (!input('reset-acknowledge').checked || busy) return;
  dialog.close();
  void perform(async () => {
    wipe();
    render();
    await request({ op: 'reset', confirmed: true });
    if (!alive) return;
    adopt(await fetchStatus());
    selected = 'business';
    notice('登録情報を削除しました。新しく登録できます。', 'success');
  });
});
button('forgot-password').addEventListener('click', () => {
  selectSection('security');
  element('data-management').scrollIntoView({ block: 'center' });
});
button('refresh-status').addEventListener('click', () => void reconcile());
button('reload-extension').addEventListener('click', () => {
  wipe();
  chrome.runtime.reload();
});
document.addEventListener('click', (event) => {
  const reveal = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '.reveal',
  );
  if (!reveal || busy) return;
  const target = input(reveal.dataset.for!);
  const showing = target.type === 'password';
  target.type = showing ? 'text' : 'password';
  reveal.textContent = showing ? '隠す' : '表示';
  reveal.setAttribute('aria-pressed', String(showing));
  const title = target.name ? views.get(target.name)?.spec.title : 'パスワード';
  reveal.setAttribute('aria-label', `${title}を${showing ? '隠す' : '表示'}`);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (
    (area === 'local' &&
      ('encryptedProfileV1' in changes ||
        'encryptedProfileEpochV1' in changes)) ||
    (area === 'session' && 'encryptedProfileSessionV1' in changes)
  ) {
    if (busy) {
      pendingRefresh = true;
      return;
    }
    guarded = true;
    render();
    void reconcile();
  }
});
document.addEventListener('visibilitychange', () => {
  clearPasswords();
  if (document.hidden) {
    ++generation;
    guarded = true;
    render();
  } else void reconcile();
});
window.addEventListener('focus', () => {
  maskSecrets();
  if (!document.hidden) void reconcile();
});
window.addEventListener('beforeunload', (event) => {
  if (dirty || passwordIds.some((id) => input(id).value !== '')) {
    event.preventDefault();
    event.returnValue = '';
  }
});
window.addEventListener('pagehide', () => {
  const shouldLock = !!credentials && !status?.keep;
  alive = false;
  ++refreshNumber;
  wipe();
  if (shouldLock) void request({ op: 'lock' }).catch(() => {});
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    alive = true;
    void reconcile();
  }
});
updateConditions(views);
void reconcile();
