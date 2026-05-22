const fs = require('fs');
const path = require('path');
try {
  const ts = require('typescript');
  const ver = ts.version || '';
  const major = parseInt(ver.split('.')[0], 10);
  if (major >= 6) {
    const p = path.join(__dirname, '..', 'tsconfig.json');
    let c = JSON.parse(fs.readFileSync(p, 'utf8'));
    c.compilerOptions = c.compilerOptions || {};
    c.compilerOptions.ignoreDeprecations = '6.0';
    fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
    process.stdout.write(`[patch-tsconfig] Added ignoreDeprecations for TS ${ver}\n`);
  }
} catch (e) {
  // skip if typescript not available yet
}
