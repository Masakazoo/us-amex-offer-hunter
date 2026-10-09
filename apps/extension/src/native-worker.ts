import {
  nativeHostName,
  nativeResponseSchema,
  nativeStateKey,
  nativeStateSchema,
  type NativeState,
} from './native-vault.js';
import { sessionProfileKey } from './vault-profile.js';
import { classifyTarget } from './target.js';

export function installNativeWorker() {
  let loading = false;
  const state = (status: NativeState['status']) =>
    chrome.storage.session.set({ [nativeStateKey]: { status } });
  const initialized = chrome.storage.session
    .get(nativeStateKey)
    .then(async (memory) => {
      const previous = nativeStateSchema.safeParse(memory[nativeStateKey]);
      if (previous.success && previous.data.status === 'loading')
        await state('unavailable');
    });
  chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL('popup.html') ||
      typeof message !== 'object' ||
      message === null ||
      Array.isArray(message) ||
      Object.keys(message).length !== 1 ||
      !('type' in message) ||
      message.type !== 'load-vault'
    )
      return false;
    if (loading) {
      reply({ accepted: false });
      return false;
    }
    loading = true;
    void (async () => {
      let port: chrome.runtime.Port | undefined;
      let selected: chrome.tabs.Tab | undefined;
      let started = false;
      try {
        await initialized;
        [selected] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (
          selected?.id === undefined ||
          classifyTarget(selected.url) !== 'amex'
        ) {
          reply({ accepted: false });
          return;
        }
        await chrome.storage.session.setAccessLevel({
          accessLevel: 'TRUSTED_CONTEXTS',
        });
        await chrome.storage.session.remove(sessionProfileKey);
        await state('loading');
        started = true;
        reply({ accepted: true });
        port = chrome.runtime.connectNative(nativeHostName);
        const response = await new Promise<unknown>((resolve, reject) => {
          let received = false;
          const timer = setTimeout(
            () => reject(new Error('Native timeout')),
            180000,
          );
          port!.onMessage.addListener((value: unknown) => {
            if (received) return;
            received = true;
            clearTimeout(timer);
            resolve(value);
          });
          port!.onDisconnect.addListener(() => {
            // Consume lastError, but never log raw native-host diagnostics.
            void chrome.runtime.lastError;
            clearTimeout(timer);
            if (!received) reject(new Error('Native disconnected'));
          });
          port!.postMessage({ action: 'read-profile' });
        });
        const parsed = nativeResponseSchema.safeParse(response);
        if (!parsed.success) throw new Error('Invalid native response');
        // A clear/import in another extension view must win over this pending load.
        const current = nativeStateSchema.safeParse(
          (await chrome.storage.session.get(nativeStateKey))[nativeStateKey],
        );
        if (!current.success || current.data.status !== 'loading') return;
        if (parsed.data.status === 'error') {
          await state(parsed.data.code);
        } else {
          await chrome.storage.session.set({
            [sessionProfileKey]: {
              version: 1,
              source: 'vault-file',
              values: parsed.data.values,
            },
            [nativeStateKey]: { status: 'loaded' },
          });
        }
      } catch {
        if (!started) reply({ accepted: false });
        const current = nativeStateSchema.safeParse(
          (await chrome.storage.session.get(nativeStateKey))[nativeStateKey],
        );
        if (started && current.success && current.data.status === 'loading') {
          await chrome.storage.session.remove(sessionProfileKey);
          await state('unavailable');
        }
      } finally {
        port?.disconnect();
        loading = false;
        if (started && selected?.id !== undefined) {
          // The password dialog can close the popup. Reopen only over the same target.
          const [current] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (current?.id === selected.id && current.url === selected.url)
            await chrome.action
              .openPopup({ windowId: selected.windowId })
              .catch(() => {});
        }
      }
    })().catch(() => {});
    return true;
  });
}
