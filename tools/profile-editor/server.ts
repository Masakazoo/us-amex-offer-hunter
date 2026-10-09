import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  readFile,
  lstat,
  realpath,
  open,
  rename,
  unlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import {
  fullProfileSchema,
  profileIssues,
} from '../../apps/extension/src/full-profile.js';
import { parseVaultProfile } from '../../apps/extension/src/vault-profile.js';

export async function startProfileEditor(directory: string, reveal = false) {
  const root = await realpath(directory);
  const file = join(root, 'profile.yaml');
  const checkFile = async () => {
    if (
      !(await lstat(file)).isFile() ||
      (await lstat(file)).isSymbolicLink() ||
      (await realpath(file)) !== file
    )
      throw new Error('Invalid file');
  };
  await checkFile();
  const original = await readFile(file, 'utf8');
  const profile = parseVaultProfile(original);
  if (!profile) throw new Error('Invalid profile');
  const token = randomBytes(32).toString('hex');
  const prefix = `/${token}/`;
  const revision = randomBytes(24).toString('hex');
  let origin = '';
  let saved = false;
  const done: { resolve?: () => void } = {};
  const finished = new Promise<void>((r) => {
    done.resolve = r;
  });
  const server = createServer((request, response) => {
    const run = async () => {
      const send = (
        status: number,
        body: string,
        type = 'application/json',
      ) => {
        response
          .writeHead(status, {
            'Content-Type': type,
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy':
              "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
          })
          .end(body);
      };
      if (
        request.headers.host !== new URL(origin).host ||
        !request.url?.startsWith(prefix)
      )
        return send(403, '{}');
      const route = request.url.slice(prefix.length);
      if (request.method === 'GET' && route === '')
        return send(
          200,
          await readFile(resolve('tools/profile-editor/index.html'), 'utf8'),
          'text/html; charset=utf-8',
        );
      if (
        request.method === 'GET' &&
        ['editor.js', 'editor.css'].includes(route)
      )
        return send(
          200,
          await readFile(
            resolve(
              route === 'editor.js'
                ? 'dist/profile-editor/editor.js'
                : 'tools/profile-editor/editor.css',
            ),
            'utf8',
          ),
          route.endsWith('.js') ? 'text/javascript' : 'text/css',
        );
      if (request.method === 'GET' && route === 'profile' && !saved)
        return send(200, JSON.stringify({ values: profile, revision }));
      if (request.method === 'POST' && route === 'save' && !saved) {
        if (
          request.headers.origin !== origin ||
          request.headers['content-type'] !== 'application/json'
        )
          return send(403, '{}');
        const source = await body(request);
        const parsed: unknown = JSON.parse(source);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          return send(400, '{}');
        const requestData = parsed as Record<string, unknown>;
        if (
          Object.keys(requestData).some(
            (k) => !['values', 'revision'].includes(k),
          ) ||
          requestData.revision !== revision
        )
          return send(400, '{}');
        const values = fullProfileSchema.parse(requestData.values);
        const issues = profileIssues(values);
        if (issues.length) return send(422, JSON.stringify({ issues }));
        await checkFile();
        if ((await readFile(file, 'utf8')) !== original)
          return send(409, JSON.stringify({ error: 'changed' }));
        const yaml =
          '# Amex full profile — keep inside the encrypted vault\n' +
          Object.entries(values)
            .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
            .join('\n') +
          '\n';
        const temporary = join(
          root,
          `.profile-${randomBytes(12).toString('hex')}.tmp`,
        );
        try {
          const handle = await open(temporary, 'wx', 0o600);
          try {
            await handle.writeFile(yaml, 'utf8');
            await handle.sync();
          } finally {
            await handle.close();
          }
          await checkFile();
          if ((await readFile(file, 'utf8')) !== original)
            throw new Error('Changed');
          await rename(temporary, file);
        } finally {
          await unlink(temporary).catch(() => {});
        }
        saved = true;
        send(200, JSON.stringify({ saved: true }));
        if (reveal)
          spawn('/usr/bin/open', ['-R', file], { stdio: 'ignore' }).unref();
        setTimeout(() => server.close(() => done.resolve?.()), 200);
        return;
      }
      return send(404, '{}');
    };
    void run().catch(() => {
      // Never return raw parser/filesystem errors, data, paths or stacks.
      if (!response.headersSent)
        response.writeHead(400, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
      response.end('{"error":"unable-to-save"}');
    });
  });
  await new Promise<void>((r, j) => {
    server.once('error', j);
    server.listen(0, '127.0.0.1', r);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Unable to start');
  origin = `http://127.0.0.1:${address.port}`;
  return { server, url: origin + prefix, finished };
}
async function body(request: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32768) throw new Error('Too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const directory = process.argv[2];
    if (!directory) throw new Error('Missing directory');
    const editor = await startProfileEditor(directory, true);
    spawn('/usr/bin/open', ['-a', 'Google Chrome', editor.url], {
      stdio: 'ignore',
    }).unref();
    console.log(
      'Chromeに本人情報の登録画面を開きました。画面内の「保管庫に保存」を押してください。',
    );
    await editor.finished;
    console.log('保管庫に保存しました。');
  } catch {
    console.error(
      '登録画面を開けませんでした。保管庫とprofile.yamlを確認してください。',
    );
    process.exitCode = 1;
  }
}
