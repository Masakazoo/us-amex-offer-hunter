import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  base64,
  derive,
  open,
  parseEnvelope,
  passwordValid,
  seal,
  unbase64,
  type Envelope,
} from '../apps/extension/src/vault/crypto.js';
import {
  ProfileVault,
  VAULT_KEY,
  SESSION_KEY,
  EPOCH_KEY,
  ATTEMPT_KEY,
  type StorageArea,
  type OperationToken,
} from '../apps/extension/src/vault/service.js';
import { handleVaultMessage } from '../apps/extension/src/vault/protocol.js';
import { fullSentinelProfile } from './vault-fixture.js';
const PASSWORD = 'synthetic password only';
class MemoryArea implements StorageArea {
  values: Record<string, unknown> = {};
  faults = new Map<string, 'before' | 'after'>();
  access = false;
  async setAccessLevel() {
    this.access = true;
  }
  async get(key: string) {
    if (this.faults.get(`get:${key}`)) throw Error('SECRET');
    return structuredClone({ [key]: this.values[key] });
  }
  async set(values: Record<string, unknown>) {
    const key = Object.keys(values)[0]!;
    if (this.faults.get(`set:${key}`) === 'before') throw Error('SECRET');
    Object.assign(
      this.values,
      JSON.parse(
        JSON.stringify(values, (_key, item: unknown) =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? Object.fromEntries(Object.entries(item).reverse())
            : item,
        ),
      ),
    );
    if (this.faults.get(`set:${key}`) === 'after') throw Error('SECRET');
  }
  async remove(key: string) {
    if (this.faults.get(`remove:${key}`) === 'before') throw Error('SECRET');
    delete this.values[key];
    if (this.faults.get(`remove:${key}`) === 'after') throw Error('SECRET');
  }
}
function setup() {
  const local = new MemoryArea(),
    session = new MemoryArea();
  return { local, session, vault: new ProfileVault(local, session) };
}
async function unlock(
  vault: ProfileVault,
  session: MemoryArea,
  password = PASSWORD,
  keep = true,
) {
  delete session.values[ATTEMPT_KEY];
  await vault.unlock(password, keep);
  return vault.status();
}
async function token(vault: ProfileVault): Promise<OperationToken> {
  const s = await vault.status();
  return {
    revision: s.revision!,
    epoch: s.epoch!,
    operationId: crypto.randomUUID(),
    documentId: 'synthetic-document',
    tabId: 1,
  };
}
const verify = async () => true;
afterEach(() => vi.restoreAllMocks());
describe('encrypted profile crypto', () => {
  it('roundtrips all fields; rejects wrong passwords, ciphertext and authenticated metadata changes', async () => {
    const p = fullSentinelProfile();
    const e = await seal(p, PASSWORD);
    const raw = await derive(PASSWORD, e);
    expect(await open(e, raw)).toEqual(p);
    const wrong = await derive('wrong synthetic password', e);
    await expect(open(e, wrong)).rejects.toThrow('AUTH_OR_CORRUPT');
    wrong.fill(0);
    for (const changed of [
      { ...e, revision: crypto.randomUUID() },
      { ...e, kdf: { ...e.kdf, salt: base64(new Uint8Array(16)) } },
      { ...e, cipher: { ...e.cipher, iv: base64(new Uint8Array(12)) } },
      {
        ...e,
        ciphertext: base64(new Uint8Array(unbase64(e.ciphertext).length)),
      },
    ])
      await expect(open(changed, raw)).rejects.toThrow('AUTH_OR_CORRUPT');
    for (const changed of [
      { ...e, version: 2 },
      { ...e, payloadVersion: 2 },
    ])
      expect(() => parseEnvelope(changed)).toThrow('UNSUPPORTED_VERSION');
    for (const changed of [
      { ...e, extra: 'x' },
      { ...e, kdf: { ...e.kdf, iterations: 1 } },
      { ...e, kdf: { ...e.kdf, name: 'scrypt' } },
      { ...e, kdf: { ...e.kdf, hash: 'SHA-1' } },
      { ...e, cipher: { ...e.cipher, name: 'AES-CBC' } },
      { ...e, cipher: { ...e.cipher, tagLength: 64 } },
      { ...e, ciphertext: 'x'.repeat(70000) },
    ])
      expect(() => parseEnvelope(changed)).toThrow('AUTH_OR_CORRUPT');
    raw.fill(0);
  });
  it('uses new salt/IV, enforces 12 code points and preserves whitespace/Unicode', async () => {
    const a = await seal(fullSentinelProfile(), PASSWORD),
      b = await seal(fullSentinelProfile(), PASSWORD);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(passwordValid('a'.repeat(11), true)).toBe(false);
    expect(passwordValid('a'.repeat(12), true)).toBe(true);
    expect(passwordValid('😀'.repeat(6), true)).toBe(false);
    expect(passwordValid('\ud800'.repeat(12), true)).toBe(false);
    const e = await seal(fullSentinelProfile(), '  synthetic é password  ');
    const raw = await derive('synthetic é password', e);
    await expect(open(e, raw)).rejects.toThrow('AUTH_OR_CORRUPT');
    raw.fill(0);
  });
});
describe('vault operations and boundaries', () => {
  it('creates locked, persists ciphertext only; session survives Worker replacement and rejects malformed key', async () => {
    const { vault, local, session } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    expect(local.access && session.access).toBe(true);
    expect((await vault.status()).unlocked).toBe(false);
    await unlock(vault, session);
    expect(JSON.stringify(local.values)).not.toMatch(
      /SENTINEL|synthetic password|000000000/,
    );
    expect(JSON.stringify(session.values)).not.toMatch(
      /SENTINEL|synthetic password|000000000/,
    );
    expect((await new ProfileVault(local, session).status()).unlocked).toBe(
      true,
    );
    const s = session.values[SESSION_KEY] as Record<string, unknown>;
    s.raw = 'YQ==';
    expect((await vault.status()).unlocked).toBe(false);
    expect(
      (await new ProfileVault(local, new MemoryArea()).status()).unlocked,
    ).toBe(false);
  });
  it('updates and changes password with new revision; rejects stale revision/epoch and preserves unrelated keys on reset', async () => {
    const { vault, local, session } = setup();
    local.values.legacy = { synthetic: true };
    const original = await vault.create(fullSentinelProfile(), PASSWORD);
    let s = await unlock(vault, session);
    const old = structuredClone(local.values[VAULT_KEY]) as Envelope;
    const next = await vault.update(original, s.epoch!, {
      ...fullSentinelProfile(),
      firstName: 'NEW-SENTINEL',
    });
    const updated = local.values[VAULT_KEY] as Envelope;
    expect(updated.kdf).toEqual(old.kdf);
    expect(updated.cipher.iv).not.toBe(old.cipher.iv);
    expect((await vault.status()).unlocked).toBe(false);
    s = await unlock(vault, session);
    await expect(
      vault.update(original, s.epoch!, fullSentinelProfile()),
    ).rejects.toThrow('CONFLICT');
    const previousEpoch = s.epoch!;
    await vault.lock();
    s = await unlock(vault, session);
    await expect(
      vault.update(next, previousEpoch, fullSentinelProfile()),
    ).rejects.toThrow('CONFLICT');
    await vault.changePassword(next, s.epoch!, 'new synthetic password');
    const changed = local.values[VAULT_KEY] as Envelope;
    expect(changed.kdf.salt).not.toBe(updated.kdf.salt);
    await expect(unlock(vault, session)).rejects.toThrow('AUTH_OR_CORRUPT');
    await unlock(vault, session, 'new synthetic password');
    await expect(vault.reset(false)).rejects.toThrow('INVALID_INPUT');
    await vault.reset(true);
    expect(local.values.legacy).toEqual({ synthetic: true });
    expect(local.values[VAULT_KEY]).toBeUndefined();
    expect(session.values[SESSION_KEY]).toBeUndefined();
  });
  it('one-shot claims before consumption; concurrent reuse and failed consumption require authentication', async () => {
    const { vault, session } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    await unlock(vault, session, PASSWORD, false);
    const t = await token(vault);
    const results = await Promise.allSettled([
      vault.withProfile(t, verify, async (p) => p.firstName === 'SENTINEL'),
      vault.withProfile(
        { ...t, operationId: crypto.randomUUID() },
        verify,
        async () => true,
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((await vault.status()).unlocked).toBe(false);
    await unlock(vault, session, PASSWORD, false);
    await expect(
      vault.withProfile(await token(vault), verify, async () => {
        throw Error('synthetic failure');
      }),
    ).rejects.toThrow();
    expect((await vault.status()).unlocked).toBe(false);
  });
  it('blocks replay after Worker restart and refuses changed document', async () => {
    const { vault, session, local } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    await unlock(vault, session);
    const t = await token(vault);
    await vault.withProfile(t, verify, async () => true);
    await expect(
      new ProfileVault(local, session).withProfile(t, verify, async () => true),
    ).rejects.toThrow('CONFLICT');
    await expect(
      vault.withProfile(
        { ...t, operationId: crypto.randomUUID() },
        async () => false,
        async () => true,
      ),
    ).rejects.toThrow('CANCELLED');
  });
  it('lock interrupts a running consumer before values can be handed off', async () => {
    const { vault, session } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    await unlock(vault, session);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    let handedOff = false;
    const using = vault.withProfile(
      await token(vault),
      verify,
      async (_p, check) => {
        entered();
        await gate;
        await check();
        handedOff = true;
      },
    );
    await started;
    const locking = vault.lock();
    release();
    await expect(using).rejects.toThrow('CANCELLED');
    await locking;
    expect(handedOff).toBe(false);
  });
  it('lock receipt cancels an in-flight unlock and leaves no session', async () => {
    const { vault, session } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const original = crypto.subtle.deriveBits.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'deriveBits').mockImplementation(
      async (...args) => {
        entered();
        await gate;
        return original(...args);
      },
    );
    const unlocking = vault.unlock(PASSWORD);
    await started;
    const locking = vault.lock();
    release();
    await expect(unlocking).rejects.toThrow('CANCELLED');
    await locking;
    expect(session.values[SESSION_KEY]).toBeUndefined();
  });
  it('rate-limits repeated unlock requests across Worker restart', async () => {
    const { vault, local, session } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    await vault.unlock(PASSWORD);
    await expect(
      new ProfileVault(local, session).unlock(PASSWORD),
    ).rejects.toThrow('RATE_LIMITED');
  });
});
describe('settings-only editing read', () => {
  it('reads authenticated values without consuming one-shot fill and still revokes on save', async () => {
    const { vault, local, session } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    const s = await unlock(vault, session, PASSWORD, false);
    const stored = structuredClone(local.values);
    const material = structuredClone(session.values);
    expect(await vault.readForEditing(s.revision!, s.epoch!)).toEqual(
      fullSentinelProfile(),
    );
    expect(local.values).toEqual(stored);
    expect(session.values).toEqual(material);
    await vault.update(s.revision!, s.epoch!, {
      ...fullSentinelProfile(),
      firstName: 'EDITED',
    });
    expect((await vault.status()).unlocked).toBe(false);
    await expect(vault.readForEditing(s.revision!, s.epoch!)).rejects.toThrow(
      'CONFLICT',
    );
  });
  it('never returns decrypted values if a lock arrives during decryption', async () => {
    const { vault, session } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    const s = await unlock(vault, session);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const original = crypto.subtle.decrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args) => {
      entered();
      await gate;
      return original(...args);
    });
    const reading = vault.readForEditing(s.revision!, s.epoch!);
    await started;
    const locking = vault.lock();
    release();
    await expect(reading).rejects.toThrow('CANCELLED');
    await locking;
  });
  it('only responds with plaintext to the exact settings tab, never popup, query URLs or content senders', async () => {
    const { vault, session } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    const s = await unlock(vault, session);
    const id = 'syntheticextension';
    const sender = {
      id,
      origin: `chrome-extension://${id}`,
      url: `chrome-extension://${id}/settings.html`,
      documentId: 'synthetic-document',
      tab: { id: 1, incognito: false },
    } as chrome.runtime.MessageSender;
    const command = {
      channel: 'profile-vault-v1',
      op: 'readForEditing',
      revision: s.revision,
      epoch: s.epoch,
    };
    for (const unsafe of [
      { ...sender, url: `chrome-extension://${id}/popup.html` },
      { ...sender, url: sender.url + '?spoof' },
      { ...sender, url: 'https://example.test' },
      { ...sender, tab: undefined },
    ]) {
      const reply = await handleVaultMessage(
        vault,
        command,
        unsafe as chrome.runtime.MessageSender,
        id,
      );
      expect(reply).toEqual({ ok: false, error: 'UNAUTHORIZED' });
      expect(JSON.stringify(reply)).not.toContain('SENTINEL');
    }
    expect(await handleVaultMessage(vault, command, sender, id)).toEqual({
      ok: true,
      profile: fullSentinelProfile(),
    });
    await vault.lock();
    expect(await handleVaultMessage(vault, command, sender, id)).toEqual({
      ok: false,
      error: 'LOCKED',
    });
  });
});
describe('storage failures', () => {
  it.each(['before', 'after'] as const)(
    'reports ambiguous %s-write failure without rollback',
    async (phase) => {
      const { vault, local, session } = setup();
      await vault.create(fullSentinelProfile(), PASSWORD);
      const before = structuredClone(local.values[VAULT_KEY]);
      const s = await unlock(vault, session);
      local.faults.set(`set:${VAULT_KEY}`, phase);
      await expect(
        vault.changePassword(
          s.revision!,
          s.epoch!,
          'replacement synthetic password',
        ),
      ).rejects.toThrow('COMMIT_UNKNOWN');
      expect(local.values[VAULT_KEY] === undefined).toBe(false);
      expect((await vault.status()).unlocked).toBe(false);
      if (phase === 'before') expect(local.values[VAULT_KEY]).toEqual(before);
      else expect(local.values[VAULT_KEY]).not.toEqual(before);
      local.faults.clear();
      await unlock(
        vault,
        session,
        phase === 'before' ? PASSWORD : 'replacement synthetic password',
      );
    },
  );
  it('session remove failure is revoked across Worker replacement; retry recovers', async () => {
    const { vault, local, session } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    await unlock(vault, session);
    const oldEpoch = local.values[EPOCH_KEY];
    session.faults.set(`remove:${SESSION_KEY}`, 'before');
    await expect(vault.lock()).rejects.toThrow('STORAGE_WRITE');
    expect(local.values[EPOCH_KEY]).not.toBe(oldEpoch);
    expect(session.values[SESSION_KEY]).toBeDefined();
    expect((await new ProfileVault(local, session).status()).unlocked).toBe(
      false,
    );
    session.faults.clear();
    await vault.lock();
    await unlock(vault, session);
  });
  it('session set failure cleans partial key; unknown/corrupt envelope is retained until explicit reset', async () => {
    const { vault, local, session } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    session.faults.set(`set:${SESSION_KEY}`, 'after');
    await expect(unlock(vault, session)).rejects.toThrow('STORAGE_WRITE');
    expect(session.values[SESSION_KEY]).toBeUndefined();
    session.faults.clear();
    local.values[VAULT_KEY] = { version: 999 };
    await expect(vault.status()).rejects.toThrow('UNSUPPORTED_VERSION');
    await expect(vault.create(fullSentinelProfile(), PASSWORD)).rejects.toThrow(
      'CONFLICT',
    );
    expect(local.values[VAULT_KEY]).toEqual({ version: 999 });
    await vault.reset(true);
    expect(local.values[VAULT_KEY]).toBeUndefined();
  });
  it('readback failure retains the committed record and returns COMMIT_UNKNOWN', async () => {
    const { vault, local, session } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    const s = await unlock(vault, session);
    const original = local.set.bind(local);
    vi.spyOn(local, 'set').mockImplementation(async (values) => {
      await original(values);
      if (VAULT_KEY in values) local.faults.set(`get:${VAULT_KEY}`, 'before');
    });
    await expect(
      vault.changePassword(
        s.revision!,
        s.epoch!,
        'replacement synthetic password',
      ),
    ).rejects.toThrow('COMMIT_UNKNOWN');
    local.faults.clear();
    await unlock(vault, session, 'replacement synthetic password');
  });
  it('lock after write returns COMMIT_UNKNOWN; committed password remains usable', async () => {
    const { vault, local, session } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    const s = await unlock(vault, session);
    const original = local.set.bind(local);
    let locking: Promise<void> | undefined;
    vi.spyOn(local, 'set').mockImplementation(async (values) => {
      await original(values);
      if (VAULT_KEY in values) locking = vault.lock();
    });
    await expect(
      vault.changePassword(
        s.revision!,
        s.epoch!,
        'replacement synthetic password',
      ),
    ).rejects.toThrow('COMMIT_UNKNOWN');
    await locking;
    await unlock(vault, session, 'replacement synthetic password');
  });
  it('dual storage failure never reports success; extension reload is required if Worker dies', async () => {
    const { vault, local, session } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    await unlock(vault, session);
    local.faults.set(`set:${EPOCH_KEY}`, 'before');
    session.faults.set(`remove:${SESSION_KEY}`, 'before');
    await expect(vault.lock()).rejects.toThrow('STORAGE_WRITE');
    expect((await vault.status()).unlocked).toBe(false);
    // Both stores unchanged: no persisted revocation is possible. Do not promise
    // Worker restart is a recovery action. Reloading the extension clears session.
    expect((await new ProfileVault(local, session).status()).unlocked).toBe(
      true,
    );
    expect(
      (await new ProfileVault(local, new MemoryArea()).status()).unlocked,
    ).toBe(false);
  });
  it('epoch write failure still removes session and preserves ciphertext', async () => {
    const { vault, local, session } = setup();
    await vault.create(fullSentinelProfile(), PASSWORD);
    await unlock(vault, session);
    const original = structuredClone(local.values[VAULT_KEY]);
    local.faults.set(`set:${EPOCH_KEY}`, 'before');
    await expect(vault.lock()).rejects.toThrow('STORAGE_WRITE');
    expect((await new ProfileVault(local, session).status()).unlocked).toBe(
      false,
    );
    expect(local.values[VAULT_KEY]).toEqual(original);
  });
  it('access restriction failure prevents all storage operations', async () => {
    const { local, session } = setup();
    vi.spyOn(local, 'setAccessLevel').mockRejectedValue(Error('SECRET'));
    const vault = new ProfileVault(local, session);
    await expect(vault.create(fullSentinelProfile(), PASSWORD)).rejects.toThrow(
      'STORAGE_WRITE',
    );
    expect(local.values).toEqual({});
  });
});
describe('worker message boundary', () => {
  const id = 'syntheticextension';
  const sender = {
    id,
    origin: `chrome-extension://${id}`,
    url: `chrome-extension://${id}/settings.html`,
    documentId: 'document',
  };
  it('only accepts exact trusted extension documents and strict commands; no key/profile response', async () => {
    const { vault } = setup();
    const command = { channel: 'profile-vault-v1', op: 'status' };
    for (const unsafe of [
      { ...sender, id: 'other' },
      { ...sender, url: 'https://example.test' },
      { ...sender, url: sender.url + '?spoof' },
      { ...sender, frameId: 1 },
      { ...sender, tab: { incognito: true } },
    ])
      expect(
        await handleVaultMessage(
          vault,
          command,
          unsafe as chrome.runtime.MessageSender,
          id,
        ),
      ).toEqual({ ok: false, error: 'UNAUTHORIZED' });
    expect(
      await handleVaultMessage(
        vault,
        { ...command, extra: 'SECRET' },
        sender,
        id,
      ),
    ).toEqual({ ok: false, error: 'INVALID_INPUT' });
    expect(
      await handleVaultMessage(
        vault,
        {
          channel: 'profile-vault-v1',
          op: 'create',
          profile: fullSentinelProfile(),
          password: PASSWORD,
        },
        { ...sender, url: `chrome-extension://${id}/popup.html` },
        id,
      ),
    ).toEqual({ ok: false, error: 'UNAUTHORIZED' });
    expect(
      JSON.stringify(await handleVaultMessage(vault, command, sender, id)),
    ).not.toMatch(/raw|SENTINEL|password/);
  });
});
