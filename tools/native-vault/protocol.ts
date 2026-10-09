import { endianness } from 'node:os';
import type { Readable } from 'node:stream';

const littleEndian = endianness() === 'LE';
export function encodeFrame(value: unknown) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > 32 * 1024) throw new Error('Invalid frame');
  const header = Buffer.alloc(4);
  if (littleEndian) header.writeUInt32LE(body.length);
  else header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

// Only a small, fixed request is accepted. Never echo incoming data or errors.
export async function readRequest(input: Readable): Promise<boolean> {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    const finish = (valid: boolean) => {
      clearTimeout(timer);
      input.off('data', onData);
      input.off('end', onEnd);
      input.off('error', onEnd);
      buffer.fill(0);
      resolve(valid);
    };
    const onEnd = () => finish(false);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 260) return finish(false);
      if (buffer.length < 4) return;
      const length = littleEndian
        ? buffer.readUInt32LE(0)
        : buffer.readUInt32BE(0);
      if (length < 1 || length > 256) return finish(false);
      if (buffer.length < length + 4) return;
      if (buffer.length !== length + 4) return finish(false);
      try {
        const request: unknown = JSON.parse(
          buffer.subarray(4).toString('utf8'),
        );
        finish(
          typeof request === 'object' &&
            request !== null &&
            !Array.isArray(request) &&
            Object.keys(request).length === 1 &&
            Object.hasOwn(request, 'action') &&
            (request as { action: unknown }).action === 'read-profile',
        );
      } catch {
        finish(false);
      }
    };
    const timer = setTimeout(onEnd, 10000);
    input.on('data', onData);
    input.once('end', onEnd);
    input.once('error', onEnd);
  });
}
