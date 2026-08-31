/**
 * Sync Expo app icons into android/app/src/main/res/mipmap-*
 * Uses the same generator as `expo prebuild` (@expo/prebuild-config).
 *
 * Usage: node scripts/sync-android-icons.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const appJson = require(path.join(projectRoot, 'app.json'));
const { setIconAsync } = require('@expo/prebuild-config/build/plugins/icons/withAndroidIcons');

const expo = appJson.expo;
const foregroundImage =
  expo.android?.adaptiveIcon?.foregroundImage ?? expo.icon;
const backgroundColor =
  expo.android?.adaptiveIcon?.backgroundColor ?? '#18181B';
const backgroundImage = expo.android?.adaptiveIcon?.backgroundImage ?? null;
const monochromeImage = expo.android?.adaptiveIcon?.monochromeImage ?? null;

if (!foregroundImage) {
  console.error('No icon / adaptiveIcon.foregroundImage in app.json');
  process.exit(1);
}

const absForeground = path.resolve(projectRoot, foregroundImage);
console.log('Sync Android icons from', absForeground);

await setIconAsync(projectRoot, {
  icon: foregroundImage,
  backgroundColor,
  backgroundImage,
  monochromeImage,
  isAdaptive: !!expo.android?.adaptiveIcon,
});

console.log('Done — mipmaps updated under android/app/src/main/res/');
