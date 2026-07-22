const {
  withDangerousMod,
  createRunOncePlugin,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const pkg = { name: 'with-findus-espeak', version: '1.0.0' };

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
 * Kopiert native-assets/espeak-ng-data → android/app/src/main/assets/espeak-ng-data
 * damit FindusEspeakModule die Dateien aus Assets extrahieren kann.
 */
function withFindusEspeak(config) {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const src = path.join(projectRoot, 'native-assets', 'espeak-ng-data');
      const dest = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'assets',
        'espeak-ng-data',
      );

      if (!fs.existsSync(path.join(src, 'phontab'))) {
        console.warn(
          '[withFindusEspeak] FEHLT: native-assets/espeak-ng-data — bitte: npm run fetch:espeak',
        );
        return config;
      }

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      copyRecursive(src, dest);
      console.log('[withFindusEspeak] Android assets: espeak-ng-data gebündelt');
      return config;
    },
  ]);

  return config;
}

module.exports = createRunOncePlugin(withFindusEspeak, pkg.name, pkg.version);
