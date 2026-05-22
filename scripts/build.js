const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tsconfigPath = path.join(root, 'tsconfig.json');
const buildConfigPath = path.join(root, 'tsconfig.build.json');

let major = 0;
try {
  const versionOut = execSync('npx --yes tsc --version 2>&1', { encoding: 'utf8', cwd: root });
  const m = versionOut.match(/Version\s+(\d+)/);
  major = m ? parseInt(m[1], 10) : 0;
} catch (e) {
  console.error('[build] tsc not found via npx either');
  process.exit(1);
}

if (major >= 6) {
  const base = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
  base.compilerOptions = base.compilerOptions || {};
  base.compilerOptions.ignoreDeprecations = '6.0';
  fs.writeFileSync(buildConfigPath, JSON.stringify(base, null, 2) + '\n');
  console.log(`[build] TS v${major}.x detected, using ignoreDeprecations: "6.0"`);
}

try {
  const projectFlag = major >= 6 ? `--project "${buildConfigPath}"` : '';
  execSync(`npx --yes tsc ${projectFlag}`, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' });
} finally {
  if (fs.existsSync(buildConfigPath)) fs.unlinkSync(buildConfigPath);
}
