import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));

function toSourcePath(target) {
  return target.replace(/^\.\/dist\//, './').replace(/\.js$/, '.ts');
}

async function writeShim(defaultTarget, sourceTarget) {
  const absTarget = path.join(rootDir, defaultTarget);
  const absSource = path.join(rootDir, sourceTarget);
  const relSource = path.relative(path.dirname(absTarget), absSource).split(path.sep).join('/');
  const sourceRef = relSource.startsWith('.') ? relSource : `./${relSource}`;
  const contents = `export * from ${JSON.stringify(sourceRef)};\n`;

  await fs.mkdir(path.dirname(absTarget), { recursive: true });
  await fs.writeFile(absTarget, contents, 'utf8');
}

for (const target of Object.values(pkgJson.exports)) {
  if (typeof target !== 'string') continue;
  await writeShim(target, toSourcePath(target));
}
