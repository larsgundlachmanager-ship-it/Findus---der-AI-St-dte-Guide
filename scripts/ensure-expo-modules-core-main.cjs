/**
 * expo-modules-core ships index.js as `module.exports = null` (Node stub)
 * and points "main" at src/index.ts for Metro. If main is ever flipped to
 * index.js, the release APK boots to a black screen:
 *   TypeError: Cannot read property 'requireOptionalNativeModule' of null
 */
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-modules-core',
  'package.json',
);

if (!fs.existsSync(pkgPath)) process.exit(0);

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const expected = 'src/index.ts';
if (pkg.main === expected) process.exit(0);

console.warn(
  `[ensure-expo-modules-core-main] fixing main: ${JSON.stringify(pkg.main)} → ${JSON.stringify(expected)}`,
);
pkg.main = expected;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
