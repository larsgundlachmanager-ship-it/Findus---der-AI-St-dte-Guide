/**
 * Komprimiert Onboarding-PNGs (Stadt-Cover + Personas) für Repo/Uploads.
 * Stadt-Cover werden nicht mehr per require() gebündelt — dieses Script hält
 * die Dateien auf Disk klein für Cover-Upload-Pipelines.
 *
 * Usage: node scripts/compressOnboardingCovers.mjs
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ONBOARDING = path.join(ROOT, 'assets', 'onboarding');
const MAX_W = 1280;
const JPEG_Q = 82;

function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
    encoding: 'utf8',
  });
  return r.status === 0 ? String(r.stdout || '').split(/\r?\n/)[0].trim() : '';
}

function listPngs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listPngs(p));
    else if (/\.png$/i.test(ent.name)) out.push(p);
  }
  return out;
}

function compressWithMagick(magick, file) {
  const tmp = file.replace(/\.png$/i, '.tmp.jpg');
  const r = spawnSync(
    magick,
    [
      file,
      '-resize',
      `${MAX_W}x>`,
      '-strip',
      '-quality',
      String(JPEG_Q),
      tmp,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0 || !fs.existsSync(tmp)) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    return { ok: false, err: r.stderr || r.stdout || 'magick failed' };
  }
  const before = fs.statSync(file).size;
  const after = fs.statSync(tmp).size;
  // Keep PNG extension for upload scripts that expect *.png — overwrite with JPEG bytes only if smaller
  // Prefer writing .jpg next to source and leave PNG; for soft covers used by upload, rewrite PNG via magick to smaller PNG
  fs.unlinkSync(tmp);
  const pngTmp = file + '.opt.png';
  const r2 = spawnSync(
    magick,
    [
      file,
      '-resize',
      `${MAX_W}x>`,
      '-strip',
      '-define',
      'png:compression-level=9',
      pngTmp,
    ],
    { encoding: 'utf8' },
  );
  if (r2.status !== 0 || !fs.existsSync(pngTmp)) {
    if (fs.existsSync(pngTmp)) fs.unlinkSync(pngTmp);
    return { ok: false, err: r2.stderr || 'png optimize failed' };
  }
  const afterPng = fs.statSync(pngTmp).size;
  if (afterPng < before) {
    fs.renameSync(pngTmp, file);
    return { ok: true, before, after: afterPng };
  }
  fs.unlinkSync(pngTmp);
  return { ok: true, before, after: before, skipped: true };
}

function main() {
  const magick = which('magick') || which('convert');
  if (!magick) {
    console.error(
      'ImageMagick (magick) nicht gefunden. Installieren oder Persona/Hero manuell komprimieren.',
    );
    process.exit(1);
  }
  const files = listPngs(ONBOARDING).filter((f) => {
    const base = path.basename(f);
    return (
      /-soft\.png$/i.test(base) ||
      /^city-[^/]+\.png$/i.test(base) ||
      /^persona-/i.test(base) ||
      /^city-card-hero\.png$/i.test(base) ||
      /^map-bg\.png$/i.test(base) ||
      /[\\/]remote-covers[\\/]/i.test(f)
    );
  });
  let saved = 0;
  let beforeSum = 0;
  let afterSum = 0;
  for (const file of files) {
    const res = compressWithMagick(magick, file);
    if (!res.ok) {
      console.warn('skip', path.relative(ROOT, file), res.err);
      continue;
    }
    beforeSum += res.before;
    afterSum += res.after;
    saved += res.before - res.after;
    const rel = path.relative(ROOT, file);
    if (res.skipped) console.log('=', rel);
    else
      console.log(
        `✓ ${rel}  ${(res.before / 1024 / 1024).toFixed(2)}→${(res.after / 1024 / 1024).toFixed(2)} MB`,
      );
  }
  console.log(
    `\nGespart: ${(saved / 1024 / 1024).toFixed(1)} MB  (${(beforeSum / 1024 / 1024).toFixed(1)} → ${(afterSum / 1024 / 1024).toFixed(1)} MB)`,
  );
}

main();
