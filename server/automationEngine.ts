import http from 'node:http';
import https from 'node:https';
import * as cheerio from 'cheerio';
import type {
  AutomationConfig,
  AutomationRunSummary,
  CookieEntry,
  DeviceProfile,
  DiscoveredLink,
  ProfileStepLog,
  RunningProfileState,
} from '../src/types/automation.ts';
import { generateDeviceMacAddress } from '../src/lib/fingerprint.ts';
import {
  buildSignUpIdentity,
  detectLocalBrowser,
  runDeviceInRealBrowser,
} from './browserEngine.ts';
import { rotateWindowsAdapterMac } from './macService.ts';
import {
  buildProxyAgent,
  syncDeviceProxyMetadata,
  verifySingleProxy,
} from './proxyService.ts';
import {
  broadcastEvent,
  cleanDeviceSession,
  cleanWorkspace,
  getState,
  getWorkspaceEpoch,
  persistStore,
  setActiveRunId,
  upsertRunningProfile,
} from './store.ts';

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

let abortCurrentRun = false;

export function stopActiveAutomation(): void {
  abortCurrentRun = true;
  const store = getState();
  if (store.activeRunId) {
    const run = store.runs.find((r) => r.id === store.activeRunId);
    if (run && run.status === 'running') {
      run.status = 'stopped';
      run.completedAt = new Date().toISOString();
    }
    setActiveRunId(null);
    persistStore();
    broadcastEvent('run_status', { runId: run?.id, status: 'stopped' });
  }
}

interface FetchResult {
  status: number;
  finalUrl: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  latencyMs: number;
  setCookies: string[];
}

function extractClientRedirectUrl(html: string, currentUrl: string): string | null {
  try {
    const $ = cheerio.load(html);
    const metaRefresh = $('meta[http-equiv="refresh" i]').attr('content');
    if (metaRefresh) {
      const m = metaRefresh.match(/url\s*=\s*['"]?([^'";]+)['"]?/i);
      if (m?.[1]) {
        return new URL(m[1].trim(), currentUrl).toString();
      }
    }

    const scripts = $('script')
      .map((_, el) => $(el).html() || '')
      .get()
      .join('\n');
    const jsMatch = scripts.match(
      /(?:window\.|top\.|self\.|document\.)?location(?:\.href|\.replace|\.assign|\s*=)\s*\(?\s*['"]((?:https?:)?\/\/[^'"]+|\/[^'"]+)['"]/i
    );
    if (jsMatch?.[1]) {
      return new URL(jsMatch[1].trim(), currentUrl).toString();
    }
  } catch {
    // Ignore malformed redirect URLs
  }
  return null;
}

async function fireEmbeddedTrackingBeacons(
  rawHtml: string,
  baseUrl: string,
  device: DeviceProfile
): Promise<void> {
  try {
    const $ = cheerio.load(rawHtml);
    const urls = new Set<string>();
    $('img[src], iframe[src], script[src]').each((_, el) => {
      if (urls.size >= 6) return;
      const src = ($(el).attr('src') || '').trim();
      if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;
      const tag = 'tagName' in el && typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '';
      const isPixelOrTracker =
        tag === 'iframe' ||
        /(track|pixel|beacon|collect|event|click|hit|imp|stat|analytics|gtag|postback|redirect)/i.test(src) ||
        (tag === 'img' && ($(el).attr('width') === '1' || $(el).attr('height') === '1'));
      if (!isPixelOrTracker) return;
      try {
        const resolved = new URL(src, baseUrl).toString();
        if (/^https?:\/\//i.test(resolved)) urls.add(resolved);
      } catch {
        // Ignore invalid URL
      }
    });
    if (urls.size === 0) return;
    await Promise.allSettled(
      Array.from(urls).map((u) => performDeviceRequest(u, device, baseUrl, true, 7))
    );
  } catch {
    // Ignore beacon parsing errors
  }
}

function performDeviceRequest(
  targetUrl: string,
  device: DeviceProfile,
  referer?: string,
  followRedirects = true,
  depth = 0,
  method: 'GET' | 'POST' = 'GET',
  formBody?: string
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      reject(new Error(`Invalid URL: ${targetUrl}`));
      return;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const mod = isHttps ? https : http;
    if (device.proxy && device.proxy.protocol !== 'direct') {
      // Never bypass an assigned proxy onto host network
    }
    const agent = buildProxyAgent(device.proxy);
    if (device.proxy && device.proxy.protocol !== 'direct' && !agent) {
      reject(new Error('Assigned proxy agent could not be constructed — blocked direct local IP request'));
      return;
    }

    const matchingCookies = device.session.cookies.filter((c) => {
      if (!c.domain) return true;
      const cleanDomain = c.domain.replace(/^\./, '').toLowerCase();
      return parsedUrl.hostname.toLowerCase().endsWith(cleanDomain);
    });
    const cookieHeader = matchingCookies.map((c) => `${c.name}=${c.value}`).join('; ');

    const headers: Record<string, string> = {
      'User-Agent': device.fingerprint.userAgent,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': device.fingerprint.languages
        .map((l, idx) => (idx === 0 ? l : `${l};q=${Math.max(0.5, 0.9 - idx * 0.1).toFixed(1)}`))
        .join(', '),
      'Cache-Control': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
    };

    if (device.fingerprint.clientHints.secChUa) {
      headers['Sec-CH-UA'] = device.fingerprint.clientHints.secChUa;
      headers['Sec-CH-UA-Mobile'] = device.fingerprint.clientHints.secChUaMobile;
      headers['Sec-CH-UA-Platform'] = device.fingerprint.clientHints.secChUaPlatform;
    }
    if (referer) headers['Referer'] = referer;
    if (cookieHeader) headers['Cookie'] = cookieHeader;
    if (method === 'POST' && formBody !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = String(Buffer.byteLength(formBody));
    }

    const req = mod.request(
      parsedUrl,
      {
        method,
        agent: agent as http.Agent | undefined,
        headers,
        timeout: 25000,
      },
      (res) => {
        const status = res.statusCode ?? 200;
        const setCookieHeader = res.headers['set-cookie'];
        const setCookies = Array.isArray(setCookieHeader)
          ? setCookieHeader
          : setCookieHeader
            ? [setCookieHeader]
            : [];

        // Persist cookies returned on this hop before following redirects so multi-hop trackers receive their session cookies
        if (setCookies.length > 0) {
          const parsedHopCookies = parseSetCookies(setCookies, parsedUrl.hostname);
          for (const ck of parsedHopCookies) {
            const existingIdx = device.session.cookies.findIndex(
              (e) => e.name === ck.name && e.domain === ck.domain
            );
            if (existingIdx >= 0) device.session.cookies[existingIdx] = ck;
            else device.session.cookies.push(ck);
          }
        }

        if (
          followRedirects &&
          status >= 300 &&
          status < 400 &&
          res.headers.location &&
          depth < 10
        ) {
          res.resume();
          const nextUrl = new URL(res.headers.location, parsedUrl).toString();
          performDeviceRequest(nextUrl, device, targetUrl, followRedirects, depth + 1)
            .then((nested) => {
              resolve({
                ...nested,
                setCookies: [...setCookies, ...nested.setCookies],
              });
            })
            .catch(reject);
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        const MAX_BYTES = 1024 * 600;
        res.on('data', (chunk: Buffer) => {
          if (bytes < MAX_BYTES) {
            chunks.push(chunk);
            bytes += chunk.length;
          }
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');

          // Follow <meta http-equiv="refresh"> or JS window.location redirects (e.g. tracking links)
          if (followRedirects && depth < 7 && method === 'GET') {
            const clientNext = extractClientRedirectUrl(body, parsedUrl.toString());
            if (clientNext && clientNext !== parsedUrl.toString()) {
              performDeviceRequest(
                clientNext,
                device,
                parsedUrl.toString(),
                followRedirects,
                depth + 1
              )
                .then((nested) => {
                  resolve({
                    ...nested,
                    setCookies: [...setCookies, ...nested.setCookies],
                  });
                })
                .catch(() => {
                  resolve({
                    status,
                    finalUrl: parsedUrl.toString(),
                    headers: res.headers,
                    body,
                    latencyMs: Date.now() - start,
                    setCookies,
                  });
                });
              return;
            }
          }

          resolve({
            status,
            finalUrl: parsedUrl.toString(),
            headers: res.headers,
            body,
            latencyMs: Date.now() - start,
            setCookies,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Request timed out after 25s'));
    });
    req.on('error', reject);
    if (method === 'POST' && formBody !== undefined) {
      req.write(formBody);
    }
    req.end();
  });
}

function parseSetCookies(rawHeaders: string[], fallbackDomain: string): CookieEntry[] {
  const entries: CookieEntry[] = [];
  for (const raw of rawHeaders) {
    const parts = raw.split(';').map((p) => p.trim());
    if (!parts[0] || !parts[0].includes('=')) continue;
    const eqIdx = parts[0].indexOf('=');
    const name = parts[0].slice(0, eqIdx).trim();
    const value = parts[0].slice(eqIdx + 1).trim();

    let domain = fallbackDomain;
    let path = '/';
    let httpOnly = false;
    let secure = false;
    let sameSite: 'Lax' | 'Strict' | 'None' = 'Lax';
    let expires = 'Session';

    for (const attr of parts.slice(1)) {
      const lower = attr.toLowerCase();
      if (lower.startsWith('domain=')) domain = attr.slice(7).trim();
      else if (lower.startsWith('path=')) path = attr.slice(5).trim() || '/';
      else if (lower === 'httponly') httpOnly = true;
      else if (lower === 'secure') secure = true;
      else if (lower.startsWith('samesite=')) {
        const val = attr.slice(9).trim().toLowerCase();
        sameSite = val === 'strict' ? 'Strict' : val === 'none' ? 'None' : 'Lax';
      } else if (lower.startsWith('expires=')) {
        expires = attr.slice(8).trim();
      } else if (lower.startsWith('max-age=')) {
        const sec = parseInt(attr.slice(8).trim(), 10);
        if (!Number.isNaN(sec)) {
          expires = new Date(Date.now() + sec * 1000).toISOString();
        }
      }
    }

    entries.push({
      id: uid('ck'),
      name,
      value,
      domain,
      path,
      httpOnly,
      secure,
      sameSite,
      expires,
    });
  }
  return entries;
}

function buildSanitizedPreviewHtml(rawHtml: string, baseUrl: string): string {
  try {
    const $ = cheerio.load(rawHtml);
    $('script, noscript, iframe').remove();
    if ($('head').length > 0) {
      $('head').prepend(`<base href="${baseUrl}" target="_blank" />`);
    } else {
      $.root().prepend(`<head><base href="${baseUrl}" target="_blank" /></head>`);
    }
    return $.html();
  } catch {
    return `<html><body style="font-family:sans-serif;padding:24px;"><h3>Preview Unavailable</h3><p>Target URL: ${baseUrl}</p></body></html>`;
  }
}

function extractClickableLinks(
  rawHtml: string,
  baseUrl: string,
  customSelector: string,
  preferSignup = false
): DiscoveredLink[] {
  const $ = cheerio.load(rawHtml);
  const links: Array<DiscoveredLink & { score: number }> = [];
  const seen = new Set<string>();

  const query = customSelector.trim()
    ? customSelector.trim()
    : 'a[href], button[formaction], [data-href], [data-url], [data-link], [onclick]';

  $(query).each((idx, el) => {
    if (links.length >= 25) return;
    const $el = $(el);
    let rawHref =
      $el.attr('href') ||
      $el.attr('formaction') ||
      $el.attr('data-href') ||
      $el.attr('data-url') ||
      $el.attr('data-link') ||
      '';
    if (!rawHref || /^javascript:/i.test(rawHref)) {
      const sourceJs = `${$el.attr('onclick') || ''} ${rawHref}`;
      const m = sourceJs.match(/['"]((?:https?:)?\/\/[^'"]+|\/[^'"]+)['"]/);
      if (m?.[1]) rawHref = m[1];
    }
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
      return;
    }
    let resolved = '';
    try {
      resolved = new URL(rawHref, baseUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:\/\//i.test(resolved) || seen.has(resolved)) return;
    seen.add(resolved);

    const text = $el.text().replace(/\s+/g, ' ').trim() || resolved;
    const tag = 'tagName' in el && typeof el.tagName === 'string' ? el.tagName.toLowerCase() : 'a';
    const idAttr = $el.attr('id') ? `#${$el.attr('id')}` : '';
    const classAttr = $el.attr('class')
      ? `.${$el.attr('class')!.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
    const selector = idAttr || `${tag}${classAttr}:nth-of-type(${idx + 1})`;

    const lower = `${text} ${resolved}`.toLowerCase();
    let score = 1;
    if (preferSignup && /(sign\s*up|register|create|join|get\s*started|weiter|fortfahren|jetzt|los|anmelden|registrieren|suivant|continuer|siguiente|continuar)/i.test(lower)) score += 30;
    if (/(get\s*started|continue|claim|sign\s*up|register|join|next|submit|weiter|fortfahren|nächste|absenden|bestätigen|suivant|continuer|siguiente|continuar|volgende|avanti|dalej)/i.test(lower)) score += 10;

    links.push({
      text: text.slice(0, 80),
      href: resolved,
      tag,
      selector,
      clicked: false,
      score,
    });
  });

  links.sort((a, b) => b.score - a.score);
  return links.map(({ score: _s, ...rest }) => rest);
}

async function submitHttpSignUpForm(
  rawHtml: string,
  baseUrl: string,
  device: DeviceProfile,
  config: AutomationConfig,
  deviceIndex = 0
): Promise<{
  submitted: boolean;
  filledCount: number;
  stepsSubmitted: number;
  result?: FetchResult;
  emailUsed: string;
}> {
  const identity = buildSignUpIdentity(device, config.signUpConfig, deviceIndex);
  let curHtml = rawHtml;
  let curUrl = baseUrl;
  let totalFilled = 0;
  let stepsSubmitted = 0;
  let lastResult: FetchResult | undefined;

  for (let step = 0; step < 4; step++) {
    const $ = cheerio.load(curHtml);
    const forms = $('form').toArray();
    if (forms.length === 0) break;

    const targetForm =
      forms.find(
        (f) =>
          $(f).find(
            'input[type="email"], input[type="password"], input[type="radio"], input[name*="mail" i], select'
          ).length > 0
      ) ?? forms[0];

    const $form = $(targetForm);
    const actionAttr = $form.attr('action') || curUrl;
    const method = (($form.attr('method') || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST') as
      | 'GET'
      | 'POST';
    let actionUrl = curUrl;
    try {
      actionUrl = new URL(actionAttr, curUrl).toString();
    } catch {
      break;
    }

    const params = new URLSearchParams();
    let stepFilled = 0;
    const radioGroups = new Map<string, string[]>();

    $form.find('input, select, textarea').each((_, el) => {
      const $el = $(el);
      const name = $el.attr('name');
      if (!name) return;
      const tag = (el.tagName || '').toLowerCase();
      const type = ($el.attr('type') || 'text').toLowerCase();
      const val = $el.attr('value') || '';

      if (type === 'hidden') {
        params.append(name, val);
        return;
      }
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') return;

      if (type === 'radio') {
        const list = radioGroups.get(name) ?? [];
        list.push(val || 'on');
        radioGroups.set(name, list);
        return;
      }
      if (type === 'checkbox') {
        params.append(name, val || 'on');
        stepFilled++;
        return;
      }
      if (tag === 'select') {
        const opts = $el
          .find('option')
          .toArray()
          .map((o) => ({
            val: $(o).attr('value') ?? $(o).text().trim(),
            txt: $(o).text().trim(),
          }))
          .filter((o) => Boolean(o.val || o.txt) && !/^(select|choose|pick|--)/i.test(o.txt));
        if (opts.length > 0) {
          const selectHint = `${name} ${$el.attr('id') || ''} ${$el.closest('div, li, fieldset').text()}`.toLowerCase();
          let matched = opts.find((o) => {
            const t = `${o.val} ${o.txt}`.toLowerCase();
            if (/country|nation/.test(selectHint)) {
              return t.includes(identity.country.toLowerCase()) || t === identity.countryCode.toLowerCase();
            }
            if (/gender|sex/.test(selectHint)) {
              return t.startsWith(identity.gender.toLowerCase());
            }
            if (/state|province/.test(selectHint)) {
              return t.includes(identity.state.toLowerCase());
            }
            if (/birth.?year|yob|year/.test(selectHint)) {
              return t.includes(identity.birthYear);
            }
            if (/month/.test(selectHint)) {
              return t.includes(identity.birthMonthName.toLowerCase()) || t === String(identity.birthMonthNum) || t === identity.birthMonth;
            }
            if (/day/.test(selectHint)) {
              return t === identity.birthDay || t === String(Number(identity.birthDay));
            }
            return false;
          });
          const picked = matched || opts[Math.floor(Math.random() * opts.length)];
          params.append(name, picked.val || picked.txt);
          stepFilled++;
        }
        return;
      }

      const idAttr = $el.attr('id') || '';
      const labelText = idAttr ? $form.find(`label[for="${idAttr}"]`).text() : $el.closest('label').text();
      const wrapText = $el.closest('div, li, fieldset').text().slice(0, 140);
      const hint = `${name} ${idAttr} ${$el.attr('placeholder') || ''} ${$el.attr('aria-label') || ''} ${labelText} ${wrapText}`.toLowerCase();
      if (/(search|query|captcha)/.test(hint)) return;
      if (/confirm.*e-?mail|re.?enter.*e-?mail/.test(hint)) {
        params.append(name, identity.email);
        stepFilled++;
      } else if (type === 'email' || /e-?mail|gmail/.test(hint)) {
        params.append(name, identity.email);
        stepFilled++;
      } else if (/confirm.*pass|re.?enter.*pass/.test(hint)) {
        params.append(name, identity.password);
        stepFilled++;
      } else if (type === 'password' || /pass(word|code)?/.test(hint)) {
        params.append(name, identity.password);
        stepFilled++;
      } else if (type === 'tel' || /(phone|mobile|cell|whatsapp|tel)/.test(hint)) {
        params.append(name, identity.phone);
        stepFilled++;
      } else if (/(address.*2|apt|suite|unit)/.test(hint)) {
        params.append(name, 'Apt 2B');
        stepFilled++;
      } else if (/(address|street|addr)/.test(hint)) {
        params.append(name, identity.streetAddress);
        stepFilled++;
      } else if (/(zip|postal|postcode)/.test(hint)) {
        params.append(name, identity.zip);
        stepFilled++;
      } else if (/(city|town|suburb)/.test(hint)) {
        params.append(name, identity.city);
        stepFilled++;
      } else if (/(state|province|region)/.test(hint)) {
        params.append(name, identity.state);
        stepFilled++;
      } else if (/(country|nation)/.test(hint)) {
        params.append(name, identity.country);
        stepFilled++;
      } else if (/(birth.?year|yob)/.test(hint)) {
        params.append(name, identity.birthYear);
        stepFilled++;
      } else if (/(birth.?month)/.test(hint)) {
        params.append(name, identity.birthMonth);
        stepFilled++;
      } else if (/(birth.?day)/.test(hint)) {
        params.append(name, identity.birthDay);
        stepFilled++;
      } else if (/(dob|date.?of.?birth|birthday)/.test(hint)) {
        params.append(name, type === 'date' ? identity.dobIso : identity.dobUs);
        stepFilled++;
      } else if (/\bage\b/.test(hint)) {
        params.append(name, identity.age);
        stepFilled++;
      } else if (/(gender|sex)/.test(hint)) {
        params.append(name, identity.gender);
        stepFilled++;
      } else if (/(first.?name|fname|given)/.test(hint)) {
        params.append(name, identity.firstName);
        stepFilled++;
      } else if (/(last.?name|lname|surname|family)/.test(hint)) {
        params.append(name, identity.lastName);
        stepFilled++;
      } else if (/(user.?name|handle)/.test(hint)) {
        params.append(name, identity.username);
        stepFilled++;
      } else if (/(company|organization|employer)/.test(hint)) {
        params.append(name, identity.company);
        stepFilled++;
      } else {
        params.append(name, val || identity.fullName);
        stepFilled++;
      }
    });

    for (const [rName, rVals] of radioGroups) {
      if (rVals.length > 0) {
        const chosen = rVals[Math.floor(Math.random() * rVals.length)];
        params.append(rName, chosen);
        stepFilled++;
      }
    }

    if (stepFilled === 0) break;

    const encoded = params.toString();
    const submitUrl =
      method === 'GET' ? `${actionUrl}${actionUrl.includes('?') ? '&' : '?'}${encoded}` : actionUrl;

    try {
      const result = await performDeviceRequest(
        submitUrl,
        device,
        curUrl,
        config.followRedirects,
        0,
        method,
        method === 'POST' ? encoded : undefined
      );
      totalFilled += stepFilled;
      stepsSubmitted++;
      lastResult = result;
      if (result.finalUrl === curUrl && result.body === curHtml) break;
      curHtml = result.body;
      curUrl = result.finalUrl;
    } catch {
      break;
    }
  }

  return {
    submitted: stepsSubmitted > 0,
    filledCount: totalFilled,
    stepsSubmitted,
    result: lastResult,
    emailUsed: identity.email,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sleepInterruptible(ms: number, shouldAbort: () => boolean): Promise<void> {
  const stepMs = 500;
  let elapsed = 0;
  while (elapsed < ms && !shouldAbort()) {
    await sleep(Math.min(stepMs, ms - elapsed));
    elapsed += stepMs;
  }
}

function pickHttpStayMs(config: AutomationConfig): number {
  const minSec =
    typeof config.minDwellSec === 'number' && Number.isFinite(config.minDwellSec) && config.minDwellSec >= 1
      ? config.minDwellSec
      : 30;
  const maxSecRaw =
    typeof config.maxDwellSec === 'number' && Number.isFinite(config.maxDwellSec) && config.maxDwellSec >= 1
      ? config.maxDwellSec
      : Math.max(120, minSec);
  const maxSec = Math.max(minSec, maxSecRaw);
  return Math.round((minSec + Math.random() * (maxSec - minSec)) * 1000);
}

function appendStep(
  profile: RunningProfileState,
  phase: ProfileStepLog['phase'],
  message: string,
  detail?: string
): void {
  profile.activePhase = message;
  profile.updatedAt = new Date().toISOString();
  profile.steps.push({
    id: uid('st'),
    timestamp: profile.updatedAt,
    phase,
    message,
    detail,
  });
  if (profile.steps.length > 80) {
    profile.steps = profile.steps.slice(-80);
  }
  upsertRunningProfile({ ...profile });
}

function saveResponseCookies(
  setCookies: string[],
  finalUrl: string,
  device: DeviceProfile,
  runningState: RunningProfileState
): void {
  if (setCookies.length === 0) return;
  const host = new URL(finalUrl).hostname;
  const parsedCookies = parseSetCookies(setCookies, host);
  for (const ck of parsedCookies) {
    const existingIdx = device.session.cookies.findIndex(
      (e) => e.name === ck.name && e.domain === ck.domain
    );
    if (existingIdx >= 0) device.session.cookies[existingIdx] = ck;
    else device.session.cookies.push(ck);
  }
  runningState.cookiesCapturedCount = device.session.cookies.length;
}

async function runSingleDevice(
  device: DeviceProfile,
  deviceIndex: number,
  config: AutomationConfig,
  runId: string,
  summary: AutomationRunSummary,
  startEpoch: number
): Promise<void> {
  if (abortCurrentRun || getWorkspaceEpoch() !== startEpoch) return;

  device.status = 'running';

  const store = getState();
  const hasImportedProxies = store.proxies.some((p) => p.protocol !== 'direct');
  let activeProxy = device.proxyId
    ? store.proxies.find((p) => p.id === device.proxyId) ?? device.proxy
    : device.proxy;

  if (hasImportedProxies && (!activeProxy || activeProxy.protocol === 'direct')) {
    const usedIds = new Set(store.devices.map((d) => d.proxyId).filter(Boolean));
    const replacement =
      store.proxies.find((p) => p.protocol !== 'direct' && p.status === 'online' && !usedIds.has(p.id)) ??
      store.proxies.find((p) => p.protocol !== 'direct' && p.status !== 'offline' && !usedIds.has(p.id)) ??
      store.proxies.find((p) => p.protocol !== 'direct' && p.status === 'online');
    if (replacement) {
      syncDeviceProxyMetadata(device, replacement);
      activeProxy = replacement;
    }
  }

  const initialProxyLoc = activeProxy
    ? [activeProxy.city, activeProxy.countryCode || activeProxy.country, activeProxy.exitIp]
        .filter(Boolean)
        .join(' · ') || activeProxy.host
    : 'Direct Host';

  const initialProxyLabel = activeProxy
    ? `${activeProxy.protocol}://${activeProxy.host}${activeProxy.port ? `:${activeProxy.port}` : ''}`
    : 'direct://local';

  const runningState: RunningProfileState = {
    deviceId: device.id,
    deviceName: device.name,
    runId,
    status: 'running',
    activePhase: 'Verifying proxy exit IP & browser profile',
    currentUrl: config.targetUrl,
    pageTitle: 'Connecting…',
    httpStatus: null,
    latencyMs: null,
    proxyLabel: initialProxyLabel,
    proxyLocation: initialProxyLoc,
    userAgentLabel: device.userAgent.label,
    viewportWidth: device.fingerprint.viewportWidth,
    viewportHeight: device.fingerprint.viewportHeight,
    clickTargetText: null,
    clickCoordinates: null,
    discoveredLinks: [],
    clickedUrls: [],
    cookiesCapturedCount: device.session.cookies.length,
    previewHtml: '',
    screenshotDataUrl: null,
    engineUsed: 'http',
    formSubmitted: false,
    steps: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
  };

  upsertRunningProfile(runningState);

  try {
    if (hasImportedProxies && (!activeProxy || activeProxy.protocol === 'direct')) {
      throw new Error(
        'Device has no imported proxy assigned. Blocked local IP execution — import/check proxies first.'
      );
    }

    if (activeProxy && activeProxy.protocol !== 'direct') {
      if (
        activeProxy.status !== 'online' ||
        !activeProxy.exitIp ||
        !activeProxy.timezone ||
        !activeProxy.countryCode
      ) {
        appendStep(
          runningState,
          'proxy_connect',
          `Verifying proxy exit IP (${activeProxy.host}:${activeProxy.port})…`,
          initialProxyLabel
        );
        await verifySingleProxy(activeProxy);
        if (abortCurrentRun || getWorkspaceEpoch() !== startEpoch) return;
      }

      if (activeProxy.status !== 'online' && config.proxyFailover !== false) {
        const candidates = getState().proxies.filter(
          (p) => p.protocol !== 'direct' && p.id !== activeProxy?.id && p.status !== 'offline'
        );
        for (const cand of candidates.slice(0, 3)) {
          if (cand.status !== 'online' || !cand.exitIp) {
            await verifySingleProxy(cand);
          }
          if (cand.status === 'online') {
            activeProxy = cand;
            break;
          }
        }
      }

      if (!activeProxy || activeProxy.status !== 'online') {
        throw new Error(
          `Proxy ${activeProxy?.host ?? ''}:${activeProxy?.port ?? ''} is offline/unreachable (${activeProxy?.error || 'tunnel failed'}) — blocked local IP fallback`
        );
      }

      // Bind live exit IP geo metadata + timezone + geolocation strictly to the proxy
      syncDeviceProxyMetadata(device, activeProxy);
      runningState.deviceName = device.name;
      runningState.proxyLabel = `${activeProxy.protocol}://${activeProxy.host}:${activeProxy.port}`;
      runningState.proxyLocation =
        [activeProxy.city, activeProxy.countryCode || activeProxy.country, activeProxy.exitIp]
          .filter(Boolean)
          .join(' · ') || activeProxy.exitIp || activeProxy.host;

      appendStep(
        runningState,
        'proxy_connect',
        `Verified Proxy Exit IP: ${activeProxy.exitIp || activeProxy.host} (${activeProxy.countryCode || 'NET'}${activeProxy.city ? ` · ${activeProxy.city}` : ''})`,
        `${runningState.proxyLabel} · Zero local DNS leak`
      );
    } else {
      appendStep(
        runningState,
        'proxy_connect',
        `Routing session via ${runningState.proxyLocation}`,
        runningState.proxyLabel
      );
    }
    if (abortCurrentRun) return;

    const profileMac =
      device.fingerprint.macAddress || generateDeviceMacAddress(device.fingerprint.seed);
    device.fingerprint.macAddress = profileMac;

    appendStep(
      runningState,
      'fingerprint_bind',
      `Applying ${device.fingerprint.os} fingerprint synced to ${device.fingerprint.timezone}`,
      `MAC ${profileMac} · Canvas ${device.fingerprint.canvasHash} · Locale ${device.fingerprint.languages[0]}${summary.macChangeSummary ? ` · ${summary.macChangeSummary}` : ''}`
    );
    if (abortCurrentRun) return;

    const browserInfo = detectLocalBrowser(config.customBrowserPath);
    const canTryPlaywrightChannel =
      process.platform === 'win32' || process.platform === 'darwin';
    const useRealBrowser =
      config.executionEngine !== 'http_fast' &&
      (browserInfo.available || canTryPlaywrightChannel);

    if (config.executionEngine === 'real_browser' && !browserInfo.available && !canTryPlaywrightChannel) {
      throw new Error(
        'Chrome/Edge browser binary not found on this host. Download and run ProfileGrid.exe on your Windows PC, or switch Execution Engine to Auto.'
      );
    }

    if (config.headedBrowser && !useRealBrowser) {
      appendStep(
        runningState,
        'navigate',
        'Live Chrome/Edge window requires running ProfileGrid.exe on Windows PC',
        'Cloud preview server has no GUI display; continuing with HTTP engine'
      );
    }

    if (useRealBrowser) {
      const invokeBrowser = (targetDevice: DeviceProfile) =>
        runDeviceInRealBrowser({
          executablePath: browserInfo.executablePath,
          device: targetDevice,
          deviceIndex,
          config,
          runningState,
          shouldAbort: () => abortCurrentRun || getWorkspaceEpoch() !== startEpoch,
          appendStep,
          onStateSync: (profile) => upsertRunningProfile({ ...profile }),
          onClickExecuted: () => {
            device.totalClicks += 1;
            summary.totalClicksExecuted += 1;
            broadcastEvent('run_summary', summary);
          },
        });

      const attemptedProxyIds = new Set<string>(device.proxyId ? [device.proxyId] : []);
      let activeAttemptDevice: DeviceProfile = device;

      for (let proxyTry = 0; proxyTry < 3; proxyTry++) {
        try {
          await invokeBrowser(activeAttemptDevice);
          if (activeAttemptDevice !== device) {
            device.session = activeAttemptDevice.session;
          }
          break;
        } catch (browserErr) {
          const errMsg = browserErr instanceof Error ? browserErr.message : String(browserErr ?? '');
          const isTunnelErr =
            /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_CONNECTION_RESET/i.test(
              errMsg
            );

          if (!isTunnelErr || config.proxyFailover === false || abortCurrentRun) {
            throw browserErr;
          }

          const allProxies = getState().proxies;
          const backupProxy =
            allProxies.find(
              (p) =>
                p.protocol !== 'direct' &&
                !attemptedProxyIds.has(p.id) &&
                p.status === 'online'
            ) ??
            allProxies.find(
              (p) =>
                p.protocol !== 'direct' &&
                !attemptedProxyIds.has(p.id) &&
                p.status !== 'offline'
            );

          if (!backupProxy || proxyTry === 2) {
            throw new Error(
              `Proxy ${activeAttemptDevice.proxy?.host ?? ''}:${activeAttemptDevice.proxy?.port ?? ''} failed HTTPS tunnel (ERR_TUNNEL_CONNECTION_FAILED). Run Proxy Checker and replace offline proxies.`
            );
          }

          attemptedProxyIds.add(backupProxy.id);
          if (backupProxy.status !== 'online' || !backupProxy.exitIp) {
            await verifySingleProxy(backupProxy);
          }
          if (backupProxy.status !== 'online') {
            continue;
          }

          appendStep(
            runningState,
            'proxy_connect',
            `Proxy tunnel failed (${activeAttemptDevice.proxy?.host ?? 'primary'}) — failing over to ${backupProxy.exitIp || backupProxy.host}:${backupProxy.port} (${backupProxy.countryCode || 'NET'})`,
            errMsg
          );
          activeAttemptDevice = {
            ...device,
            session: device.session,
            fingerprint: { ...device.fingerprint },
          };
          syncDeviceProxyMetadata(activeAttemptDevice, backupProxy);
          runningState.proxyLabel = `${backupProxy.protocol}://${backupProxy.host}${backupProxy.port ? `:${backupProxy.port}` : ''}`;
          runningState.proxyLocation =
            [backupProxy.city, backupProxy.countryCode || backupProxy.country, backupProxy.exitIp]
              .filter(Boolean)
              .join(' · ') || backupProxy.host;
        }
      }
    } else {
      // HTTP + DOM Redirect + Form Fallback Engine
      appendStep(
        runningState,
        'navigate',
        `Navigating (HTTP Fast Engine) to ${config.targetUrl}`,
        browserInfo.available
          ? device.userAgent.raw.slice(0, 72)
          : 'No local Chrome/Edge detected — JS pixels/GA4 require ProfileGrid.exe on Windows PC'
      );

      const res = await performDeviceRequest(
        config.targetUrl,
        device,
        undefined,
        config.followRedirects
      );

      if (abortCurrentRun) return;

      const $ = cheerio.load(res.body);
      const title = $('title').first().text().trim() || new URL(res.finalUrl).hostname;
      const links = extractClickableLinks(
        res.body,
        res.finalUrl,
        config.clickMode === 'selector' ? config.clickSelector : '',
        config.clickMode === 'human_journey' ||
          config.clickMode === 'survey_and_email' ||
          config.clickMode === 'click_and_signup' ||
          config.clickMode === 'sign_up_form'
      );
      const previewHtml = buildSanitizedPreviewHtml(res.body, res.finalUrl);

      runningState.engineUsed = 'http';
      runningState.currentUrl = res.finalUrl;
      runningState.pageTitle = title;
      runningState.httpStatus = res.status;
      runningState.latencyMs = res.latencyMs;
      runningState.discoveredLinks = links;
      runningState.previewHtml = previewHtml;

      if (config.saveCookies) {
        saveResponseCookies(res.setCookies, res.finalUrl, device, runningState);
      }

      void fireEmbeddedTrackingBeacons(res.body, res.finalUrl, device);

      device.session.lastActiveOrigin = new URL(res.finalUrl).origin;
      device.session.history.unshift({
        id: uid('hist'),
        url: res.finalUrl,
        title,
        status: res.status,
        latencyMs: res.latencyMs,
        action: 'Page Visit',
        timestamp: new Date().toISOString(),
      });
      if (device.session.history.length > 40) {
        device.session.history = device.session.history.slice(0, 40);
      }

      appendStep(
        runningState,
        'dom_parse',
        `Loaded "${title}" (HTTP ${res.status} in ${res.latencyMs}ms)`,
        `${links.length} clickable element(s) indexed`
      );

      const shouldAbort = () => abortCurrentRun || getWorkspaceEpoch() !== startEpoch;
      const httpSessionStart = Date.now();
      const targetStayMs = pickHttpStayMs(config);
      await sleepInterruptible(config.clickMode === 'scroll_only' ? targetStayMs : 450, shouldAbort);
      if (shouldAbort()) return;

      let latestHtml = res.body;
      let latestUrl = res.finalUrl;

      const shouldClickLinks =
        config.clickMode === 'human_journey' ||
        config.clickMode === 'survey_and_email' ||
        config.clickMode === 'auto_cta' ||
        config.clickMode === 'selector' ||
        config.clickMode === 'all_links' ||
        config.clickMode === 'click_and_signup';

      const shouldRunSignUp =
        config.signUpConfig?.enabled !== undefined
          ? config.signUpConfig.enabled
          : config.clickMode === 'sign_up_form' ||
            config.clickMode === 'click_and_signup' ||
            config.clickMode === 'survey_and_email';

      let preStepsSubmitted = 0;
      // Submit landing form/survey first if present so links don't navigate away before completion
      if (!shouldAbort() && shouldRunSignUp && /<form[\s>]/i.test(latestHtml)) {
        const preOutcome = await submitHttpSignUpForm(
          latestHtml,
          latestUrl,
          device,
          config,
          deviceIndex
        );
        if (preOutcome.submitted && preOutcome.result) {
          preStepsSubmitted = preOutcome.stepsSubmitted;
          runningState.formSubmitted = true;
          latestHtml = preOutcome.result.body;
          latestUrl = preOutcome.result.finalUrl;
          runningState.clickedUrls.push(preOutcome.result.finalUrl);
          runningState.currentUrl = preOutcome.result.finalUrl;
          runningState.httpStatus = preOutcome.result.status;
          runningState.previewHtml = buildSanitizedPreviewHtml(
            preOutcome.result.body,
            preOutcome.result.finalUrl
          );
          if (config.saveCookies) {
            saveResponseCookies(
              preOutcome.result.setCookies,
              preOutcome.result.finalUrl,
              device,
              runningState
            );
          }
          device.totalClicks += preOutcome.stepsSubmitted;
          summary.totalClicksExecuted += preOutcome.stepsSubmitted;
          appendStep(
            runningState,
            'signup_form',
            `Submitted ${preOutcome.stepsSubmitted} survey/form step(s) (${preOutcome.filledCount} fields) as ${preOutcome.emailUsed}`,
            `HTTP ${preOutcome.result.status} -> ${preOutcome.result.finalUrl}`
          );
        }
      }

      const skipExtraHttpLinks =
        config.clickMode === 'survey_and_email' &&
        Boolean(runningState.formSubmitted) &&
        preStepsSubmitted >= 2;

      if (shouldClickLinks && !skipExtraHttpLinks && links.length > 0) {
        const isUnlimited =
          Boolean(config.unlimitedClicks) || config.maxClicksPerDevice <= 0;
        const clickQuota = isUnlimited
          ? Number.POSITIVE_INFINITY
          : Math.max(config.maxClicksPerDevice || 1, 1);

        let executed = 0;
        let failedAttempts = 0;
        const visitedHrefs = new Set<string>();

        while (executed < clickQuota && !shouldAbort()) {
          let unvisited = links.filter((l) => !visitedHrefs.has(l.href));
          if (unvisited.length === 0) {
            visitedHrefs.clear();
            unvisited = links;
          }
          const target = unvisited[Math.floor(Math.random() * unvisited.length)];
          visitedHrefs.add(target.href);

          runningState.clickTargetText = target.text;
          runningState.clickCoordinates = {
            xPct: 20 + Math.floor(Math.random() * 60),
            yPct: 22 + Math.floor(Math.random() * 54),
          };

          appendStep(
            runningState,
            'auto_click',
            `Random Human Click "${target.text}" (${isUnlimited ? `#${executed + 1} · Unlimited` : `${executed + 1}/${clickQuota}`})`,
            `${target.selector} -> ${target.href}`
          );

          try {
            const clickRes = await performDeviceRequest(
              target.href,
              device,
              latestUrl,
              config.followRedirects
            );
            if (shouldAbort()) break;

            target.clicked = true;
            latestHtml = clickRes.body;
            latestUrl = clickRes.finalUrl;
            runningState.clickedUrls.push(clickRes.finalUrl);
            if (runningState.clickedUrls.length > 100) {
              runningState.clickedUrls = runningState.clickedUrls.slice(-100);
            }
            runningState.currentUrl = clickRes.finalUrl;
            runningState.httpStatus = clickRes.status;
            runningState.latencyMs = clickRes.latencyMs;

            const $click = cheerio.load(clickRes.body);
            const clickTitle =
              $click('title').first().text().trim() || new URL(clickRes.finalUrl).hostname;
            runningState.pageTitle = clickTitle;
            runningState.previewHtml = buildSanitizedPreviewHtml(
              clickRes.body,
              clickRes.finalUrl
            );

            if (config.saveCookies) {
              saveResponseCookies(clickRes.setCookies, clickRes.finalUrl, device, runningState);
            }

            void fireEmbeddedTrackingBeacons(clickRes.body, clickRes.finalUrl, device);

            device.session.history.unshift({
              id: uid('hist'),
              url: clickRes.finalUrl,
              title: clickTitle,
              status: clickRes.status,
              latencyMs: clickRes.latencyMs,
              action: `Click: ${target.text.slice(0, 32)}`,
              timestamp: new Date().toISOString(),
            });
            if (device.session.history.length > 40) {
              device.session.history = device.session.history.slice(0, 40);
            }

            executed++;
            device.totalClicks += 1;
            summary.totalClicksExecuted += 1;
            broadcastEvent('run_summary', summary);

            if (shouldRunSignUp && !runningState.formSubmitted && /<form[\s>]/i.test(latestHtml)) {
              const midOutcome = await submitHttpSignUpForm(
                latestHtml,
                latestUrl,
                device,
                config,
                deviceIndex
              );
              if (midOutcome.submitted && midOutcome.result) {
                runningState.formSubmitted = true;
                latestHtml = midOutcome.result.body;
                latestUrl = midOutcome.result.finalUrl;
                runningState.clickedUrls.push(midOutcome.result.finalUrl);
                runningState.currentUrl = midOutcome.result.finalUrl;
                runningState.httpStatus = midOutcome.result.status;
                runningState.previewHtml = buildSanitizedPreviewHtml(
                  midOutcome.result.body,
                  midOutcome.result.finalUrl
                );
                if (config.saveCookies) {
                  saveResponseCookies(
                    midOutcome.result.setCookies,
                    midOutcome.result.finalUrl,
                    device,
                    runningState
                  );
                }
                device.totalClicks += midOutcome.stepsSubmitted;
                summary.totalClicksExecuted += midOutcome.stepsSubmitted;
                appendStep(
                  runningState,
                  'signup_form',
                  `Submitted ${midOutcome.stepsSubmitted} survey/form step(s) (${midOutcome.filledCount} fields) as ${midOutcome.emailUsed}`,
                  `HTTP ${midOutcome.result.status} -> ${midOutcome.result.finalUrl}`
                );
                if (config.clickMode === 'survey_and_email') break;
              }
            }
          } catch (clickErr) {
            failedAttempts++;
            appendStep(
              runningState,
              'error',
              `Click failed on "${target.text}"`,
              clickErr instanceof Error ? clickErr.message : 'Request error'
            );
            if (failedAttempts >= Math.max(links.length, 3) && executed === 0) {
              break;
            }
          }

          if (executed < clickQuota && !shouldAbort()) {
            await sleepInterruptible(850 + Math.floor(Math.random() * 850), shouldAbort);
          }
        }
      }

      if (!abortCurrentRun && shouldRunSignUp && !runningState.formSubmitted) {
        const formOutcome = await submitHttpSignUpForm(
          latestHtml,
          latestUrl,
          device,
          config,
          deviceIndex
        );
        if (formOutcome.submitted && formOutcome.result) {
          runningState.formSubmitted = true;
          runningState.clickedUrls.push(formOutcome.result.finalUrl);
          runningState.currentUrl = formOutcome.result.finalUrl;
          runningState.httpStatus = formOutcome.result.status;
          runningState.previewHtml = buildSanitizedPreviewHtml(
            formOutcome.result.body,
            formOutcome.result.finalUrl
          );
          if (config.saveCookies) {
            saveResponseCookies(
              formOutcome.result.setCookies,
              formOutcome.result.finalUrl,
              device,
              runningState
            );
          }
          device.totalClicks += formOutcome.stepsSubmitted;
          summary.totalClicksExecuted += formOutcome.stepsSubmitted;
          appendStep(
            runningState,
            'signup_form',
            `Submitted ${formOutcome.stepsSubmitted} survey/form step(s) (${formOutcome.filledCount} fields) as ${formOutcome.emailUsed}`,
            `HTTP ${formOutcome.result.status} -> ${formOutcome.result.finalUrl}`
          );
        } else {
          appendStep(
            runningState,
            'signup_form',
            'No static HTML <form> detected on page',
            'Interactive JS surveys & Gmail submits require running ProfileGrid.exe on Windows PC'
          );
        }
      }

      const elapsedHttpMs = Date.now() - httpSessionStart;
      if (!shouldAbort() && elapsedHttpMs < targetStayMs) {
        const remainHttpMs = targetStayMs - elapsedHttpMs;
        appendStep(
          runningState,
          'dom_parse',
          `Maintaining human dwell for ${Math.round(remainHttpMs / 1000)}s on destination`,
          latestUrl
        );
        await sleepInterruptible(remainHttpMs, shouldAbort);
      }
    }

    const turnOffOnComplete = config.disableDeviceOnComplete !== false;

    device.totalRuns += 1;
    device.lastRunAt = new Date().toISOString();
    device.status = turnOffOnComplete ? 'off' : 'completed';

    runningState.status = 'completed';
    runningState.activePhase = turnOffOnComplete
      ? 'Completed · Device Turned Off'
      : 'Completed';
    runningState.clickTargetText = null;
    runningState.clickCoordinates = null;
    summary.completedCount += 1;

    if (config.autoCleanAfterRun) {
      // Wipe all session cookies, storage, history, and temporary DOM/screenshot previews while keeping OFF/completed state
      cleanDeviceSession(device, true);
      runningState.cookiesCapturedCount = 0;
      runningState.previewHtml = '';
      runningState.screenshotDataUrl = null;
      appendStep(
        runningState,
        'auto_clean',
        'Auto-cleaned cookies, storage & cache (zero trace left)'
      );
    } else {
      const originKey = new URL(config.targetUrl).origin;
      const existingLs = device.session.localStorage.find(
        (item) => item.key === 'pg_last_visit' && item.origin === originKey
      );
      if (!existingLs) {
        device.session.localStorage.push({
          key: 'pg_last_visit',
          value: new Date().toISOString(),
          origin: originKey,
        });
      }
      appendStep(
        runningState,
        'session_save',
        `Persisted ${device.session.cookies.length} cookies & session state`,
        `${runningState.clickedUrls.length} actions recorded`
      );
    }

    appendStep(
      runningState,
      'done',
      turnOffOnComplete
        ? 'Profile run completed — device automatically turned OFF'
        : 'Profile run completed'
    );
  } catch (err) {
    device.status = 'error';
    runningState.status = 'error';
    runningState.error = err instanceof Error ? err.message : 'Navigation failed';
    summary.errorCount += 1;
    appendStep(runningState, 'error', 'Profile execution failed', runningState.error);

    if (config.autoCleanAfterRun) {
      cleanDeviceSession(device, true);
      runningState.cookiesCapturedCount = 0;
      runningState.previewHtml = '';
      runningState.screenshotDataUrl = null;
    }
  }

  if (getWorkspaceEpoch() !== startEpoch) return;
  persistStore();
  broadcastEvent('run_summary', summary);
  broadcastEvent('device_updated', device);
}

export async function startAutomationCampaign(
  config: AutomationConfig
): Promise<AutomationRunSummary> {
  const store = getState();
  const startEpoch = getWorkspaceEpoch();
  abortCurrentRun = false;

  const baseCandidates =
    config.deviceIds.length > 0
      ? store.devices.filter((d) => config.deviceIds.includes(d.id))
      : store.devices;

  const targetDevices = baseCandidates.filter((d) => d.status !== 'off');

  let macChangeSummary: string | null = null;
  if (config.rotateMacOnStart !== false && targetDevices.length > 0) {
    // Rotate every target device's virtual hardware MAC immediately on Start
    for (const dev of targetDevices) {
      const freshMac = generateDeviceMacAddress(
        `${dev.fingerprint.seed}-${Date.now()}-${Math.random()}`
      );
      dev.fingerprint.macAddress = freshMac;
      dev.fingerprint.consistencyNotes = [
        ...dev.fingerprint.consistencyNotes.filter((n) => !n.startsWith('Device MAC (')),
        `Device MAC (${freshMac}) rotated on run start`,
      ];
      broadcastEvent('device_updated', dev);
    }

    // Also rotate the active Windows physical network adapter MAC before connecting proxies/browsers
    const osMacRes = await rotateWindowsAdapterMac();
    macChangeSummary = osMacRes.changed
      ? `OS NIC (${osMacRes.adapterName}) ${osMacRes.previousMac} -> ${osMacRes.newMac}`
      : osMacRes.message;
  }

  const runId = uid('run');
  const summary: AutomationRunSummary = {
    id: runId,
    targetUrl: config.targetUrl,
    clickMode: config.clickMode,
    deviceCount: targetDevices.length,
    completedCount: 0,
    errorCount: 0,
    totalClicksExecuted: 0,
    status: 'running',
    macChangeSummary,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };

  store.runs.unshift(summary);
  if (store.runs.length > 25) store.runs = store.runs.slice(0, 25);
  setActiveRunId(runId);
  persistStore();
  broadcastEvent('run_summary', summary);

  const concurrency = Math.max(1, Math.min(config.concurrency || 3, 6));
  const queue = targetDevices.map((device, index) => ({ device, index }));

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async (_, idx) => {
    if (idx > 0 && config.staggerDelayMs > 0) {
      await sleep(idx * Math.min(config.staggerDelayMs, 2000));
    }
    while (queue.length > 0 && !abortCurrentRun && getWorkspaceEpoch() === startEpoch) {
      const nextItem = queue.shift();
      if (!nextItem) break;
      await runSingleDevice(nextItem.device, nextItem.index, config, runId, summary, startEpoch);
      if (
        config.staggerDelayMs > 0 &&
        queue.length > 0 &&
        !abortCurrentRun &&
        getWorkspaceEpoch() === startEpoch
      ) {
        await sleep(Math.min(config.staggerDelayMs, 2000));
      }
    }
  });

  void Promise.all(workers).then(() => {
    if (getWorkspaceEpoch() !== startEpoch) {
      setActiveRunId(null);
      return;
    }
    if (summary.status === 'running') {
      summary.status = abortCurrentRun ? 'stopped' : 'completed';
      summary.completedAt = new Date().toISOString();
    }
    setActiveRunId(null);
    persistStore();
    broadcastEvent('run_summary', summary);

    if (config.autoCleanRunHistory) {
      setTimeout(() => {
        if (getWorkspaceEpoch() === startEpoch) {
          cleanWorkspace('sessions');
        }
      }, 1500);
    }
  });

  return summary;
}
