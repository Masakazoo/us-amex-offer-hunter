import { buildExtension } from './extension-build.js';
const outdir = await buildExtension(process.env.AUTOFILL_FIXTURE === '1');
console.log(
  `PASS extension build: ${outdir} (encrypted settings + guarded autofill).`,
);
