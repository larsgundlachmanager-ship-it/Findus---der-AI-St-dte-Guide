/**
 * Diagnose APK icons + rebuild adaptive icon for Android safe zone (~66%).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function extractApkIcons() {
  const apkPath = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk');
  const outDir = path.join(root, 'assets/_icon-crops/apk-extract');
  fs.mkdirSync(outDir, { recursive: true });
  const buf = fs.readFileSync(apkPath);
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => n.includes('ic_launcher'));
  console.log('APK launcher entries:', names.length);
  for (const n of names) console.log(' ', n);
  const fg = names.find((n) => n.includes('xxxhdpi') && n.includes('foreground'));
  if (fg) {
    const data = await zip.files[fg].async('nodebuffer');
    const dest = path.join(outDir, 'apk-ic_launcher_foreground.webp');
    fs.writeFileSync(dest, data);
    console.log('extracted', fg, '->', dest, data.length);
  }
}

extractApkIcons().catch((e) => {
  console.error(e);
  process.exit(1);
});
