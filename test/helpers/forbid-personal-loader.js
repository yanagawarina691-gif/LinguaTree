// Regression boundary: demo must not even load personal data/generation modules.
import { appendFileSync } from 'node:fs';

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (/\/src\/(?:db|services|routes)\//.test(result.url) ||
      /\/node_modules\/(?:better-sqlite3|openai|axios)\//.test(result.url)) {
    const message = `forbidden personal module: ${result.url}`;
    appendFileSync(process.env.DEMO_IO_TRIPWIRE, message + '\n');
    throw new Error(message);
  }
  return result;
}
