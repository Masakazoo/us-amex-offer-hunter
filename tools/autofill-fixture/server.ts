import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function startFixture() {
  const body = await readFile(new URL('./form.html', import.meta.url));
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/autofill-fixture') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    });
    response.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(4173, '127.0.0.1', resolve);
  });
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await startFixture();
  console.log('Local fixture: http://127.0.0.1:4173/autofill-fixture');
}
