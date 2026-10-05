import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// シェルや親プロセスの環境設定にかかわらず、本番フラグをビルド時に埋め込む。
const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build', '--turbopack'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, NEXT_PUBLIC_PRODUCTION: 'true' },
  stdio: 'inherit',
});
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
