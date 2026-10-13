import { describe, expect, it } from 'vitest';
import {
  fieldsSchema,
  isExtensionUI,
} from '../apps/extension/src/autofill-controller.js';
describe('autofill nonsecret protocol boundary', () => {
  it('accepts only fixed field/status summaries', () => {
    expect(
      fieldsSchema.safeParse([{ field: 'firstName', status: 'filled' }])
        .success,
    ).toBe(true);
    for (const rows of [
      [{ field: 'firstName', status: 'SENTINEL' }],
      [{ field: 'secret', status: 'filled' }],
      [{ field: 'firstName', status: 'filled', value: 'SENTINEL' }],
      [
        { field: 'firstName', status: 'filled' },
        { field: 'firstName', status: 'failed' },
      ],
    ])
      expect(fieldsSchema.safeParse(rows).success).toBe(false);
  });
  it('requires the exact top-frame extension document', () => {
    const sender = {
      id: 'test',
      origin: 'chrome-extension://test',
      url: 'chrome-extension://test/popup.html',
      documentId: 'doc',
      frameId: 0,
    };
    expect(isExtensionUI(sender, 'test', 'popup')).toBe(true);
    for (const change of [
      { url: sender.url + '?fake' },
      { url: 'https://www.americanexpress.com' },
      { id: 'other' },
      { documentId: '' },
      { frameId: 1 },
      { origin: 'null' },
      { tab: { incognito: true } },
      { url: 'chrome-extension://test/settings.html' },
    ])
      expect(
        isExtensionUI(
          { ...sender, ...change } as chrome.runtime.MessageSender,
          'test',
          'popup',
        ),
      ).toBe(false);
  });
});
