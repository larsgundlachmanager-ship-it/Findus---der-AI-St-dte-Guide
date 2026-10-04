#!/usr/bin/env node
/**
 * afterFileEdit hook: auto-run gold:publish when ownerGold.pack.json changes.
 * Runs outside the Agent Shell approval path so the Founder never clicks Approve.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const LOCK = path.join(__dirname, '.gold-publish.lock');
const DEBOUNCE_MS = 2500;

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(chunks.join('')));
  });
}

function isGoldPack(filePath) {
  const n = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  return n.endsWith('/ownergold.pack.json') || n.endsWith('ownergold.pack.json');
}

function shouldSkipDebounce() {
  try {
    if (!fs.existsSync(LOCK)) return false;
    const age = Date.now() - Number(fs.readFileSync(LOCK, 'utf8') || 0);
    return Number.isFinite(age) && age >= 0 && age < DEBOUNCE_MS;
  } catch {
    return false;
  }
}

function touchLock() {
  try {
    fs.writeFileSync(LOCK, String(Date.now()), 'utf8');
  } catch {
    /* ignore */
  }
}

const raw = await readStdin();
let payload = {};
try {
  payload = raw ? JSON.parse(raw) : {};
} catch {
  process.exit(0);
}

if (!isGoldPack(payload.file_path)) {
  process.exit(0);
}

if (shouldSkipDebounce()) {
  process.exit(0);
}
touchLock();

const child = spawn(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'gold:publish'],
  {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  },
);
child.unref();
process.exit(0);
