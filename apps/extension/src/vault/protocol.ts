import { z } from 'zod';
import { VaultError, fail } from './crypto.js';
import { ProfileVault } from './service.js';

const credentials = { revision: z.uuid(), epoch: z.uuid() };
const password = z.string().min(1).max(1024);
const commands = z.discriminatedUnion('op', [
  z
    .object({ channel: z.literal('profile-vault-v1'), op: z.literal('status') })
    .strict(),
  z
    .object({ channel: z.literal('profile-vault-v1'), op: z.literal('lock') })
    .strict(),
  z
    .object({
      channel: z.literal('profile-vault-v1'),
      op: z.literal('unlock'),
      password,
      keep: z.boolean(),
    })
    .strict(),
  z
    .object({
      channel: z.literal('profile-vault-v1'),
      op: z.literal('create'),
      password,
      profile: z.unknown(),
    })
    .strict(),
  z
    .object({
      channel: z.literal('profile-vault-v1'),
      op: z.literal('update'),
      ...credentials,
      profile: z.unknown(),
    })
    .strict(),
  z
    .object({
      channel: z.literal('profile-vault-v1'),
      op: z.literal('changePassword'),
      ...credentials,
      password,
    })
    .strict(),
  z
    .object({
      channel: z.literal('profile-vault-v1'),
      op: z.literal('reset'),
      confirmed: z.literal(true),
    })
    .strict(),
]);
export async function handleVaultMessage(
  vault: ProfileVault,
  input: unknown,
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): Promise<unknown> {
  try {
    const popup = `chrome-extension://${extensionId}/popup.html`;
    const settings = `chrome-extension://${extensionId}/settings.html`;
    if (
      sender.id !== extensionId ||
      sender.origin !== `chrome-extension://${extensionId}` ||
      !sender.documentId ||
      sender.tab?.incognito ||
      (sender.frameId !== undefined && sender.frameId !== 0) ||
      (sender.url !== popup && sender.url !== settings)
    )
      fail('UNAUTHORIZED');
    const parsed = commands.safeParse(input);
    if (!parsed.success) fail('INVALID_INPUT');
    const c = parsed.data;
    if (sender.url !== settings && !['status', 'lock', 'unlock'].includes(c.op))
      fail('UNAUTHORIZED');
    switch (c.op) {
      case 'status':
        return { ok: true, status: await vault.status() };
      case 'lock':
        await vault.lock();
        break;
      case 'unlock':
        await vault.unlock(c.password, c.keep);
        break;
      case 'create':
        return {
          ok: true,
          revision: await vault.create(c.profile, c.password),
        };
      case 'update':
        return {
          ok: true,
          revision: await vault.update(c.revision, c.epoch, c.profile),
        };
      case 'changePassword':
        return {
          ok: true,
          revision: await vault.changePassword(c.revision, c.epoch, c.password),
        };
      case 'reset':
        await vault.reset(c.confirmed);
        break;
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof VaultError ? error.code : 'STORAGE_WRITE',
    };
  }
}
