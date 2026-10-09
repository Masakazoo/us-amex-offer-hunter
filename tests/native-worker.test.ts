import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNativeWorker } from '../apps/extension/src/native-worker.js';
import {
  nativeHostName,
  nativeStateKey,
} from '../apps/extension/src/native-vault.js';
import {
  sessionProfileKey,
  parseVaultProfile,
} from '../apps/extension/src/vault-profile.js';
import { fieldSpecs } from '../apps/extension/src/profile.js';

const extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const popupUrl = `chrome-extension://${extensionId}/popup.html`;
const amex =
  'https://www.americanexpress.com/en-us/credit-cards/apply/business/business-platinum-charge-card/00000-0-0';
const profile = parseVaultProfile(
  fieldSpecs.map(([key]) => `${key}: "SENTINEL"`).join('\n'),
)!;
type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  reply: (value: unknown) => void,
) => boolean;
function setup(initial: Record<string, unknown> = {}) {
  const memory = { ...initial };
  let receive: Listener | undefined;
  let nativeMessage: ((value: unknown) => void) | undefined;
  let nativeDisconnect: (() => void) | undefined;
  const tab = { id: 1, windowId: 1, url: amex };
  const port = {
    onMessage: {
      addListener(fn: (value: unknown) => void) {
        nativeMessage = fn;
      },
    },
    onDisconnect: {
      addListener(fn: () => void) {
        nativeDisconnect = fn;
      },
    },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
  };
  const api = {
    runtime: {
      id: extensionId,
      getURL: (p: string) => `chrome-extension://${extensionId}/${p}`,
      onMessage: {
        addListener(fn: Listener) {
          receive = fn;
        },
      },
      connectNative: vi.fn(() => port),
    },
    storage: {
      session: {
        setAccessLevel: vi.fn(async () => {}),
        async get(key: string) {
          return { [key]: memory[key] };
        },
        async set(value: Record<string, unknown>) {
          Object.assign(memory, value);
        },
        async remove(key: string) {
          delete memory[key];
        },
      },
    },
    tabs: { query: vi.fn(async () => [tab]) },
    action: { openPopup: vi.fn(async () => {}) },
  };
  vi.stubGlobal('chrome', api);
  installNativeWorker();
  const sender = { id: extensionId, url: popupUrl };
  const send = (message: unknown = { type: 'load-vault' }, from = sender) => {
    const reply = vi.fn();
    receive!(message, from, reply);
    return reply;
  };
  const ready = () =>
    vi.waitFor(() =>
      expect(port.postMessage).toHaveBeenCalledWith({ action: 'read-profile' }),
    );
  return {
    api,
    tab,
    memory,
    port,
    sender,
    send,
    ready,
    message: (value: unknown) => nativeMessage!(value),
    disconnected: () => nativeDisconnect!(),
  };
}
afterEach(() => vi.unstubAllGlobals());
describe('trusted native-vault coordinator', () => {
  it('requires the exact extension popup and a fixed message', async () => {
    const f = setup();
    f.send({ type: 'load-vault' }, { ...f.sender, url: amex });
    f.send({ type: 'load-vault' }, { ...f.sender, id: 'other' });
    f.send({ type: 'load-vault', path: '/SENTINEL' });
    f.send(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(f.api.runtime.connectNative).not.toHaveBeenCalled();
  });
  it('does not unlock on an unrelated page', async () => {
    const f = setup();
    f.tab.url = 'https://example.invalid/';
    const reply = f.send();
    await vi.waitFor(() =>
      expect(reply).toHaveBeenCalledWith({ accepted: false }),
    );
    expect(f.api.runtime.connectNative).not.toHaveBeenCalled();
    expect(f.api.action.openPopup).not.toHaveBeenCalled();
  });
  it('stores validated values only in trusted session memory and survives popup closure', async () => {
    const f = setup({ [sessionProfileKey]: 'OLD_SENTINEL' });
    f.send();
    await f.ready();
    expect(f.memory[sessionProfileKey]).toBeUndefined();
    expect(f.api.runtime.connectNative).toHaveBeenCalledWith(nativeHostName);
    expect(f.api.storage.session.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
    // The response comes through the worker, not the now-closed popup's callback.
    f.message({ status: 'ok', values: profile });
    await vi.waitFor(() =>
      expect(f.memory[nativeStateKey]).toEqual({ status: 'loaded' }),
    );
    expect(f.memory[sessionProfileKey]).toEqual({
      version: 1,
      source: 'vault-file',
      values: profile,
    });
    expect(f.api.action.openPopup).toHaveBeenCalledWith({ windowId: 1 });
    expect(f.port.disconnect).toHaveBeenCalled();
  });
  it('allows one native prompt at a time', async () => {
    const f = setup();
    f.send();
    await f.ready();
    expect(f.send()).toHaveBeenCalledWith({ accepted: false });
    expect(f.api.runtime.connectNative).toHaveBeenCalledTimes(1);
    f.message({ status: 'error', code: 'cancelled' });
    await vi.waitFor(() =>
      expect(f.memory[nativeStateKey]).toEqual({ status: 'cancelled' }),
    );
    expect(f.memory[sessionProfileKey]).toBeUndefined();
  });
  it.each(['response', 'disconnect'] as const)(
    'does not resurrect cleared/replaced data after %s',
    async (mode) => {
      const f = setup();
      f.send();
      await f.ready();
      delete f.memory[nativeStateKey];
      f.memory[sessionProfileKey] = 'MANUAL_SENTINEL';
      if (mode === 'response') f.message({ status: 'ok', values: profile });
      else f.disconnected();
      await vi.waitFor(() => expect(f.port.disconnect).toHaveBeenCalled());
      expect(f.memory[sessionProfileKey]).toBe('MANUAL_SENTINEL');
      expect(f.memory[nativeStateKey]).toBeUndefined();
    },
  );
  it('rejects raw errors and does not reopen over a changed target', async () => {
    const f = setup();
    f.send();
    await f.ready();
    f.api.tabs.query.mockResolvedValueOnce([
      { id: 2, windowId: 1, url: 'https://example.invalid' },
    ]);
    f.message({ status: 'ok', values: profile, password: 'PRIVATE_SENTINEL' });
    await vi.waitFor(() =>
      expect(f.memory[nativeStateKey]).toEqual({ status: 'unavailable' }),
    );
    expect(f.memory[sessionProfileKey]).toBeUndefined();
    expect(JSON.stringify(f.memory)).not.toContain('PRIVATE_SENTINEL');
    expect(f.api.action.openPopup).not.toHaveBeenCalled();
  });
  it('recovers from an interrupted prior worker without reopening a password dialog', async () => {
    const f = setup({ [nativeStateKey]: { status: 'loading' } });
    await vi.waitFor(() =>
      expect(f.memory[nativeStateKey]).toEqual({ status: 'unavailable' }),
    );
    expect(f.api.runtime.connectNative).not.toHaveBeenCalled();
  });
});
