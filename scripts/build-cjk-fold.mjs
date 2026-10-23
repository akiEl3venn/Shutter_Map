import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

function readCharacters(text) {
  const pairs = new Map();
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [source, candidates] = line.split('\t');
    const target = candidates?.split(/\s+/u)[0];
    if (Array.from(source ?? '').length !== 1 || Array.from(target ?? '').length !== 1) {
      throw new Error('Expected single-code-point OpenCC character mappings.');
    }
    pairs.set(source, target);
  }
  return pairs;
}

export async function main(args = process.argv.slice(2)) {
  let input = 'data-downloads/opencc';
  let output = 'src/search/cjkFold.ts';
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i + 1] || !['--in', '--out'].includes(args[i])) {
      throw new Error('Usage: node scripts/build-cjk-fold.mjs [--in directory] [--out file]');
    }
    if (args[i] === '--in') input = args[i + 1];
    else output = args[i + 1];
  }
  const traditional = readCharacters(await readFile(resolve(input, 'TSCharacters.txt'), 'utf8'));
  const japanese = readCharacters(await readFile(resolve(input, 'JPShinjitaiCharacters.txt'), 'utf8'));
  const combined = new Map(traditional);
  for (const [source, target] of japanese) combined.set(source, traditional.get(target) ?? target);
  const pairs = [...combined].filter(([source, target]) => source !== target);
  const source = [
    '// Generated from OpenCC TSCharacters and JPShinjitaiCharacters (Apache-2.0).',
    '// License: data/licenses/OpenCC-LICENSE. Do not edit by hand.',
    '// Generate: node scripts/build-cjk-fold.mjs --in data-downloads/opencc --out src/search/cjkFold.ts',
    `export const CJK_FOLD_PAIRS = ${JSON.stringify(pairs.flat().join(''))};`,
    '',
  ].join('\n');
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, source, 'utf8');
  console.log(`${output}: ${pairs.length} pairs, ${Buffer.byteLength(source)} bytes, gzip ${gzipSync(source).length} bytes`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
