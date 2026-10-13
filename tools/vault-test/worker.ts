/** Test-only entry point: actual storage/protocol modules, fixed synthetic consumer.
 * Never bundled into the distributable extension. */
import { ProfileVault } from '../../apps/extension/src/vault/service.js';
import { handleVaultMessage } from '../../apps/extension/src/vault/protocol.js';
const vault = new ProfileVault(chrome.storage.local, chrome.storage.session);
const boot = crypto.randomUUID();
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (
    message &&
    typeof message === 'object' &&
    'op' in message &&
    message.op === 'synthetic-use' &&
    sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL('settings.html')
  ) {
    void (async () => {
      const s = await vault.status();
      await vault.withProfile(
        {
          revision: s.revision!,
          epoch: s.epoch!,
          operationId: crypto.randomUUID(),
          documentId: sender.documentId!,
          tabId: sender.tab!.id!,
        },
        async () => true,
        async (profile, check) => {
          await check();
          if (profile.firstName !== 'SENTINEL') throw Error('FIXTURE_MISMATCH');
        },
      );
      return { ok: true, boot };
    })().then(respond, () => respond({ ok: false, boot }));
  } else {
    void handleVaultMessage(vault, message, sender, chrome.runtime.id).then(
      (reply) => respond({ reply, boot }),
    );
  }
  return true;
});
