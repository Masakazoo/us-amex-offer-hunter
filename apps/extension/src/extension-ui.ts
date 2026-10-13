/** Trust Chrome-provided sender metadata, never fields supplied by a message. */
export function isExtensionUI(
  sender: chrome.runtime.MessageSender,
  id: string,
  page: 'popup' | 'settings',
): boolean {
  if (
    sender.id !== id ||
    sender.origin !== `chrome-extension://${id}` ||
    sender.url !== `chrome-extension://${id}/${page}.html` ||
    sender.tab?.incognito
  )
    return false;
  // Chrome action popups have no tab, frameId or documentId. Only this exact
  // extension-owned popup may use that shape; settings and tab pages need a document.
  if (sender.documentId === undefined)
    return (
      page === 'popup' &&
      sender.tab === undefined &&
      sender.frameId === undefined
    );
  return (
    !!sender.documentId &&
    (sender.frameId === undefined || sender.frameId === 0)
  );
}
