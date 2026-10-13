import { z } from 'zod';
import {
  VaultError,
  base64,
  derive,
  encrypt,
  fail,
  fixedBase64,
  open,
  parseEnvelope,
  parseProfile,
  passwordValid,
  seal,
  unbase64,
  type Envelope,
} from './crypto.js';
import type { FullProfile } from '../full-profile.js';

export const VAULT_KEY = 'encryptedProfileV1';
export const SESSION_KEY = 'encryptedProfileSessionV1';
// Nonsecret revocation metadata. A stale session stays unusable after Worker restart
// even when storage.session.remove fails. Never contains key material or profile data.
export const EPOCH_KEY = 'encryptedProfileEpochV1';
export const ATTEMPT_KEY = 'encryptedProfileAttemptV1';
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
}
const sessionSchema = z
  .object({
    revision: z.uuid(),
    epoch: z.uuid(),
    raw: fixedBase64(32),
    keep: z.boolean(),
    used: z.array(z.uuid()).max(128),
  })
  .strict();
type Session = z.infer<typeof sessionSchema>;
export const tokenSchema = z
  .object({
    revision: z.uuid(),
    epoch: z.uuid(),
    operationId: z.uuid(),
    documentId: z.string().min(1).max(128),
    tabId: z.number().int().nonnegative(),
  })
  .strict();
export type OperationToken = z.infer<typeof tokenSchema>;
export type Status = {
  registered: boolean;
  unlocked: boolean;
  revision: string | null;
  epoch: string | null;
  keep: boolean;
};

// Chrome Storage may reorder object keys during serialization.
function canonical(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item))
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
      );
    return item;
  });
}
export class ProfileVault {
  private tail: Promise<unknown> = Promise.resolve();
  private barrier = 0;
  private blocked = false;
  private readonly ready: Promise<boolean>;
  constructor(
    private readonly local: StorageArea,
    private readonly session: StorageArea,
  ) {
    this.ready = Promise.all([
      local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
      session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    ]).then(
      () => true,
      () => false,
    );
  }
  private run<T>(operation: (barrier: number) => Promise<T>): Promise<T> {
    const accepted = this.barrier;
    const result = this.tail.then(async () => {
      if (!(await this.ready)) fail('STORAGE_WRITE');
      return operation(accepted);
    });
    this.tail = result.catch(() => {});
    return result;
  }
  private check(accepted: number) {
    if (accepted !== this.barrier) fail('CANCELLED');
  }
  private async read(area: StorageArea, key: string): Promise<unknown> {
    try {
      return (await area.get(key))[key];
    } catch {
      return fail('STORAGE_READ');
    }
  }
  private async envelope(): Promise<Envelope> {
    const value = await this.read(this.local, VAULT_KEY);
    return value === undefined ? fail('NOT_REGISTERED') : parseEnvelope(value);
  }
  private async active(e: Envelope): Promise<Session> {
    if (this.blocked) fail('LOCKED');
    const result = sessionSchema.safeParse(
      await this.read(this.session, SESSION_KEY),
    );
    const epoch = await this.read(this.local, EPOCH_KEY);
    if (
      !result.success ||
      result.data.revision !== e.revision ||
      result.data.epoch !== epoch
    )
      fail('LOCKED');
    return result.data;
  }
  private async revoke(): Promise<void> {
    this.blocked = true;
    const epoch = crypto.randomUUID();
    let rotated = false,
      removed = false;
    try {
      await this.local.set({ [EPOCH_KEY]: epoch });
      rotated = (await this.read(this.local, EPOCH_KEY)) === epoch;
    } catch {
      /* Attempt independent cleanup below. */
    }
    try {
      await this.session.remove(SESSION_KEY);
      removed = (await this.read(this.session, SESSION_KEY)) === undefined;
    } catch {
      /* Fixed error only. */
    }
    // Successful logical revocation requires at least one durable-to-worker boundary.
    // Still report cleanup failure; callers must never show lock success on remove failure.
    if (!rotated || !removed) fail('STORAGE_WRITE');
    this.blocked = false;
  }
  private async commit(
    value: Envelope | undefined,
    expected: unknown,
    accepted: number,
  ): Promise<void> {
    this.check(accepted);
    const before = await this.read(this.local, VAULT_KEY);
    if (canonical(before) !== canonical(expected)) fail('CONFLICT');
    this.check(accepted);
    try {
      if (value === undefined) await this.local.remove(VAULT_KEY);
      else await this.local.set({ [VAULT_KEY]: value });
      if (
        canonical(await this.read(this.local, VAULT_KEY)) !== canonical(value)
      )
        fail('COMMIT_UNKNOWN');
    } catch {
      fail('COMMIT_UNKNOWN');
    }
    if (accepted !== this.barrier) fail('COMMIT_UNKNOWN');
  }
  status(): Promise<Status> {
    return this.run(async () => {
      const value = await this.read(this.local, VAULT_KEY);
      if (value === undefined)
        return {
          registered: false,
          unlocked: false,
          revision: null,
          epoch: null,
          keep: false,
        };
      const e = parseEnvelope(value);
      try {
        const s = await this.active(e);
        return {
          registered: true,
          unlocked: true,
          revision: e.revision,
          epoch: s.epoch,
          keep: s.keep,
        };
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'LOCKED')
          throw error;
        return {
          registered: true,
          unlocked: false,
          revision: e.revision,
          epoch: null,
          keep: false,
        };
      }
    });
  }
  create(profile: unknown, password: string): Promise<string> {
    return this.run(async (accepted) => {
      const parsed = parseProfile(profile);
      if (!passwordValid(password, true)) fail('INVALID_INPUT');
      if ((await this.read(this.local, VAULT_KEY)) !== undefined)
        fail('CONFLICT');
      await this.revoke();
      const e = await seal(parsed, password);
      await this.commit(e, undefined, accepted);
      return e.revision;
    });
  }
  unlock(password: string, keep = true): Promise<void> {
    return this.run(async (accepted) => {
      if (!passwordValid(password, false) || typeof keep !== 'boolean')
        fail('INVALID_INPUT');
      const e = await this.envelope();
      const previous = await this.read(this.session, ATTEMPT_KEY);
      if (typeof previous === 'number' && previous > Date.now())
        fail('RATE_LIMITED');
      // One KDF per second, survives worker idle termination. Does not limit offline attacks.
      try {
        await this.session.set({ [ATTEMPT_KEY]: Date.now() + 1000 });
      } catch {
        fail('STORAGE_WRITE');
      }
      await this.revoke();
      const raw = await derive(password, e);
      try {
        await open(e, raw);
        this.check(accepted);
        if (canonical(await this.envelope()) !== canonical(e)) fail('CONFLICT');
        const epoch = await this.read(this.local, EPOCH_KEY);
        const s = sessionSchema.parse({
          revision: e.revision,
          epoch,
          raw: base64(raw),
          keep,
          used: [],
        });
        try {
          await this.session.set({ [SESSION_KEY]: s });
          if (
            canonical(await this.read(this.session, SESSION_KEY)) !==
            canonical(s)
          )
            fail('STORAGE_WRITE');
        } catch {
          await this.revoke();
          fail('STORAGE_WRITE');
        }
        this.check(accepted);
      } catch (error) {
        await this.revoke();
        throw error;
      } finally {
        raw.fill(0);
      }
    });
  }
  lock(): Promise<void> {
    ++this.barrier; // Synchronous receipt cancels prior KDF/queued requests.
    return this.run(async () => this.revoke());
  }
  private async authorized(
    revision: string,
    epoch: string,
  ): Promise<{ e: Envelope; s: Session }> {
    const e = await this.envelope();
    if (e.revision !== revision) fail('CONFLICT');
    const s = await this.active(e);
    if (s.epoch !== epoch) fail('CONFLICT');
    return { e, s };
  }
  update(revision: string, epoch: string, profile: unknown): Promise<string> {
    return this.run(async (accepted) => {
      const parsed = parseProfile(profile);
      const { e, s } = await this.authorized(revision, epoch);
      const raw = unbase64(s.raw);
      try {
        await open(e, raw); // Authenticate stored ciphertext before replacing it.
        await this.revoke();
        const next = await encrypt(parsed, raw, e.kdf, e.cipher.iv);
        await this.commit(next, e, accepted);
        return next.revision;
      } finally {
        raw.fill(0);
      }
    });
  }
  changePassword(
    revision: string,
    epoch: string,
    password: string,
  ): Promise<string> {
    return this.run(async (accepted) => {
      if (!passwordValid(password, true)) fail('INVALID_INPUT');
      const { e, s } = await this.authorized(revision, epoch);
      const raw = unbase64(s.raw);
      try {
        const profile = await open(e, raw);
        await this.revoke();
        const next = await seal(profile, password);
        await this.commit(next, e, accepted);
        return next.revision;
      } finally {
        raw.fill(0);
      }
    });
  }
  reset(confirmed: boolean): Promise<void> {
    if (confirmed !== true)
      return Promise.reject(new VaultError('INVALID_INPUT'));
    ++this.barrier;
    return this.run(async (accepted) => {
      const previous = await this.read(this.local, VAULT_KEY);
      await this.revoke();
      await this.commit(undefined, previous, accepted);
    });
  }
  /** Worker-only consumer. The caller must bind a concrete document and invoke
   * assertCurrent immediately before handing values to it. No callback from messages. */
  withProfile<T>(
    token: OperationToken,
    verifyDocument: () => Promise<boolean>,
    consume: (
      profile: FullProfile,
      assertCurrent: () => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.run(async (accepted) => {
      const parsed = tokenSchema.safeParse(token);
      if (!parsed.success) fail('INVALID_INPUT');
      const { e, s } = await this.authorized(token.revision, token.epoch);
      this.check(accepted);
      if (s.used.includes(token.operationId) || s.used.length >= 128)
        fail('CONFLICT');
      if (!(await verifyDocument())) fail('CANCELLED');
      this.check(accepted);
      const raw = unbase64(s.raw);
      try {
        if (!s.keep) await this.revoke();
        else {
          s.used.push(token.operationId);
          try {
            await this.session.set({ [SESSION_KEY]: s });
            if (
              canonical(await this.read(this.session, SESSION_KEY)) !==
              canonical(s)
            )
              fail('STORAGE_WRITE');
          } catch {
            await this.revoke();
            fail('STORAGE_WRITE');
          }
        }
        const assertCurrent = async () => {
          this.check(accepted);
          if (
            canonical(await this.envelope()) !== canonical(e) ||
            !(await verifyDocument())
          )
            fail('CANCELLED');
          this.check(accepted);
        };
        const profile = await open(e, raw);
        await assertCurrent();
        return await consume(profile, assertCurrent);
      } finally {
        raw.fill(0);
      }
    });
  }
}
