import { ProfileVault } from './vault/service.js';
import { handleVaultMessage } from './vault/protocol.js';

// Single owner for the encrypted vault. Access restrictions must complete before work.
const vault = new ProfileVault(chrome.storage.local, chrome.storage.session);
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  void handleVaultMessage(vault, message, sender, chrome.runtime.id).then(
    respond,
  );
  return true;
});
