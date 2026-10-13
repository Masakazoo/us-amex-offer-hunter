import { AutofillController } from './autofill-controller.js';
import { isExtensionUI } from './extension-ui.js';
import { ProfileVault } from './vault/service.js';
import { handleVaultMessage } from './vault/protocol.js';

// Single owner for the encrypted vault. Access restrictions must complete before work.
const vault = new ProfileVault(chrome.storage.local, chrome.storage.session);
const autofill = new AutofillController(vault);
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  const command = message as { channel?: unknown; op?: unknown } | null;
  if (command?.channel === 'autofill-v1') {
    void autofill.handle(message, sender).then(respond);
    return true;
  }
  if (
    (isExtensionUI(sender, chrome.runtime.id, 'popup') ||
      isExtensionUI(sender, chrome.runtime.id, 'settings')) &&
    ['lock', 'update', 'changePassword', 'reset'].includes(String(command?.op))
  )
    autofill.invalidate();
  const unlocking =
    command?.op === 'unlock' &&
    (isExtensionUI(sender, chrome.runtime.id, 'popup') ||
      isExtensionUI(sender, chrome.runtime.id, 'settings'));
  if (unlocking && autofill.unlocking) {
    respond({ ok: false, error: 'CONFLICT' });
    return false;
  }
  if (unlocking) autofill.unlocking = true;
  void handleVaultMessage(vault, message, sender, chrome.runtime.id).then(
    (reply) => {
      if (unlocking) autofill.unlocking = false;
      respond(reply);
    },
  );
  return true;
});
