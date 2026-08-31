/**
 * Google Play financial reports via private GCS bucket.
 * Docs: gs://[pubsite_prod_rev_…]/sales/salesreport_YYYYMM.zip
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  PLAY_FEE_RATE,
  PLAY_PACKAGE,
  PLAY_REPORTS_BUCKET,
  PLAY_SERVICE_ACCOUNT_PATH,
  PLAY_VAT_RATE,
} from './config.mjs';

const require = createRequire(import.meta.url);
let JSZip = null;
try {
  JSZip = require('jszip');
} catch {
  /* optional until parse */
}

const GCS_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

function loadServiceAccount() {
  const p = PLAY_SERVICE_ACCOUNT_PATH;
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: GCS_SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  sign.end();
  const sig = b64url(sign.sign(sa.private_key));
  const assertion = `${unsigned}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Play GCS token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error('Play GCS: no access_token');
  return json.access_token;
}

async function gcsDownload(token, bucket, objectName) {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}?alt=media`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `GCS get ${objectName} → ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

async function gcsListPrefix(token, bucket, prefix) {
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`,
  );
  url.searchParams.set('prefix', prefix);
  url.searchParams.set('maxResults', '100');
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(
      `GCS list ${prefix} → ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  const json = await res.json();
  return (json.items || []).map((i) => i.name);
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (!cols.length || cols.every((c) => !c.trim())) continue;
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function unzipCsvs(zipBuf) {
  if (!JSZip) throw new Error('jszip not available');
  const zip = await JSZip.loadAsync(zipBuf);
  const texts = [];
  for (const name of Object.keys(zip.files)) {
    if (!/\.csv$/i.test(name) || zip.files[name].dir) continue;
    texts.push(await zip.files[name].async('string'));
  }
  return texts;
}

function pick(row, names) {
  for (const n of names) {
    if (row[n] != null && String(row[n]).trim() !== '') return String(row[n]).trim();
    const hit = Object.keys(row).find(
      (k) => k.toLowerCase() === n.toLowerCase(),
    );
    if (hit && String(row[hit]).trim() !== '') return String(row[hit]).trim();
  }
  return '';
}

function parseMoney(raw) {
  if (raw == null || raw === '') return 0;
  const s = String(raw).replace(/\s/g, '').replace(/€/g, '');
  // EU: 1.234,56 vs US: 1,234.56
  let normalized = s;
  if (/,/.test(s) && /\./.test(s)) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      normalized = s.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = s.replace(/,/g, '');
    }
  } else if (/,/.test(s)) {
    normalized = s.replace(',', '.');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // DD.MM.YYYY
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  // M/D/YYYY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthKeysForRange(from, to) {
  const keys = new Set();
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    keys.add(`${y}${m}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return [...keys];
}

function computePnl(grossBuyerEur, opts = {}) {
  const feeRate = opts.feeRate ?? PLAY_FEE_RATE;
  const vatRate = opts.vatRate ?? PLAY_VAT_RATE;
  const apiCostEur = opts.apiCostEur ?? 0;
  const playFeeEur = grossBuyerEur * feeRate;
  const afterPlay = grossBuyerEur - playFeeEur;
  const vatEur = afterPlay * vatRate;
  const netAfterTax = afterPlay - vatEur;
  const profitEur = netAfterTax - apiCostEur;
  return {
    grossBuyerEur,
    playFeeEur,
    playFeeRate: feeRate,
    afterPlayEur: afterPlay,
    vatEur,
    vatRate,
    netAfterTaxEur: netAfterTax,
    apiCostEur,
    profitEur,
  };
}

/**
 * @param {{ from: Date, to: Date, apiCostEur?: number }} range
 */
export async function fetchPlayWeeklyPnl(range) {
  const bucket = PLAY_REPORTS_BUCKET;
  const sa = loadServiceAccount();
  if (!bucket || !sa) {
    return {
      ok: false,
      skipped: true,
      reason: !bucket
        ? 'PLAY_REPORTS_BUCKET not set'
        : 'Play service account JSON missing (PLAY_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS)',
      pnl: computePnl(0, { apiCostEur: range.apiCostEur ?? 0 }),
      transactions: 0,
      refunds: 0,
      note: 'Configure Play GCS credentials to fill revenue.',
    };
  }

  const token = await getAccessToken(sa);
  const months = monthKeysForRange(range.from, range.to);
  const pkg = PLAY_PACKAGE.toLowerCase();
  let charged = 0;
  let refunded = 0;
  let txCharged = 0;
  let txRefunded = 0;
  const missingMonths = [];
  const notes = [];

  for (const ym of months) {
    const objectName = `sales/salesreport_${ym}.zip`;
    let buf;
    try {
      buf = await gcsDownload(token, bucket, objectName);
    } catch (err) {
      notes.push(String(err.message || err));
      continue;
    }
    if (!buf) {
      missingMonths.push(ym);
      continue;
    }
    const csvs = await unzipCsvs(buf);
    for (const text of csvs) {
      const { rows } = parseCsv(text);
      for (const row of rows) {
        const productId = pick(row, [
          'Product ID',
          'Product id',
          'Package ID',
          'Package Name',
          'product_id',
        ]).toLowerCase();
        if (productId && productId !== pkg && !productId.includes(pkg)) {
          continue;
        }
        const orderCharged = pick(row, [
          'Order Charged Date',
          'Transaction Date',
          'Order Charge Date',
          'Date',
        ]);
        const d = parseDate(orderCharged);
        if (d && (d < range.from || d > range.to)) continue;

        const status = pick(row, [
          'Financial Status',
          'Transaction Type',
          'Status',
        ]).toLowerCase();
        const amount = parseMoney(
          pick(row, [
            'Amount (Merchant Currency)',
            'Charged Amount',
            'Item Price',
            'Amount',
            'Buyer Currency Amount',
          ]),
        );
        const isRefund =
          /refund/.test(status) || amount < 0 || /chargeback/.test(status);
        if (isRefund) {
          refunded += Math.abs(amount);
          txRefunded += 1;
        } else if (
          /charg|sale|purchas/.test(status) ||
          (!status && amount > 0)
        ) {
          charged += Math.abs(amount);
          txCharged += 1;
        } else if (amount > 0) {
          charged += Math.abs(amount);
          txCharged += 1;
        }
      }
    }
  }

  // Try earnings for fee/tax sanity note
  let earningsHint = null;
  try {
    const names = await gcsListPrefix(
      token,
      bucket,
      `earnings/earnings_${months[months.length - 1]}`,
    );
    if (names.length) {
      earningsHint =
        'Earnings ZIP present — sales used for weekly estimate; earnings are monthly settlement.';
    }
  } catch {
    /* soft */
  }

  const gross = Math.max(0, charged - refunded);
  const pnl = computePnl(gross, { apiCostEur: range.apiCostEur ?? 0 });

  return {
    ok: true,
    skipped: false,
    package: PLAY_PACKAGE,
    bucket,
    months,
    missingMonths,
    transactions: txCharged,
    refunds: txRefunded,
    chargedEur: charged,
    refundedEur: refunded,
    pnl,
    notes: [
      ...notes,
      ...(earningsHint ? [earningsHint] : []),
      'Estimated Sales lag often 1–3 days; Sunday report may miss Fri–Sat late tx.',
      'Sales totals are buyer-paid before Play fee/tax; fee/VAT applied via FOUNDER config.',
    ],
  };
}

export { computePnl };
