import { z } from 'zod';
import {
  base64,
  derive,
  envelopeSchema,
  open,
  seal,
  unbase64,
} from './crypto.js';

// This extension is never bundled into the application. Test commands accept no PII.
const commandSchema = z
  .object({
    op: z.enum([
      'create',
      'unlock',
      'status',
      'use',
      'lock',
      'change',
      'delete',
    ]),
    password: z.string().min(1).max(1024).optional(),
    keep: z.boolean().optional(),
    expected: z.string().optional(),
    failBeforeCommit: z.boolean().optional(),
  })
  .strict();
const sessionSchema = z
  .object({ revision: z.uuid(), raw: z.string(), keep: z.boolean() })
  .strict();
const boot = crypto.randomUUID();
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);
let queue: Promise<unknown> = ready;
async function run(input: unknown) {
  await ready;
  const c = commandSchema.parse(input);
  if (c.op === 'lock') {
    await chrome.storage.session.remove('unlock');
    return { ok: true };
  }
  if (c.op === 'delete') {
    await chrome.storage.session.remove('unlock');
    await chrome.storage.local.remove('vault');
    return { ok: true };
  }
  const stored = (await chrome.storage.local.get('vault')).vault as unknown;
  const e = stored === undefined ? undefined : envelopeSchema.parse(stored);
  const candidate = sessionSchema.safeParse(
    (await chrome.storage.session.get('unlock')).unlock,
  );
  const s =
    candidate.success && candidate.data.revision === e?.revision
      ? candidate.data
      : undefined;
  if (c.op === 'status')
    return {
      ok: true,
      registered: !!e,
      unlocked: !!s,
      revision: e?.revision,
      boot,
    };
  if (c.op === 'create') {
    if (e) throw new Error('CONFLICT');
    const next = await seal(c.password ?? '');
    if (c.failBeforeCommit) throw new Error('STORAGE_WRITE');
    await chrome.storage.local.set({ vault: next });
    return { ok: true };
  }
  if (!e) throw new Error('NOT_REGISTERED');
  if (c.op === 'unlock') {
    await chrome.storage.session.remove('unlock');
    const raw = await derive(c.password ?? '', e);
    try {
      await open(e, raw);
      await chrome.storage.session.set({
        unlock: {
          revision: e.revision,
          raw: base64(raw),
          keep: c.keep ?? true,
        },
      });
      return { ok: true };
    } finally {
      raw.fill(0);
    }
  }
  if (!s) throw new Error('LOCKED');
  if (c.expected !== e.revision) throw new Error('CONFLICT');
  const raw = unbase64(s.raw);
  try {
    // Claim a one-shot before decrypting: a worker death must not permit replay.
    if (!s.keep || c.op === 'change')
      await chrome.storage.session.remove('unlock');
    await open(e, raw);
    if (c.op === 'change') {
      const next = await seal(c.password ?? '');
      if (c.failBeforeCommit) throw new Error('STORAGE_WRITE');
      await chrome.storage.local.set({ vault: next });
    }
    // Simulates an explicitly requested fill; no DOM, values or keys returned.
    return { ok: true };
  } finally {
    raw.fill(0);
  }
}
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL('harness.html')
  ) {
    respond({ ok: false, code: 'UNAUTHORIZED' });
    return false;
  }
  const job = queue.then(() => run(message));
  queue = job.catch(() => undefined);
  void job.then(respond, (error: unknown) => {
    const allowed = [
      'CONFLICT',
      'LOCKED',
      'NOT_REGISTERED',
      'INVALID_PASSWORD',
      'AUTH_OR_CORRUPT',
      'STORAGE_WRITE',
    ];
    respond({
      ok: false,
      code:
        error instanceof Error && allowed.includes(error.message)
          ? error.message
          : 'INVALID_OR_STORAGE',
    });
  });
  return true;
});
