// Persisted profile is available only to trusted extension pages, never content scripts.
void chrome.storage.local
  .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  .catch(() => {});

void chrome.storage.session
  .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  .catch(() => {});
