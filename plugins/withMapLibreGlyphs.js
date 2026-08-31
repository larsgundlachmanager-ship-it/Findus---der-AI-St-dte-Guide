const { withDangerousMod, createRunOncePlugin } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const pkg = { name: 'with-maplibre-glyphs', version: '1.0.0' };
const FONT = 'Noto Sans Regular';

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    if (fs.statSync(from).isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
  return true;
}

function withMapLibreGlyphs(config) {
  let next = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.projectRoot;
      const src = path.join(root, 'src/assets/homeMap/glyphs', FONT);
      const dest = path.join(
        root,
        'android/app/src/main/assets/fonts',
        FONT,
      );
      if (!fs.existsSync(path.join(src, '0-255.pbf'))) {
        console.warn('[withMapLibreGlyphs] keine Glyphen — npm run fehlt fetch');
        return cfg;
      }
      copyDir(src, dest);
      console.log('[withMapLibreGlyphs] Android fonts gebündelt');
      return cfg;
    },
  ]);
  next = withDangerousMod(next, [
    'ios',
    async (cfg) => {
      const root = cfg.modRequest.projectRoot;
      const src = path.join(root, 'src/assets/homeMap/glyphs', FONT);
      const dest = path.join(root, 'ios/Yorro/Fonts', FONT);
      if (!fs.existsSync(path.join(src, '0-255.pbf'))) {
        console.warn('[withMapLibreGlyphs] iOS: keine Glyphen');
        return cfg;
      }
      copyDir(src, dest);
      console.log('[withMapLibreGlyphs] iOS fonts gebündelt');
      return cfg;
    },
  ]);
  return next;
}

module.exports = createRunOncePlugin(withMapLibreGlyphs, pkg.name, pkg.version);
