import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const options = {
  osm: 'data-downloads/osm/asia-latest.osm.pbf', polygon: 'data/east-asia.poly',
  name: 'east-asia-2026', heap: '12g', skipBuild: false,
};
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--skip-build') { options.skipBuild = true; continue; }
  if (!['--osm', '--polygon', '--name', '--heap'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
  const value = process.argv[++i];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
  options[arg.slice(2)] = value;
}
if (!options.name || basename(options.name) !== options.name || /[/\\]/.test(options.name)) {
  throw new Error('--name must be a file name, without a directory');
}

const osm = resolve(root, options.osm);
const polygon = resolve(root, options.polygon);
const output = resolve(root, 'data-downloads/tiles-built', `${options.name}.pmtiles`);
const tmpdir = resolve(root, 'data-downloads/planetiler/tmp');
const manifestFile = resolve(root, 'data/tiles', `${options.name}.json`);
// Read input metadata before building; this is the acquisition time, not the build time.
const input = await stat(osm);
await stat(polygon);

if (!options.skipBuild) {
  await mkdir(dirname(output), { recursive: true });
  await mkdir(tmpdir, { recursive: true });
  await new Promise((accept, reject) => {
    const child = spawn('java', [`-Xmx${options.heap}`, '--enable-native-access=ALL-UNNAMED',
      '-jar', resolve(root, 'data-downloads/planetiler/planetiler.jar'), 'generate-custom',
      '--schema=' + resolve(root, 'data/roads.yml'), '--osm_path=' + osm, '--polygon=' + polygon,
      '--output=' + output, '--tmpdir=' + tmpdir, '--force'], { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`Planetiler failed (${signal ?? code})`)));
  });
}

const [{ stdout: metadataJson }, { stdout: head }, { stdout: dirty }] = await Promise.all([
  run(resolve(root, 'data-downloads/tools/pmtiles.exe'), ['show', output, '--metadata'], { cwd: root, windowsHide: true }),
  run('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true }),
  run('git', ['status', '--porcelain'], { cwd: root, windowsHide: true }),
]);
const metadata = JSON.parse(metadataJson);
const required = key => {
  if (!metadata[key]) throw new Error(`Tile archive is missing ${key}`);
  return metadata[key];
};
const hash = createHash('sha256');
for await (const chunk of createReadStream(output)) hash.update(chunk);
const manifest = {
  name: options.name,
  bytes: (await stat(output)).size,
  sha256: hash.digest('hex'),
  source: required('planetiler:osm:osmosisreplicationurl'),
  dataTime: required('planetiler:osm:osmosisreplicationtime'),
  acquired: input.mtime.toISOString(),
  input: { name: basename(osm), bytes: input.size },
  coverage: { name: '中国、港澳台、日本、韩国', polygon: relative(root, polygon).replaceAll('\\', '/') },
  tool: required('planetiler:version'),
  commit: head.trim() + (dirty.trim() ? '-dirty' : ''),
  license: 'ODbL, © OpenStreetMap contributors',
};
await mkdir(dirname(manifestFile), { recursive: true });
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${relative(root, manifestFile)} (${manifest.bytes.toLocaleString('en-US')} bytes)`);
