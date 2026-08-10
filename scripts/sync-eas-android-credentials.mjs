/**
 * Sync android/keystore.properties → credentials.json (UTF-8, no BOM).
 * Needed for EAS local Android signing (credentialsSource: "local").
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const propsPath = path.join(root, 'android', 'keystore.properties');
const outPath = path.join(root, 'credentials.json');

if (!fs.existsSync(propsPath)) {
  console.error('Missing android/keystore.properties');
  process.exit(1);
}

const props = Object.fromEntries(
  fs
    .readFileSync(propsPath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const storeFile = props.storeFile || '';
const leaf = path.basename(storeFile);
const keystorePath = path.join('android', 'app', leaf).replace(/\\/g, '/');
const abs = path.join(root, keystorePath);
if (!fs.existsSync(abs)) {
  console.error(`Keystore not found: ${keystorePath}`);
  process.exit(1);
}

const cred = {
  android: {
    keystore: {
      keystorePath,
      keystorePassword: props.storePassword,
      keyAlias: props.keyAlias,
      keyPassword: props.keyPassword,
    },
  },
};

fs.writeFileSync(outPath, `${JSON.stringify(cred, null, 2)}\n`, 'utf8');
const raw = fs.readFileSync(outPath);
if (raw[0] === 0xef) {
  console.error('BOM detected after write — abort');
  process.exit(1);
}
console.log(`OK credentials.json → ${keystorePath} (alias ${props.keyAlias})`);
