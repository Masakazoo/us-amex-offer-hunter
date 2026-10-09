import { parseVaultProfile } from '../../apps/extension/src/vault-profile.js';
import type {
  NativeErrorCode,
  NativeResponse,
} from '../../apps/extension/src/native-vault.js';

export class VaultError extends Error {
  constructor(readonly code: NativeErrorCode) {
    super(code);
  }
}
export type VaultDriver = {
  prepare(): Promise<void>;
  password(): Promise<Buffer>;
  unlock(password: Buffer): Promise<void>;
  read(): Promise<Buffer>;
  close(): Promise<void>;
};

// A response containing values is released only AFTER detach succeeds.
// All failures are fixed codes; child-process stderr/parser exceptions are never forwarded.
export async function loadVault(driver: VaultDriver): Promise<NativeResponse> {
  let password: Buffer | undefined;
  let raw: Buffer | undefined;
  let response: NativeResponse;
  try {
    await driver.prepare();
    password = await driver.password();
    try {
      await driver.unlock(password);
    } finally {
      password.fill(0);
    }
    raw = await driver.read();
    const profile = parseVaultProfile(raw.toString('utf8'));
    if (!profile) throw new VaultError('invalid-profile');
    response = { status: 'ok', values: profile };
  } catch (error) {
    response = {
      status: 'error',
      code: error instanceof VaultError ? error.code : 'unavailable',
    };
  } finally {
    password?.fill(0);
    raw?.fill(0);
  }
  try {
    await driver.close();
  } catch {
    return { status: 'error', code: 'close-failed' };
  }
  return response;
}
