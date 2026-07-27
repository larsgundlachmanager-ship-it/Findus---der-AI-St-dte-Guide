const {
  withDangerousMod,
  createRunOncePlugin,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const pkg = { name: 'with-piper-assets', version: '1.0.0' };

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return false;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (name === '.gitignore') continue;
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return true;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

/**
 * Kopiert native-assets/piper → android/app/src/main/assets/piper
 * (und iOS Supporting/piper), damit FileSystem.bundleDirectory die Dateien findet.
 */
function withPiperAssets(config) {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const src = path.join(projectRoot, 'native-assets', 'piper');
      const dest = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'assets',
        'piper',
      );

      if (!fs.existsSync(src)) {
        console.warn('[withPiperAssets] FEHLT: native-assets/piper/');
        console.warn(
          '[withPiperAssets] Bitte zuerst: node scripts/fetch-piper-voices.cjs',
        );
        return config;
      }

      const onnxFiles = fs
        .readdirSync(src)
        .filter((n) => n.endsWith('.onnx'));
      if (onnxFiles.length === 0) {
        console.warn(
          '[withPiperAssets] Keine .onnx in native-assets/piper/',
        );
        console.warn(
          '[withPiperAssets] Bitte zuerst: node scripts/fetch-piper-voices.cjs',
        );
        return config;
      }

      fs.mkdirSync(dest, { recursive: true });
      copyRecursive(src, dest);

      let totalBytes = 0;
      for (const name of onnxFiles) {
        const p = path.join(dest, name);
        if (fs.existsSync(p)) totalBytes += fs.statSync(p).size;
      }
      console.log(
        `[withPiperAssets] Android: piper gebündelt (${onnxFiles.length} Modelle, ${Math.round(totalBytes / 1e6)} MB)`,
      );
      return config;
    },
  ]);

  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const src = path.join(projectRoot, 'native-assets', 'piper');
      const dest = path.join(
        projectRoot,
        'ios',
        'Findus',
        'Supporting',
        'piper',
      );
      if (!fs.existsSync(src)) {
        return config;
      }
      const onnxFiles = fs
        .readdirSync(src)
        .filter((n) => n.endsWith('.onnx'));
      if (onnxFiles.length === 0) {
        return config;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      copyRecursive(src, dest);
      console.log('[withPiperAssets] iOS: piper nach Supporting/piper kopiert');
      return config;
    },
  ]);

  return config;
}

module.exports = createRunOncePlugin(
  withPiperAssets,
  pkg.name,
  pkg.version,
);
