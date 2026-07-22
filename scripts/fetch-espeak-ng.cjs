/**
 * Lädt espeak-ng Android-APK (offizielles Release) und extrahiert:
 * - espeak-ng-data → native-assets/espeak-ng-data
 * - libttsespeak.so → modules/.../jniLibs/<abi>/
 * - Quellcode (optional, für Header) → third_party/espeak-ng
 *
 * Usage: node scripts/fetch-espeak-ng.cjs
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ESPEAK_VERSION = '1.52.0';
const APK_NAME = `espeak-${ESPEAK_VERSION}-signed.apk`;
const APK_URL = `https://github.com/espeak-ng/espeak-ng/releases/download/${ESPEAK_VERSION}/${APK_NAME}`;

const SRC_DEST = path.join(
  ROOT,
  'modules',
  'findus-espeak',
  'android',
  'src',
  'main',
  'cpp',
  'third_party',
  'espeak-ng',
);
const JNI_DEST = path.join(
  ROOT,
  'modules',
  'findus-espeak',
  'android',
  'src',
  'main',
  'jniLibs',
);
const DATA_DEST = path.join(ROOT, 'native-assets', 'espeak-ng-data');
const TMP = path.join(ROOT, '.tmp-espeak');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    const get = (u) => {
      https
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            get(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${u}`));
            return;
          }
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve(dest)));
        })
        .on('error', reject);
    };
    get(url);
  });
}

function rimraf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }
}

function unzip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  // Prefer tar (Windows 10+), fallback Expand-Archive
  try {
    execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: 'pipe' });
    return;
  } catch (_) {
    /* fall through */
  }
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Force '${zipPath}' '${destDir}'"`,
    { stdio: 'inherit' },
  );
}

async function ensureSources() {
  const marker = path.join(SRC_DEST, 'src', 'include', 'espeak-ng', 'speak_lib.h');
  if (fs.existsSync(marker)) {
    console.log('[espeak] Headers already present');
    return;
  }
  console.log('[espeak] Downloading espeak-ng', ESPEAK_VERSION, 'source (headers)…');
  const zip = path.join(TMP, `espeak-ng-${ESPEAK_VERSION}.zip`);
  if (!fs.existsSync(zip)) {
    await download(
      `https://github.com/espeak-ng/espeak-ng/archive/refs/tags/${ESPEAK_VERSION}.zip`,
      zip,
    );
  }
  const extractTo = path.join(TMP, 'src-extract');
  rimraf(extractTo);
  unzip(zip, extractTo);
  const extracted = path.join(extractTo, `espeak-ng-${ESPEAK_VERSION}`);
  // Minimal: nur include + ggf. leer
  rimraf(SRC_DEST);
  fs.mkdirSync(path.join(SRC_DEST, 'src'), { recursive: true });
  copyDir(path.join(extracted, 'src', 'include'), path.join(SRC_DEST, 'src', 'include'));
  console.log('[espeak] Headers →', SRC_DEST);
}

async function ensureApkArtifacts() {
  const phontab = path.join(DATA_DEST, 'phontab');
  const soArm64 = path.join(JNI_DEST, 'arm64-v8a', 'libttsespeak.so');

  // 1) Native libs from APK
  if (!fs.existsSync(soArm64)) {
    console.log('[espeak] Downloading official Android APK (libs)…');
    const apkPath = path.join(TMP, APK_NAME);
    if (!fs.existsSync(apkPath)) {
      await download(APK_URL, apkPath);
    }
    const apkExtract = path.join(TMP, 'apk-extract');
    rimraf(apkExtract);
    const apkAsZip = path.join(TMP, 'espeak.apk.zip');
    fs.copyFileSync(apkPath, apkAsZip);
    unzip(apkAsZip, apkExtract);

    const libRoot = path.join(apkExtract, 'lib');
    if (!fs.existsSync(libRoot)) {
      throw new Error('lib/ not found in APK');
    }
    rimraf(JNI_DEST);
    for (const abi of fs.readdirSync(libRoot)) {
      const srcDir = path.join(libRoot, abi);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      const so = fs
        .readdirSync(srcDir)
        .find((f) => f.includes('espeak') && f.endsWith('.so'));
      if (!so) continue;
      const destDir = path.join(JNI_DEST, abi);
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(path.join(srcDir, so), path.join(destDir, 'libttsespeak.so'));
      console.log('[espeak] jniLibs', abi, '←', so);
    }
  } else {
    console.log('[espeak] jniLibs already present');
  }

  // 2) Data from Windows MSI (APK has no bundled data)
  if (!fs.existsSync(phontab)) {
    console.log('[espeak] Downloading espeak-ng.msi for data…');
    const msiPath = path.join(TMP, 'espeak-ng.msi');
    if (!fs.existsSync(msiPath)) {
      await download(
        `https://github.com/espeak-ng/espeak-ng/releases/download/${ESPEAK_VERSION}/espeak-ng.msi`,
        msiPath,
      );
    }
    const msiExtract = path.join(TMP, 'msi-extract');
    rimraf(msiExtract);
    fs.mkdirSync(msiExtract, { recursive: true });
    // Administrative install extracts files without registering
    execSync(
      `msiexec /a "${msiPath}" /qn TARGETDIR="${msiExtract}"`,
      { stdio: 'inherit' },
    );

    function findData(dir, depth = 0) {
      if (depth > 6 || !fs.existsSync(dir)) return null;
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        let st;
        try {
          st = fs.statSync(p);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (name === 'espeak-ng-data' && fs.existsSync(path.join(p, 'phontab'))) {
            return p;
          }
          const f = findData(p, depth + 1);
          if (f) return f;
        }
      }
      return null;
    }

    const dataSrc = findData(msiExtract);
    if (!dataSrc) {
      throw new Error('espeak-ng-data not found inside MSI extract');
    }
    rimraf(DATA_DEST);
    copyDir(dataSrc, DATA_DEST);
    console.log('[espeak] Data →', DATA_DEST);
  } else {
    console.log('[espeak] Data already present');
  }

  const hasDe =
    fs.existsSync(path.join(DATA_DEST, 'de_dict')) ||
    fs.existsSync(path.join(DATA_DEST, 'lang', 'de'));
  console.log(hasDe ? '[espeak] German voice data OK' : '[espeak] WARN: de voice missing?');
}

async function main() {
  fs.mkdirSync(TMP, { recursive: true });
  await ensureSources();
  await ensureApkArtifacts();
  fs.writeFileSync(
    path.join(ROOT, 'native-assets', 'espeak-ng.ready'),
    `${ESPEAK_VERSION}\nprebuilt-apk\n`,
  );
  console.log('[espeak] Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
