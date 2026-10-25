import { readFileSync } from 'node:fs';
const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const version = read('package.json').version;
for (const path of ['apps/worker','apps/web','packages/sdk','packages/mcp-server','packages/create-ig-harness']) {
  if (read(`${path}/package.json`).version !== version) throw new Error(`Version mismatch: ${path}`);
}
if (!readFileSync(new URL('../README.md', import.meta.url), 'utf8').includes(`**現バージョン**: v${version}`)) throw new Error('README version mismatch');
console.log(`Release packages and README match ${version}. Internal db/ig-sdk/shared packages use independent versions.`);
