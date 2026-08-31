/**
 * expo-modules-core ships index.js as `module.exports = null` (Node stub).
 * Metro must resolve the real entry via "main" / "react-native" → src/index.ts.
 * If either points at index.js, release APKs boot to a black screen:
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
let changed = false;

if (pkg.main !== expected) {
  console.warn(
    `[ensure-expo-modules-core-main] fixing main: ${JSON.stringify(pkg.main)} → ${JSON.stringify(expected)}`,
  );
  pkg.main = expected;
  changed = true;
}

if (pkg['react-native'] !== expected) {
  console.warn(
    `[ensure-expo-modules-core-main] fixing react-native: ${JSON.stringify(pkg['react-native'])} → ${JSON.stringify(expected)}`,
  );
  pkg['react-native'] = expected;
  changed = true;
}

if (changed) {
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}
