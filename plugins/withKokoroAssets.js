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
 * native-assets/kokoro → android/app/src/main/assets/kokoro
 * (Martin-ONNX + voices/de_eva.bin für Frauenstimmen)
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

      const onnx = path.join(src, 'kokoro-martin.onnx');
      const nova = path.join(src, 'voices', 'de_nova.bin');
      const bella = path.join(src, 'voices', 'de_bella.bin');
      if (!fs.existsSync(onnx) || !fs.existsSync(nova) || !fs.existsSync(bella)) {
        console.warn('[withKokoroAssets] FEHLT: native-assets/kokoro/');
        console.warn(
          '[withKokoroAssets] Erwartet: kokoro-martin.onnx + de_nova.bin + de_bella.bin',
        );
        return config;
      }

      fs.mkdirSync(dest, { recursive: true });
      copyRecursive(src, dest);
      const mb = Math.round(fs.statSync(path.join(dest, 'kokoro-martin.onnx')).size / 1e6);
      console.log(
        `[withKokoroAssets] Android: kokoro gebündelt (martin ${mb} MB + de_nova + de_bella)`,
      );
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
