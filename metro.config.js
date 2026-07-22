const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

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
  ].join('|'),
);

module.exports = config;
