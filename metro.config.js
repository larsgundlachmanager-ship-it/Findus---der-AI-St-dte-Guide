const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

/** @google/genai → Web-Build (kein Node/Vertex). */
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@google/genai') {
    return {
      filePath: path.resolve(
        __dirname,
        'node_modules/@google/genai/dist/web/index.mjs',
      ),
      type: 'sourceFile',
    };
  }
  if (moduleName === '@google/genai/web') {
    return {
      filePath: path.resolve(
        __dirname,
        'node_modules/@google/genai/dist/web/index.mjs',
      ),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

/**
 * Native Build-Artefakte nicht crawlen/watchen.
 *
 * Wichtig: Kein `exclusionList()` verwenden — unter Windows ersetzt es `/` durch `\`,
 * der Metro-Watcher testet aber POSIX-Pfade (nur `/`). Dann greift die Blocklist nie
 * und Metro crasht mit ENOENT, sobald Gradle/CMake Temp-Ordner löscht.
 */
config.resolver.blockList = new RegExp(
  [
    '/android/',
    '/ios/',
    '/node_modules/[^/]+/android/',
    '/\\.cxx/',
    '/\\.gradle/',
    '/__tests__/',
    // Legacy ONNX under src/assets/piper — native only, not Metro
    '/src/assets/piper/.*\\.onnx$',
  ].join('|'),
);

module.exports = config;
