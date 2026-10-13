import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
const out = 'dist/security-spike';
await mkdir(out, { recursive: true });
await build({
  entryPoints: ['tools/security-spike/worker.ts'],
  outfile: `${out}/worker.js`,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
});
await build({
  entryPoints: ['tools/security-spike/harness.ts'],
  outfile: `${out}/harness.js`,
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
});
await writeFile(
  `${out}/manifest.json`,
  JSON.stringify({
    manifest_version: 3,
    name: 'Synthetic security spike — never enter personal data',
    version: '0.0.1',
    minimum_chrome_version: '120',
    permissions: ['storage'],
    background: { service_worker: 'worker.js', type: 'module' },
    action: { default_popup: 'harness.html' },
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; connect-src 'none'",
    },
  }),
);
await writeFile(
  `${out}/harness.html`,
  `<!doctype html><html lang="ja"><meta charset="utf-8"><title>Synthetic security harness</title>
  <h1>合成データ専用の検証</h1><p>実プロフィール・実パスワードは入力できません。外部フォームには入力しません。</p>
  <button data-op="create">合成データを作成</button>
  <label><input id="keep" type="checkbox" checked>解除保持 ON</label>
  <button data-op="unlock">合成パスワードで解除</button>
  <button data-op="use">合成データを1回使用</button>
  <button data-op="lock">ロック</button><button data-op="status">状態更新</button>
  <p><output id="status" aria-live="polite">確認中</output></p>
  <script src="harness.js"></script></html>`,
);
