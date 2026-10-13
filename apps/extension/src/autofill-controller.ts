import { isExtensionUI } from './extension-ui.js';
import { z } from 'zod';
import { fullFieldSpecs } from './full-profile.js';
import { runFullAutofill } from './full-autofill.js';
import { classifyTarget } from './target.js';
import { ProfileVault, type Status } from './vault/service.js';
import { fail, VaultError } from './vault/crypto.js';

declare const __AUTOFILL_FIXTURE__: boolean;
const allowFixture =
  typeof __AUTOFILL_FIXTURE__ !== 'undefined' && __AUTOFILL_FIXTURE__;
export const RESULT_KEY = 'autofillResultV1';
const fieldNames = fullFieldSpecs.map((s) => s.key);
export const fieldsSchema = z
  .array(
    z
      .object({
        field: z.string().refine((value) => fieldNames.includes(value)),
        status: z.enum([
          'ready',
          'filled',
          'matched',
          'missing',
          'ambiguous',
          'mismatch',
          'unavailable',
          'existing-value',
          'no-value',
          'invalid-value',
          'changed',
          'validation-error',
          'failed',
          'conditional',
          'not-present',
          'address-review',
        ]),
      })
      .strict(),
  )
  .max(36)
  .refine(
    (fields) => new Set(fields.map((f) => f.field)).size === fields.length,
  );
const binding = {
  tabId: z.number().int().nonnegative(),
  documentId: z.string().min(1).max(128),
};
const recordSchema = z
  .object({
    ...binding,
    operationId: z.uuid(),
    revision: z.uuid(),
    phase: z.enum([
      'running',
      'completed',
      'cancelled',
      'interrupted',
      'failed',
      'uncertain',
    ]),
    fields: fieldsSchema,
  })
  .strict();
export type RunRecord = z.infer<typeof recordSchema>;
export type Target = { tabId: number; documentId: string; url: string };
export type View = {
  target: { tabId: number; documentId: string } | null;
  status: Status | null;
  run: RunRecord | null;
  busy: boolean;
  unlocking: boolean;
};
const commands = z.discriminatedUnion('op', [
  z
    .object({ channel: z.literal('autofill-v1'), op: z.literal('view') })
    .strict(),
  z
    .object({
      channel: z.literal('autofill-v1'),
      op: z.literal('start'),
      ...binding,
      revision: z.uuid(),
      epoch: z.uuid(),
      operationId: z.uuid(),
    })
    .strict(),
  z
    .object({ channel: z.literal('autofill-v1'), op: z.literal('cancel') })
    .strict(),
  z
    .object({
      channel: z.literal('autofill-v1'),
      op: z.literal('guard'),
      operationId: z.uuid(),
      fields: fieldsSchema,
    })
    .strict(),
]);
export class AutofillController {
  unlocking = false;
  private record: RunRecord | null = null;
  private active: {
    target: Target;
    cancelled: boolean;
    assertCurrent?: () => Promise<void>;
  } | null = null;
  private writes: Promise<void> = Promise.resolve();
  private readonly ready: Promise<void>;
  constructor(private readonly vault: ProfileVault) {
    this.ready = (async () => {
      await chrome.storage.session.setAccessLevel({
        accessLevel: 'TRUSTED_CONTEXTS',
      });
      const parsed = recordSchema.safeParse(
        (await chrome.storage.session.get(RESULT_KEY))[RESULT_KEY],
      );
      this.record = parsed.success ? parsed.data : null;
      if (this.record?.phase === 'running') {
        this.record.phase = 'interrupted';
        await this.persist();
      }
    })();
  }
  private persist(): Promise<void> {
    const next = this.writes.then(async () => {
      if (this.record)
        await chrome.storage.session.set({ [RESULT_KEY]: this.record });
      else await chrome.storage.session.remove(RESULT_KEY);
    });
    this.writes = next.catch(() => {});
    return next;
  }
  // Called before lock, profile replacement or deletion. Never waits for decryption.
  invalidate(): void {
    if (this.active) this.active.cancelled = true;
    else {
      this.record = null;
      void this.ready
        .then(() => {
          this.record = null;
          return this.persist();
        })
        .catch(() => {});
    }
  }
  private async target(): Promise<Target | null> {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (
      tab?.id === undefined ||
      tab.incognito ||
      !classifyTarget(tab.url, allowFixture)
    )
      return null;
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: 'ISOLATED',
      func: runFullAutofill,
      args: [
        { command: { action: 'inspect' }, allowFixture, specs: fullFieldSpecs },
      ],
    });
    const fields = fieldsSchema.safeParse(injection?.result?.fields);
    if (
      !injection?.documentId ||
      injection.result?.state !== 'ok' ||
      !fields.success ||
      !['email', 'firstName', 'legalBusinessName'].every((key) =>
        fields.data.some(
          (f) =>
            f.field === key && ['ready', 'existing-value'].includes(f.status),
        ),
      )
    )
      return null;
    return { tabId: tab.id, documentId: injection.documentId, url: tab.url! };
  }
  private async verify(target: Target): Promise<boolean> {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (
        tab?.id !== target.tabId ||
        tab.url !== target.url ||
        !classifyTarget(tab.url, allowFixture)
      )
        return false;
      const [probe] = await chrome.scripting.executeScript({
        target: { tabId: target.tabId, documentIds: [target.documentId] },
        world: 'ISOLATED',
        func: () => location.href,
      });
      return (
        probe?.frameId === 0 &&
        probe.documentId === target.documentId &&
        probe.result === target.url
      );
    } catch {
      return false;
    }
  }
  private async view(): Promise<View> {
    const target = await this.target();
    const active = this.active;
    const status = active || this.unlocking ? null : await this.vault.status();
    const record = this.record;
    const run =
      record &&
      target &&
      record.tabId === target.tabId &&
      record.documentId === target.documentId &&
      (!status || record.revision === status.revision)
        ? structuredClone(record)
        : null;
    if (active && run && run.phase !== 'running') run.phase = 'running';
    return {
      target: target
        ? { tabId: target.tabId, documentId: target.documentId }
        : null,
      status,
      run,
      busy: !!active || this.unlocking,
      unlocking: this.unlocking,
    };
  }
  private async start(
    c: Extract<z.infer<typeof commands>, { op: 'start' }>,
  ): Promise<void> {
    if (this.active || this.unlocking) fail('CONFLICT');
    const target = await this.target();
    if (
      !target ||
      target.tabId !== c.tabId ||
      target.documentId !== c.documentId
    )
      fail('CANCELLED');
    if (this.active || this.unlocking) fail('CONFLICT');
    const active: NonNullable<AutofillController['active']> = {
      target,
      cancelled: false,
    };
    this.active = active;
    const record: RunRecord = {
      tabId: c.tabId,
      documentId: c.documentId,
      revision: c.revision,
      operationId: c.operationId,
      phase: 'running',
      fields: [],
    };
    this.record = record;
    try {
      await this.persist();
    } catch {
      record.phase = 'failed';
      this.active = null;
      fail('STORAGE_WRITE');
    }
    // Own the job independently of the popup request/port lifetime.
    void this.execute(c, active, record);
  }
  private async execute(
    c: Extract<z.infer<typeof commands>, { op: 'start' }>,
    active: NonNullable<AutofillController['active']>,
    record: RunRecord,
  ): Promise<void> {
    try {
      const result = await this.vault.withProfile(
        {
          tabId: c.tabId,
          documentId: c.documentId,
          revision: c.revision,
          epoch: c.epoch,
          operationId: c.operationId,
        },
        async () => !active.cancelled && (await this.verify(active.target)),
        async (profile, assertCurrent) => {
          active.assertCurrent = assertCurrent;
          await assertCurrent();
          const [reply] = await chrome.scripting.executeScript({
            target: { tabId: c.tabId, documentIds: [c.documentId] },
            world: 'ISOLATED',
            func: runFullAutofill,
            args: [
              {
                command: {
                  action: 'fill',
                  values: profile,
                  source: 'encrypted-vault',
                  expectedUrl: active.target.url,
                  operationId: c.operationId,
                },
                allowFixture,
                specs: fullFieldSpecs,
              },
            ],
          });
          if (reply?.documentId !== c.documentId || reply.frameId !== 0)
            fail('CANCELLED');
          return reply.result;
        },
      );
      const fields = fieldsSchema.safeParse(result?.fields);
      if (!fields.success || !['ok', 'cancelled'].includes(result?.state ?? ''))
        fail('CANCELLED');
      record.fields = fields.data;
      record.phase =
        active.cancelled || result?.state === 'cancelled'
          ? 'cancelled'
          : 'completed';
    } catch (error) {
      record.phase =
        active.cancelled ||
        (error instanceof VaultError && error.code === 'CANCELLED')
          ? 'cancelled'
          : 'failed';
    } finally {
      delete active.assertCurrent;
      // Keep ownership through the final write; a late storage failure must
      // never clear or corrupt a subsequent operation's record.
      try {
        await this.persist();
      } catch {
        record.phase = 'uncertain';
      } finally {
        if (this.active === active) this.active = null;
      }
    }
  }
  async handle(
    input: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<unknown> {
    try {
      await this.ready;
      const parsed = commands.safeParse(input);
      if (!parsed.success) fail('INVALID_INPUT');
      const c = parsed.data;
      if (c.op === 'guard') {
        const active = this.active;
        if (
          !active ||
          active.cancelled ||
          this.record?.operationId !== c.operationId ||
          sender.id !== chrome.runtime.id ||
          sender.tab?.id !== active.target.tabId ||
          sender.documentId !== active.target.documentId ||
          sender.frameId !== 0 ||
          sender.url !== active.target.url ||
          sender.origin !== new URL(active.target.url).origin ||
          !active.assertCurrent
        )
          fail('UNAUTHORIZED');
        await active.assertCurrent();
        this.record.fields = c.fields;
        await this.persist();
        if (active.cancelled) fail('CANCELLED');
        return { ok: true };
      }
      if (!isExtensionUI(sender, chrome.runtime.id, 'popup'))
        fail('UNAUTHORIZED');
      if (c.op === 'view') return { ok: true, view: await this.view() };
      if (c.op === 'cancel') this.invalidate();
      else await this.start(c);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof VaultError ? error.code : 'STORAGE_READ',
      };
    }
  }
}
