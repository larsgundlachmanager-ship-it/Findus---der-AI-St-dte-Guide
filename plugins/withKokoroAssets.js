const {
  withDangerousMod,
  createRunOncePlugin,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const pkg = { name: 'with-kokoro-assets', version: '1.0.0' };

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return false;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return true;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

/**
 * Kopiert native-assets/kokoro → android/app/src/main/assets/kokoro
 * und iOS Resources/kokoro, damit FileSystem.bundleDirectory die Dateien findet.
 */
function withKokoroAssets(config) {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const src = path.join(projectRoot, 'native-assets', 'kokoro');
      const dest = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'assets',
        'kokoro',
      );

      const model = path.join(src, 'kokoro-martin.onnx');
      if (!fs.existsSync(model)) {
        console.warn(
          '[withKokoroAssets] FEHLT: native-assets/kokoro/kokoro-martin.onnx',
        );
        console.warn(
          '[withKokoroAssets] Bitte zuerst: npm run fetch:kokoro',
        );
        return config;
      }

      fs.mkdirSync(dest, { recursive: true });
      copyRecursive(src, dest);
      const size = fs.statSync(path.join(dest, 'kokoro-martin.onnx')).size;
      const wavesDir = path.join(dest, 'waves');
      let waveCount = 0;
      if (fs.existsSync(wavesDir)) {
        const countWavs = (dir) => {
          for (const name of fs.readdirSync(dir)) {
            const p = path.join(dir, name);
            if (fs.statSync(p).isDirectory()) countWavs(p);
            else if (name.endsWith('.wav')) waveCount += 1;
          }
        };
        countWavs(wavesDir);
      }
      console.log(
        `[withKokoroAssets] Android: kokoro gebündelt (${Math.round(size / 1e6)} MB, ${waveCount} WAVs)`,
      );
      return config;
    },
  ]);

  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const src = path.join(projectRoot, 'native-assets', 'kokoro');
      const dest = path.join(
        projectRoot,
        'ios',
        'Findus',
        'Supporting',
        'kokoro',
      );
      if (!fs.existsSync(path.join(src, 'kokoro-martin.onnx'))) {
        return config;
      }
      // iOS: optional – Ordner anlegen; Xcode-Link ggf. manuell
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      copyRecursive(src, dest);
      console.log('[withKokoroAssets] iOS: kokoro nach Supporting/kokoro kopiert');
      return config;
    },
  ]);

  return config;
}

module.exports = createRunOncePlugin(
  withKokoroAssets,
  pkg.name,
  pkg.version,
);
