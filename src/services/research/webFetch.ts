/**
 * Lightweight public-page / PDF text fetch for Findus research.
 * No login, no JS-rendered SPAs — honest fail if content unavailable.
 * Extracts links + forms for the open Web-Agent.
 */

const MAX_HTML_CHARS = 28_000;
const MAX_PDF_CHARS = 24_000;
const FETCH_TIMEOUT_MS = 14_000;
const MAX_LINKS = 40;
const MAX_FORMS = 8;

export type FetchedDoc = {
  url: string;
  kind: 'html' | 'pdf' | 'text' | 'unknown';
  text: string;
  ok: boolean;
  reason?: string;
  contentType?: string;
  /** Absolute http(s) links found on the page */
  links?: Array<{ href: string; label: string }>;
  /** Simple HTML forms (GET/POST action + field names) */
  forms?: Array<{
    action: string;
    method: 'get' | 'post';
    fields: Array<{ name: string; type: string; value?: string }>;
  }>;
};

function withTimeout(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function resolveUrl(base: string, href: string): string | null {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/i.test(u.protocol)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/** Extract navigable links from HTML for multi-step browsing. */
export function extractLinksFromHtml(
  html: string,
  baseUrl: string,
): Array<{ href: string; label: string }> {
  const out: Array<{ href: string; label: string }> = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const hrefRaw = m[1].trim();
    if (
      !hrefRaw ||
      hrefRaw.startsWith('#') ||
      /^(javascript:|tel:)/i.test(hrefRaw)
    ) {
      continue;
    }
    // mailto: behalten (Reservierungs-Mails)
    if (/^mailto:/i.test(hrefRaw)) {
      if (seen.has(hrefRaw)) continue;
      seen.add(hrefRaw);
      const label = stripHtml(m[2]).slice(0, 80) || 'E-Mail';
      out.push({ href: hrefRaw, label });
      if (out.length >= MAX_LINKS) break;
      continue;
    }
    const abs = resolveUrl(baseUrl, hrefRaw);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    const label = stripHtml(m[2]).slice(0, 80) || abs;
    out.push({ href: abs, label });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/** Extract simple forms for prefill / GET navigation. */
export function extractFormsFromHtml(
  html: string,
  baseUrl: string,
): NonNullable<FetchedDoc['forms']> {
  const forms: NonNullable<FetchedDoc['forms']> = [];
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let fm: RegExpExecArray | null;
  while ((fm = formRe.exec(html))) {
    const attrs = fm[1];
    const body = fm[2];
    const actionM = attrs.match(/action\s*=\s*["']([^"']*)["']/i);
    const methodM = attrs.match(/method\s*=\s*["']([^"']*)["']/i);
    const actionRaw = actionM?.[1]?.trim() || baseUrl;
    const action = resolveUrl(baseUrl, actionRaw || '.') || baseUrl;
    const method = /post/i.test(methodM?.[1] ?? '') ? 'post' : 'get';
    const fields: Array<{ name: string; type: string; value?: string }> = [];
    const inputRe =
      /<(input|select|textarea)\b([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
    let im: RegExpExecArray | null;
    while ((im = inputRe.exec(body))) {
      const iattrs = im[2];
      const nameM = iattrs.match(/\bname\s*=\s*["']([^"']+)["']/i);
      if (!nameM?.[1]) continue;
      const typeM = iattrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
      const valM = iattrs.match(/\bvalue\s*=\s*["']([^"']*)["']/i);
      const type = (typeM?.[1] || im[1] || 'text').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'image') continue;
      fields.push({
        name: nameM[1],
        type,
        value: valM?.[1],
      });
    }
    if (fields.length) {
      forms.push({ action, method, fields: fields.slice(0, 24) });
    }
    if (forms.length >= MAX_FORMS) break;
  }
  return forms;
}

/** Best-effort text extraction from simple / text-based PDFs. */
export function extractTextFromPdfBytes(bytes: Uint8Array): string {
  let raw = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    raw += String.fromCharCode(...slice);
  }

  const chunks: string[] = [];
  const litRe = /\((?:\\.|[^\\)]){2,200}\)/g;
  let m: RegExpExecArray | null;
  while ((m = litRe.exec(raw))) {
    let s = m[0].slice(1, -1);
    s = s
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
    if (/[A-Za-zÄÖÜäöüß0-9]{2,}/.test(s)) {
      chunks.push(s);
    }
  }

  const hexRe = /<([0-9A-Fa-f\s]{4,})>/g;
  while ((m = hexRe.exec(raw))) {
    const hex = m[1].replace(/\s+/g, '');
    if (hex.length % 2 !== 0 || hex.length > 400) continue;
    let s = '';
    for (let i = 0; i < hex.length; i += 2) {
      const code = parseInt(hex.slice(i, i + 2), 16);
      if (code >= 32 && code < 127) s += String.fromCharCode(code);
      else if (code === 10 || code === 13) s += '\n';
    }
    if (/[A-Za-zÄÖÜäöüß0-9]{3,}/.test(s)) chunks.push(s);
  }

  const joined = chunks.join(' ').replace(/[ \t]{2,}/g, ' ').trim();
  return joined.slice(0, MAX_PDF_CHARS);
}

export async function fetchPublicDocument(url: string): Promise<FetchedDoc> {
  const clean = url.trim();
  if (!/^https?:\/\//i.test(clean)) {
    return {
      url: clean,
      kind: 'unknown',
      text: '',
      ok: false,
      reason: 'invalid_url',
    };
  }

  try {
    const res = await fetch(clean, {
      method: 'GET',
      signal: withTimeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain,*/*',
        'User-Agent':
          'FindusResearchBot/1.0 (+https://findus.app; travel-assistant)',
      },
    });

    if (!res.ok) {
      return {
        url: clean,
        kind: 'unknown',
        text: '',
        ok: false,
        reason: `http_${res.status}`,
        contentType: res.headers.get('content-type') ?? undefined,
      };
    }

    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    const looksPdf =
      /application\/pdf/i.test(ctype) || /\.pdf(\?|$)/i.test(clean);

    if (looksPdf) {
      const buf = await res.arrayBuffer();
      const text = extractTextFromPdfBytes(new Uint8Array(buf));
      if (text.length < 40) {
        return {
          url: clean,
          kind: 'pdf',
          text: '',
          ok: false,
          reason: 'pdf_unreadable_or_scanned',
          contentType: ctype,
          links: [],
          forms: [],
        };
      }
      return {
        url: clean,
        kind: 'pdf',
        text: text.slice(0, MAX_PDF_CHARS),
        ok: true,
        contentType: ctype || 'application/pdf',
        links: [],
        forms: [],
      };
    }

  const html = await res.text();
    const text = stripHtml(html).slice(0, MAX_HTML_CHARS);
    const links = extractLinksFromHtml(html, clean);
    // Extra: PDF/ugd-URLs die nicht in <a> stecken (Wix etc.)
    const pdfRe =
      /https?:\/\/[^\s"'<>]+(?:\.pdf|_files\/ugd\/[^\s"'<>]+)/gi;
    const seen = new Set(links.map((l) => l.href));
    let pm: RegExpExecArray | null;
    while ((pm = pdfRe.exec(html))) {
      const href = pm[0].replace(/[),.;]+$/, '');
      if (seen.has(href)) continue;
      seen.add(href);
      const around = html
        .slice(Math.max(0, pm.index - 120), pm.index + 40)
        .toLowerCase();
      const label = /getränk|getraenk|drink/.test(around)
        ? 'Getränkekarte'
        : /speise|food|menu|karte/.test(around)
          ? 'Speisekarte'
          : 'PDF';
      links.push({ href, label });
      if (links.length >= MAX_LINKS) break;
    }
    const forms = extractFormsFromHtml(html, clean);
    if (text.length < 40 && !links.length) {
      return {
        url: clean,
        kind: 'html',
        text: '',
        ok: false,
        reason: 'empty_or_js_spa',
        contentType: ctype,
        links,
        forms,
      };
    }
    return {
      url: clean,
      kind: /text\/plain/i.test(ctype) ? 'text' : 'html',
      text,
      ok: true,
      contentType: ctype,
      links,
      forms,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reason = /abort/i.test(msg) ? 'timeout' : 'network_error';
    return { url: clean, kind: 'unknown', text: '', ok: false, reason };
  }
}

/** Build GET URL from form + field values (openable "submit"). */
export function buildGetFormUrl(
  action: string,
  fields: Record<string, string>,
): string {
  try {
    const u = new URL(action);
    for (const [k, v] of Object.entries(fields)) {
      if (v != null && String(v).length) u.searchParams.set(k, String(v));
    }
    return u.toString();
  } catch {
    return action;
  }
}
