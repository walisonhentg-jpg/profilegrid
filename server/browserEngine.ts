import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Browser, BrowserContext, Frame, Page } from 'playwright-core';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type {
  AutomationConfig,
  CookieEntry,
  DeviceProfile,
  DiscoveredLink,
  ProxyEntry,
  RunningProfileState,
  SignUpFormConfig,
} from '../src/types/automation.ts';

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

function queryWindowsRegistryAppPath(exeName: string): string | null {
  if (process.platform !== 'win32') return null;
  const hives = [
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`,
    `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`,
  ];
  for (const key of hives) {
    try {
      const out = execSync(`reg query "${key}" /ve`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1500,
      });
      const match = out.match(/REG_SZ\s+(.+\.exe)/i);
      if (match && match[1]) {
        const cleaned = match[1].trim().replace(/^"|"$/g, '');
        if (fs.existsSync(cleaned)) return cleaned;
      }
    } catch {
      // Key not present
    }
  }
  try {
    const found = execSync(`where ${exeName}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    })
      .split(/\r?\n/)[0]
      ?.trim();
    if (found && fs.existsSync(found)) return found;
  } catch {
    // Not in PATH
  }
  return null;
}

export function detectLocalBrowser(customPath?: string): {
  available: boolean;
  executablePath: string | null;
  name: string | null;
} {
  const candidates: Array<{ path: string; name: string }> = [];

  if (customPath?.trim()) {
    candidates.push({
      path: customPath.trim().replace(/^"|"$/g, ''),
      name: 'Custom Browser',
    });
  }

  if (process.env.PROFILEGRID_BROWSER_PATH) {
    candidates.push({
      path: process.env.PROFILEGRID_BROWSER_PATH,
      name: 'Custom Browser',
    });
  }

  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || '';
    const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const progFiles86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    candidates.push(
      { path: path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), name: 'Google Chrome' },
      { path: path.join(progFiles86, 'Google', 'Chrome', 'Application', 'chrome.exe'), name: 'Google Chrome' },
      { path: path.join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe'), name: 'Google Chrome' },
      { path: 'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', name: 'Google Chrome' },
      { path: path.join(progFiles86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), name: 'Microsoft Edge' },
      { path: path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), name: 'Microsoft Edge' },
      { path: path.join(localApp, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), name: 'Microsoft Edge' },
      { path: path.join(progFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), name: 'Brave Browser' },
      { path: path.join(localApp, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), name: 'Brave Browser' }
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', name: 'Google Chrome' },
      { path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', name: 'Microsoft Edge' },
      { path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', name: 'Brave Browser' }
    );
  } else {
    candidates.push(
      { path: '/usr/bin/google-chrome', name: 'Google Chrome' },
      { path: '/usr/bin/google-chrome-stable', name: 'Google Chrome' },
      { path: '/usr/bin/chromium', name: 'Chromium' },
      { path: '/usr/bin/chromium-browser', name: 'Chromium' },
      { path: '/usr/bin/microsoft-edge', name: 'Microsoft Edge' }
    );
  }

  for (const item of candidates) {
    try {
      if (item.path && fs.existsSync(item.path)) {
        return { available: true, executablePath: item.path, name: item.name };
      }
    } catch {
      // Ignore permission errors
    }
  }

  if (process.platform === 'win32') {
    const regChrome = queryWindowsRegistryAppPath('chrome.exe');
    if (regChrome) return { available: true, executablePath: regChrome, name: 'Google Chrome' };
    const regEdge = queryWindowsRegistryAppPath('msedge.exe');
    if (regEdge) return { available: true, executablePath: regEdge, name: 'Microsoft Edge' };
    const regBrave = queryWindowsRegistryAppPath('brave.exe');
    if (regBrave) return { available: true, executablePath: regBrave, name: 'Brave Browser' };
  }

  return { available: false, executablePath: null, name: null };
}

export interface GeneratedIdentity {
  firstName: string;
  lastName: string;
  fullName: string;
  username: string;
  email: string;
  password: string;
  phone: string;
  streetAddress: string;
  zip: string;
  city: string;
  state: string;
  country: string;
  countryCode: string;
  gender: 'Male' | 'Female';
  age: string;
  birthYear: string;
  birthMonth: string;
  birthMonthNum: number;
  birthMonthName: string;
  birthMonthShort: string;
  birthDay: string;
  dobIso: string;
  dobUs: string;
  dobEu: string;
  company: string;
  jobTitle: string;
  income: string;
  education: string;
}

const MALE_FIRST_NAMES = [
  'Alex', 'Jordan', 'Ethan', 'Liam', 'Noah', 'Lucas', 'Mason', 'Logan',
  'Owen', 'Caleb', 'Nathan', 'Dylan', 'Ryan', 'Devon', 'Cameron', 'Carter',
];

const FEMALE_FIRST_NAMES = [
  'Maya', 'Chloe', 'Grace', 'Hannah', 'Sophia', 'Olivia', 'Emma', 'Zoe',
  'Mia', 'Ella', 'Aria', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Avery',
];

const LAST_NAMES = [
  'Carter', 'Brooks', 'Hayes', 'Bennett', 'Parker', 'Foster', 'Reed', 'Cooper',
  'Bailey', 'Ward', 'Mitchell', 'Turner', 'Collins', 'Edwards', 'Morris', 'Rogers',
  'Morgan', 'Peterson', 'Gray', 'Ramirez', 'James', 'Watson', 'Price', 'Sanders',
  'Barnes', 'Ross', 'Henderson', 'Coleman', 'Jenkins', 'Perry', 'Powell', 'Long',
];

const STREET_NAMES = [
  'Oakwood Ave', 'Maple St', 'Cedar Blvd', 'Pinecrest Rd', 'Elmwood Dr',
  'Parkview Ln', 'Highland Ave', 'Lakeview Dr', 'Meadowbrook Way', 'Sunset Blvd',
];

const COMPANIES = [
  'Northstar Retail', 'Summit Logistics', 'Brightview Media', 'Crestline Services',
  'Harborstone Group', 'Oakridge Solutions', 'Clearwater Commerce', 'Redwood Partners',
];

const JOB_TITLES = [
  'Operations Coordinator', 'Sales Specialist', 'Project Analyst', 'Marketing Associate',
  'Customer Support Lead', 'Store Manager', 'Supply Planner', 'Account Coordinator',
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_SHORTS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const COUNTRY_GEO_POOL: Record<
  string,
  { country: string; phonePrefix: string; places: Array<{ city: string; state: string; zip: string }> }
> = {
  US: {
    country: 'United States',
    phonePrefix: '+1202555',
    places: [
      { city: 'Austin', state: 'Texas', zip: '78701' },
      { city: 'Denver', state: 'Colorado', zip: '80202' },
      { city: 'Chicago', state: 'Illinois', zip: '60601' },
      { city: 'Seattle', state: 'Washington', zip: '98101' },
      { city: 'Atlanta', state: 'Georgia', zip: '30303' },
      { city: 'Phoenix', state: 'Arizona', zip: '85004' },
      { city: 'Miami', state: 'Florida', zip: '33131' },
      { city: 'Boston', state: 'Massachusetts', zip: '02108' },
      { city: 'Charlotte', state: 'North Carolina', zip: '28202' },
      { city: 'Nashville', state: 'Tennessee', zip: '37201' },
    ],
  },
  GB: {
    country: 'United Kingdom',
    phonePrefix: '+4477009',
    places: [
      { city: 'London', state: 'England', zip: 'SW1A 1AA' },
      { city: 'Manchester', state: 'Greater Manchester', zip: 'M1 1AE' },
      { city: 'Birmingham', state: 'West Midlands', zip: 'B1 1AA' },
    ],
  },
  CA: {
    country: 'Canada',
    phonePrefix: '+1416555',
    places: [
      { city: 'Toronto', state: 'Ontario', zip: 'M5V 2T6' },
      { city: 'Vancouver', state: 'British Columbia', zip: 'V6B 1A1' },
      { city: 'Montreal', state: 'Quebec', zip: 'H2Y 1C6' },
    ],
  },
  AU: {
    country: 'Australia',
    phonePrefix: '+6149157',
    places: [
      { city: 'Sydney', state: 'New South Wales', zip: '2000' },
      { city: 'Melbourne', state: 'Victoria', zip: '3000' },
      { city: 'Brisbane', state: 'Queensland', zip: '4000' },
    ],
  },
  DE: {
    country: 'Germany',
    phonePrefix: '+491512',
    places: [
      { city: 'Berlin', state: 'Berlin', zip: '10115' },
      { city: 'Munich', state: 'Bavaria', zip: '80331' },
      { city: 'Frankfurt', state: 'Hesse', zip: '60311' },
    ],
  },
  FR: {
    country: 'France',
    phonePrefix: '+3361234',
    places: [
      { city: 'Paris', state: 'Ile-de-France', zip: '75001' },
      { city: 'Lyon', state: 'Auvergne-Rhone-Alpes', zip: '69001' },
    ],
  },
  NL: {
    country: 'Netherlands',
    phonePrefix: '+3161234',
    places: [{ city: 'Amsterdam', state: 'North Holland', zip: '1012 JS' }],
  },
  SG: {
    country: 'Singapore',
    phonePrefix: '+659123',
    places: [{ city: 'Singapore', state: 'Central', zip: '018956' }],
  },
  IN: {
    country: 'India',
    phonePrefix: '+919810',
    places: [
      { city: 'Mumbai', state: 'Maharashtra', zip: '400001' },
      { city: 'Bengaluru', state: 'Karnataka', zip: '560001' },
    ],
  },
  BD: {
    country: 'Bangladesh',
    phonePrefix: '+8801711',
    places: [{ city: 'Dhaka', state: 'Dhaka', zip: '1205' }],
  },
};

export function isValidGmailSyntax(email: string): boolean {
  const cleaned = email.trim().toLowerCase();
  const atIdx = cleaned.indexOf('@');
  if (atIdx <= 0 || atIdx !== cleaned.lastIndexOf('@')) return false;
  const local = cleaned.slice(0, atIdx);
  const domain = cleaned.slice(atIdx + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const baseLocal = local.split('+')[0];
    return (
      baseLocal.length >= 6 &&
      baseLocal.length <= 30 &&
      /^[a-z0-9](?:\.?[a-z0-9])*$/.test(baseLocal) &&
      (!local.includes('+') || /^[a-z0-9._+-]+$/.test(local))
    );
  }
  return (
    local.length >= 1 &&
    local.length <= 64 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) &&
    /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)
  );
}

export function parseValidEmailPool(raw?: string): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const tokens = raw
    .split(/[\r\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t) && isValidGmailSyntax(t)) {
      seen.add(t);
      valid.push(t);
    }
  }
  return valid;
}

export function buildSignUpIdentity(
  device: DeviceProfile,
  cfg?: SignUpFormConfig,
  deviceIndex = 0
): GeneratedIdentity {
  const rnd = Math.floor(1000 + Math.random() * 8999);
  const shortNum = Math.floor(1982 + Math.random() * 21);
  const birthMonthNum = 1 + Math.floor(Math.random() * 12);
  const birthMonth = String(birthMonthNum).padStart(2, '0');
  const birthMonthName = MONTH_NAMES[birthMonthNum - 1];
  const birthMonthShort = MONTH_SHORTS[birthMonthNum - 1];
  const birthDayNum = 1 + Math.floor(Math.random() * 27);
  const birthDay = String(birthDayNum).padStart(2, '0');

  const isMale = Math.random() < 0.5;
  const gender: 'Male' | 'Female' = isMale ? 'Male' : 'Female';
  const namePool = isMale ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES;
  const fName = namePool[Math.floor(Math.random() * namePool.length)];
  const lName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  const autoFull = `${fName} ${lName}`;

  const fLower = fName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const lLower = lName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const variants = [
    `${fLower}.${lLower}${shortNum % 100}`,
    `${fLower}${lLower}${rnd}`,
    `${fLower}.${lLower}.${rnd % 1000}`,
    `${fLower[0]}${lLower}${shortNum}`,
  ];
  const chosenLocal = variants[Math.floor(Math.random() * variants.length)].slice(0, 28);
  const autoUser = `${fLower}.${lLower}${rnd}`;
  const autoEmail = `${chosenLocal}@gmail.com`;
  const autoPass = `Pg#${rnd}Kx!9`;

  const ccRaw = (device.proxy?.countryCode || 'US').toUpperCase();
  const countryCode = ccRaw === 'UK' ? 'GB' : ccRaw;
  const countryProfile = COUNTRY_GEO_POOL[countryCode] ?? COUNTRY_GEO_POOL.US;
  const geoPick = countryProfile.places[Math.floor(Math.random() * countryProfile.places.length)];
  const city = device.proxy?.city?.trim() || geoPick.city;
  const state = device.proxy?.region?.trim() || geoPick.state;
  const country = device.proxy?.country?.trim() || countryProfile.country;
  const autoPhone = `${countryProfile.phonePrefix}${rnd}`;
  const streetNum = Math.floor(120 + Math.random() * 8800);
  const streetAddress = `${streetNum} ${STREET_NAMES[Math.floor(Math.random() * STREET_NAMES.length)]}`;
  const ageNum = Math.max(21, Math.min(58, new Date().getFullYear() - shortNum));

  const company = COMPANIES[Math.floor(Math.random() * COMPANIES.length)];
  const jobTitle = JOB_TITLES[Math.floor(Math.random() * JOB_TITLES.length)];
  const birthYear = String(shortNum);
  const dobIso = `${birthYear}-${birthMonth}-${birthDay}`;
  const dobUs = `${birthMonth}/${birthDay}/${birthYear}`;
  const dobEu = `${birthDay}/${birthMonth}/${birthYear}`;

  const validPool = parseValidEmailPool(cfg?.gmailPool);
  const usePool =
    validPool.length > 0 &&
    (cfg?.emailSource === 'gmail_pool' ||
      (cfg?.emailSource !== 'custom' && cfg?.mode !== 'custom'));

  const poolEmail = usePool
    ? validPool[Math.abs(deviceIndex) % validPool.length]
    : null;

  const customFull = cfg?.fullName?.trim();
  const useCustomIdentity =
    cfg && cfg.mode === 'custom' && cfg.emailSource !== 'auto_gmail' && cfg.emailSource !== 'gmail_pool';
  const full = useCustomIdentity ? customFull || autoFull : customFull || autoFull;
  const parts = full.split(/\s+/);

  const resolvedEmail =
    poolEmail ||
    (cfg?.emailSource === 'custom' && cfg?.email?.trim()
      ? cfg.email.trim()
      : cfg?.email?.trim() && cfg?.mode === 'custom'
        ? cfg.email.trim()
        : autoEmail);

  return {
    firstName: customFull ? parts[0] || fName : fName,
    lastName: customFull ? parts.slice(1).join(' ') || lName : lName,
    fullName: full,
    username: cfg?.username?.trim() || autoUser,
    email: resolvedEmail,
    password: cfg?.password?.trim() || autoPass,
    phone: cfg?.phone?.trim() || autoPhone,
    streetAddress,
    zip: geoPick.zip,
    city,
    state,
    country,
    countryCode,
    gender,
    age: String(ageNum),
    birthYear,
    birthMonth,
    birthMonthNum,
    birthMonthName,
    birthMonthShort,
    birthDay,
    dobIso,
    dobUs,
    dobEu,
    company,
    jobTitle,
    income: '$55,000 - $74,999',
    education: "Bachelor's Degree",
  };
}

interface LocalProxyBridge {
  serverUrl: string;
  close: () => Promise<void>;
}

async function startLocalProxyBridge(px: ProxyEntry): Promise<LocalProxyBridge> {
  const auth =
    px.username && px.password
      ? `${encodeURIComponent(px.username)}:${encodeURIComponent(px.password)}@`
      : '';
  const scheme =
    px.protocol === 'socks5'
      ? 'socks5h'
      : px.protocol === 'socks4'
        ? 'socks4a'
        : px.protocol;
  const proxyUrl = `${scheme}://${auth}${px.host}:${px.port}`;
  const isSocks = px.protocol === 'socks4' || px.protocol === 'socks5';
  const agent = isSocks
    ? new SocksProxyAgent(proxyUrl, { timeout: 15000 })
    : new HttpsProxyAgent(proxyUrl, { timeout: 15000 });

  const srv = http.createServer((clientReq, clientRes) => {
    try {
      const targetUrl = clientReq.url || '/';
      const parsed = new URL(targetUrl);

      if (!isSocks && px.protocol === 'http') {
        // Direct HTTP proxy forwarding (handles http:// URLs when upstream proxy restricts CONNECT to port 80)
        const fwdHeaders: Record<string, string | string[] | undefined> = {
          ...clientReq.headers,
          host: parsed.host,
        };
        delete fwdHeaders['proxy-connection'];
        if (px.username || px.password) {
          const basic = Buffer.from(`${px.username || ''}:${px.password || ''}`).toString('base64');
          fwdHeaders['proxy-authorization'] = `Basic ${basic}`;
        }
        const fwdReq = http.request(
          {
            hostname: px.host,
            port: px.port,
            path: targetUrl,
            method: clientReq.method,
            headers: fwdHeaders,
          },
          (proxyRes) => {
            clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            proxyRes.pipe(clientRes);
          }
        );
        fwdReq.on('error', () => {
          if (!clientRes.headersSent) clientRes.writeHead(502);
          clientRes.end();
        });
        clientReq.pipe(fwdReq);
        return;
      }

      const cleanHeaders: Record<string, string | string[] | undefined> = { ...clientReq.headers };
      delete cleanHeaders['proxy-connection'];
      delete cleanHeaders['proxy-authorization'];

      const proxyReq = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 80,
          path: `${parsed.pathname}${parsed.search}`,
          method: clientReq.method,
          headers: cleanHeaders,
          agent: agent as unknown as http.Agent,
        },
        (proxyRes) => {
          clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(clientRes);
        }
      );
      proxyReq.on('error', () => {
        if (!clientRes.headersSent) clientRes.writeHead(502);
        clientRes.end();
      });
      clientReq.pipe(proxyReq);
    } catch {
      if (!clientRes.headersSent) clientRes.writeHead(400);
      clientRes.end();
    }
  });

  srv.on('connect', (req, clientSocket, head) => {
    const rawTarget = req.url || '';
    const lastColon = rawTarget.lastIndexOf(':');
    const host = (lastColon > 0 ? rawTarget.slice(0, lastColon) : rawTarget).replace(/^\[|\]$/g, '');
    const port = lastColon > 0 ? Number(rawTarget.slice(lastColon + 1)) || 443 : 443;

    let connectStatus = 200;
    req.once('proxyConnect', (cRes: { statusCode?: number }) => {
      connectStatus = cRes?.statusCode ?? 200;
    });

    agent
      .connect(req as unknown as http.ClientRequest, { host, port, secureEndpoint: false })
      .then((upstream) => {
        if (connectStatus !== 200 || !upstream.writable) {
          upstream.destroy();
          throw new Error(`Proxy rejected CONNECT with HTTP ${connectStatus}`);
        }
        upstream.resume();
        clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-agent: ProfileGrid\r\n\r\n');
        if (head && head.length > 0) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
        upstream.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => upstream.destroy());
      })
      .catch(() => {
        try {
          clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        } catch {
          clientSocket.destroy();
        }
      });
  });

  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      srv.removeListener('error', reject);
      resolve();
    });
  });

  const addr = srv.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    serverUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        srv.close(() => resolve());
      }),
  };
}

async function resolvePlaywrightProxy(device: DeviceProfile): Promise<{
  proxy?: { server: string; username?: string; password?: string };
  bridge?: LocalProxyBridge;
}> {
  const px = device.proxy;
  if (!px || px.protocol === 'direct') return {};

  // Route ALL proxies (HTTP/HTTPS/SOCKS4/SOCKS5, auth or unauth) through local loopback bridge
  // so Chrome resolves 100% of DNS & HTTPS CONNECT traffic via the upstream proxy without 407 loops or local DNS leaks.
  const bridge = await startLocalProxyBridge(px);
  return { proxy: { server: bridge.serverUrl }, bridge };
}

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function humanPause(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.round(randBetween(minMs, maxMs));
  await new Promise((r) => setTimeout(r, ms));
}

function pickHumanStayMs(config: AutomationConfig): number {
  const minSec = Math.max(1, config.minDwellSec ?? 30);
  const maxSec = Math.max(minSec, config.maxDwellSec ?? 120);
  return Math.round(randBetween(minSec * 1000, maxSec * 1000));
}

async function humanActiveStay(
  page: Page,
  totalMs: number,
  cursor: { x: number; y: number },
  humanLike: boolean,
  shouldAbort: () => boolean,
  onProgress?: (elapsedSec: number, totalSec: number, screenshot: string | null) => void
): Promise<void> {
  const endAt = Date.now() + totalMs;
  const startAt = Date.now();
  const totalSec = Math.max(1, Math.round(totalMs / 1000));
  let nextActionAt = Date.now() + randBetween(4000, 9000);
  let nextTickAt = Date.now() + 6500;

  while (Date.now() < endAt && !shouldAbort()) {
    const remaining = endAt - Date.now();
    await new Promise((r) => setTimeout(r, Math.min(500, Math.max(50, remaining))));
    if (shouldAbort()) break;

    if (onProgress && Date.now() >= nextTickAt && Date.now() < endAt - 1000) {
      nextTickAt = Date.now() + 7000;
      const elapsedSec = Math.round((Date.now() - startAt) / 1000);
      const snap = await captureScreenshotDataUrl(page).catch(() => null);
      onProgress(elapsedSec, totalSec, snap);
    }

    if (humanLike && Date.now() >= nextActionAt && Date.now() < endAt - 1200) {
      nextActionAt = Date.now() + randBetween(4500, 10500);
      try {
        if (Math.random() < 0.55) {
          const deltaY = Math.round(randBetween(-140, 220));
          await page.mouse.wheel(0, deltaY).catch(() => {});
        } else {
          const vp = page.viewportSize() || { width: 1280, height: 720 };
          const nx = Math.round(randBetween(vp.width * 0.15, vp.width * 0.85));
          const ny = Math.round(randBetween(vp.height * 0.15, vp.height * 0.8));
          await page.mouse.move(nx, ny, { steps: 10 + Math.floor(Math.random() * 10) }).catch(() => {});
          cursor.x = nx;
          cursor.y = ny;
        }
      } catch {
        // Ignore transient navigation/detachment
      }
    }
  }
}

function pickRandomTarget<T extends { targetKey: string; score: number }>(
  targets: T[],
  visitedKeys: Set<string>
): T | undefined {
  const unvisited = targets.filter((t) => !visitedKeys.has(t.targetKey));
  if (unvisited.length === 0) return undefined;
  const goodPool = unvisited.filter((t) => t.score > 0);
  const pool = goodPool.length > 0 ? goodPool : unvisited;
  if (pool.length === 1) return pool[0];

  // Weighted random: high-intent CTAs / Sign-Up / Offer buttons get much higher probability
  // while remaining genuinely randomized per device (never fixed index [0]).
  const weights = pool.map((item) => {
    const s = Math.max(1, item.score);
    return s * s;
  });
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  let roll = Math.random() * totalWeight;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

async function humanScrollPage(page: Page, targetPct: number, humanLike: boolean): Promise<void> {
  try {
    const metrics = await page.evaluate(() => ({
      scrollHeight: document.body?.scrollHeight || document.documentElement?.scrollHeight || 0,
      viewportHeight: window.innerHeight || 720,
      scrollY: window.scrollY || 0,
    }));
    const maxScroll = Math.max(0, metrics.scrollHeight - metrics.viewportHeight);
    if (maxScroll <= 20) return;

    const desiredY = Math.round((maxScroll * Math.min(Math.max(targetPct, 15), 90)) / 100);
    if (!humanLike) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), desiredY);
      return;
    }

    const steps = 4 + Math.floor(Math.random() * 4);
    let currentY = metrics.scrollY;
    for (let s = 1; s <= steps; s++) {
      const progress = s / steps;
      const jitter = Math.round(randBetween(-25, 35));
      const nextY = Math.max(0, Math.min(maxScroll, Math.round(currentY + (desiredY - currentY) * progress + jitter)));
      const delta = nextY - currentY;
      if (Math.abs(delta) > 8) {
        await page.mouse.wheel(0, delta).catch(async () => {
          await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), nextY);
        });
        currentY = nextY;
      }
      await humanPause(260, 680);
    }

    // Occasional tiny human read-back scroll
    if (Math.random() < 0.4 && currentY > 120) {
      await page.mouse.wheel(0, -Math.round(randBetween(40, 110))).catch(() => {});
      await humanPause(220, 480);
    }
  } catch {
    // Ignore scroll errors on detached frames
  }
}

async function humanWiggleMouse(page: Page, cursor: { x: number; y: number }): Promise<void> {
  try {
    const vp = page.viewportSize() || { width: 1280, height: 720 };
    const nextX = Math.round(randBetween(vp.width * 0.2, vp.width * 0.8));
    const nextY = Math.round(randBetween(vp.height * 0.2, vp.height * 0.7));
    await page.mouse.move(nextX, nextY, { steps: 14 + Math.floor(Math.random() * 10) });
    cursor.x = nextX;
    cursor.y = nextY;
    await humanPause(180, 420);
  } catch {
    // Ignore
  }
}

async function humanMoveAndClick(
  page: Page,
  frame: Frame,
  selector: string,
  cursor: { x: number; y: number },
  humanLike: boolean,
  isMobile = false
): Promise<void> {
  const loc = frame.locator(selector).first();
  await loc.evaluate((el) => {
    try {
      (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' });
    } catch {
      // Ignore scroll error
    }
  }).catch(() => {});
  await loc.scrollIntoViewIfNeeded({ timeout: 3500 }).catch(() => {});
  if (humanLike) {
    await humanPause(180, 420);
  }

  let box = await loc.boundingBox().catch(() => null);
  if ((!box || box.width < 4 || box.height < 4) && frame === page.mainFrame()) {
    box = await loc
      .evaluate((el) => {
        const rects = el.getClientRects();
        for (let i = 0; i < rects.length; i++) {
          if (rects[i].width >= 8 && rects[i].height >= 8) {
            return {
              x: rects[i].left,
              y: rects[i].top,
              width: rects[i].width,
              height: rects[i].height,
            };
          }
        }
        const child = el.querySelector('img, div, span, button, svg') as HTMLElement | null;
        if (child) {
          const cr = child.getBoundingClientRect();
          if (cr.width >= 8 && cr.height >= 8) {
            return { x: cr.left, y: cr.top, width: cr.width, height: cr.height };
          }
        }
        return null;
      })
      .catch(() => null);
  }

  if (box && box.width >= 4 && box.height >= 4) {
    let targetX = box.x + box.width * randBetween(0.32, 0.68);
    let targetY = box.y + box.height * randBetween(0.32, 0.68);

    let hitMatches = false;
    if (frame === page.mainFrame()) {
      const probed = await page
        .evaluate(
          ({ b, sel, prefX, prefY }) => {
            const targetEl = document.querySelector(sel);
            if (!targetEl) return { ok: false, x: prefX, y: prefY };
            const vw = window.innerWidth || 1280;
            const vh = window.innerHeight || 720;
            const samples: Array<[number, number]> = [
              [prefX, prefY],
              [b.x + b.width * 0.5, b.y + b.height * 0.5],
              [b.x + b.width * 0.28, b.y + b.height * 0.5],
              [b.x + b.width * 0.72, b.y + b.height * 0.5],
            ];
            for (const [sx, sy] of samples) {
              if (sx < 0 || sy < 0 || sx > vw || sy > vh) continue;
              const hit = document.elementFromPoint(sx, sy);
              if (hit && (hit === targetEl || targetEl.contains(hit))) {
                return { ok: true, x: sx, y: sy };
              }
            }
            return { ok: false, x: prefX, y: prefY };
          },
          { b: box, sel: selector, prefX: targetX, prefY: targetY }
        )
        .catch(() => ({ ok: false, x: targetX, y: targetY }));
      hitMatches = probed.ok;
      targetX = probed.x;
      targetY = probed.y;
    } else {
      // Child iframe: use Playwright's frame-aware locator click directly for reliable hit-testing
      hitMatches = false;
    }

    if (hitMatches) {
      if (isMobile) {
        if (humanLike) {
          await humanPause(150, 340);
        }
        await page.touchscreen.tap(targetX, targetY).catch(async () => {
          await loc.click({ force: true, timeout: 4000 });
        });
        cursor.x = targetX;
        cursor.y = targetY;
        return;
      }

      if (humanLike) {
        // Natural 2-segment curved human trajectory (never teleports dead-center)
        const midX = (cursor.x + targetX) / 2 + randBetween(-38, 38);
        const midY = (cursor.y + targetY) / 2 + randBetween(-24, 24);
        await page.mouse.move(midX, midY, { steps: 8 + Math.floor(Math.random() * 7) });
        await humanPause(35, 90);
        await page.mouse.move(targetX, targetY, { steps: 8 + Math.floor(Math.random() * 8) });
        cursor.x = targetX;
        cursor.y = targetY;

        await humanPause(140, 320);
        await page.mouse.click(targetX, targetY, { delay: Math.round(randBetween(55, 115)) });
        return;
      }

      await page.mouse.click(targetX, targetY, { delay: 65 });
      cursor.x = targetX;
      cursor.y = targetY;
      return;
    }
  }

  // Fallback if element was covered, in an iframe, or outside hit-testable box
  try {
    await loc.click({ timeout: 5000 });
  } catch {
    try {
      await loc.click({ force: true, timeout: 4500 });
    } catch {
      await loc.evaluate((el) => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        (el as HTMLElement).click();
      });
    }
  }
}

async function captureScreenshotDataUrl(page: Page): Promise<string | null> {
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 55 });
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function syncCookiesFromContext(
  context: BrowserContext,
  device: DeviceProfile,
  saveCookies: boolean
): Promise<number> {
  try {
    const pwCookies = await context.cookies();
    if (saveCookies) {
      const mapped: CookieEntry[] = pwCookies.map((c) => ({
        id: uid('ck'),
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        httpOnly: Boolean(c.httpOnly),
        secure: Boolean(c.secure),
        sameSite: c.sameSite === 'Strict' ? 'Strict' : c.sameSite === 'None' ? 'None' : 'Lax',
        expires:
          c.expires && c.expires > 0
            ? new Date(c.expires * 1000).toISOString()
            : 'Session',
      }));
      device.session.cookies = mapped;
    }
    return pwCookies.length;
  } catch {
    return device.session.cookies.length;
  }
}

interface RealDomTarget {
  index: number;
  frameIndex: number;
  text: string;
  href: string;
  tag: string;
  selector: string;
  targetKey: string;
  xPct: number;
  yPct: number;
  score: number;
}

async function discoverRealClickTargets(
  page: Page,
  customSelector: string,
  preferSignup = false,
  skipKeys?: Set<string>
): Promise<RealDomTarget[]> {
  const primarySelector = customSelector.trim()
    ? customSelector.trim()
    : 'a, button, label, input[type="submit"], input[type="button"], [role="button"], [onclick], [data-href], [data-url], [data-link]';
  const fallbackSelector = 'div, span, li, article';

  const frames = page.frames();
  const allResults: RealDomTarget[] = [];
  const globalSeen = new Set<string>();

  for (let fIdx = 0; fIdx < frames.length; fIdx++) {
    const frame = frames[fIdx];
    try {
      const frameTargets = await frame.evaluate(
        ({ primarySel, fallbackSel, signupBoost, frameIdx, isCustom }) => {
          const vw = window.innerWidth || 1280;
          const vh = window.innerHeight || 720;
          const primaryNodes = Array.from(document.querySelectorAll(primarySel));
          const extraNodes = isCustom
            ? []
            : Array.from(document.querySelectorAll(fallbackSel)).filter((el) => {
                if (el.closest('a, button, [role="button"]')) return false;
                const st = window.getComputedStyle(el);
                if (st.cursor !== 'pointer') return false;
                const r = el.getBoundingClientRect();
                return r.width >= 16 && r.height >= 16 && r.width <= 540 && r.height <= 200;
              });
          const nodes = [...primaryNodes.slice(0, 260), ...extraNodes.slice(0, 60)];
          const results: Array<{
            index: number;
            frameIndex: number;
            text: string;
            href: string;
            tag: string;
            selector: string;
            targetKey: string;
            xPct: number;
            yPct: number;
            score: number;
          }> = [];
          const seen = new Set<string>();
          const currentOrigin = window.location.origin;

          for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i] as HTMLElement;
            const tag = el.tagName.toLowerCase();
            let rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) {
              const firstClientRect = el.getClientRects()[0];
              if (firstClientRect && firstClientRect.width >= 10 && firstClientRect.height >= 10) {
                rect = firstClientRect;
              } else {
                const childMedia = el.querySelector('img, div, span, picture, svg') as HTMLElement | null;
                const childRect = childMedia?.getBoundingClientRect();
                if (childRect && childRect.width >= 10 && childRect.height >= 10) {
                  rect = childRect;
                } else {
                  continue;
                }
              }
            }
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              continue;
            }

            const isGenericContainer = tag === 'div' || tag === 'span' || tag === 'li' || tag === 'article';
            const dataUrl =
              el.getAttribute('data-href') ||
              el.getAttribute('data-url') ||
              el.getAttribute('data-link') ||
              '';
            const hasClickHandler =
              Boolean(el.getAttribute('onclick')) ||
              el.getAttribute('role') === 'button' ||
              Boolean(dataUrl);

            if (!isCustom && isGenericContainer && !hasClickHandler) {
              if (style.cursor !== 'pointer') continue;
              if (el.closest('a, button, [role="button"]')) continue;
              if (rect.width > vw * 0.92 && rect.height > vh * 0.7) continue;
            }

            const rawHrefAttr = (el.getAttribute('href') || '').trim();
            const imgAlt = el.querySelector('img')?.getAttribute('alt') || '';
            const rawText =
              (el as HTMLInputElement).value ||
              el.innerText ||
              el.getAttribute('aria-label') ||
              el.getAttribute('title') ||
              imgAlt ||
              '';
            const text = rawText.replace(/\s+/g, ' ').trim();
            const classHint = (typeof el.className === 'string' ? el.className : '').toLowerCase();
            const looksLikeButtonAnchor =
              tag === 'a' &&
              (/btn|button|cta|signup|register|submit|join|claim|weiter|next|continue/i.test(classHint) ||
                /(sign\s*up|register|create\s*account|join|get\s*started|free\s*trial|claim|continue|start|next|offer|bonus|verify|weiter|fortfahren|nächste|jetzt|los|anmelden|registrieren|bestätigen|kostenlos|suivant|continuer|siguiente|continuar|volgende|avanti|dalej)/i.test(
                  text
                ) ||
                (style.cursor === 'pointer' && Boolean(text) && !/^#top$/i.test(rawHrefAttr)));

            const isLabelButton =
              tag === 'label' &&
              (style.cursor === 'pointer' || el.hasAttribute('for') || Boolean(el.querySelector('input'))) &&
              !el.closest('header, nav, footer');
            const isActionElement =
              tag === 'button' ||
              tag === 'input' ||
              isLabelButton ||
              hasClickHandler ||
              looksLikeButtonAnchor ||
              (tag === 'a' && style.cursor === 'pointer' && Boolean(text) && !el.closest('header, nav, footer')) ||
              (isGenericContainer && style.cursor === 'pointer');

            if (
              !isActionElement &&
              (!rawHrefAttr ||
                rawHrefAttr === '#' ||
                rawHrefAttr.startsWith('#') ||
                /^javascript:/i.test(rawHrefAttr) ||
                /^mailto:/i.test(rawHrefAttr) ||
                /^tel:/i.test(rawHrefAttr))
            ) {
              continue;
            }
            const href =
              (el as HTMLAnchorElement).href ||
              el.getAttribute('formaction') ||
              dataUrl ||
              '';

            if (!text && !href && !el.querySelector('img')) continue;
            const cleanText = (text || href || `${tag} CTA`).slice(0, 80);
            const targetKey = `${tag}:${cleanText.toLowerCase()}:${href.toLowerCase()}`;
            if (seen.has(targetKey)) continue;
            seen.add(targetKey);

            const pgId = `pg-f${frameIdx}-t${i}`;
            el.setAttribute('data-pg-target', pgId);

            const lower = `${cleanText} ${href}`.toLowerCase();
            let score = 5;

            if (
              signupBoost &&
              /(sign\s*up|register|create\s*account|join|get\s*started|free\s*trial|claim|continue|start|weiter|fortfahren|jetzt|los|anmelden|registrieren|kostenlos|teilnehmen|suivant|continuer|siguiente|continuar|volgende|avanti|dalej)/i.test(lower)
            ) {
              score += 55;
            }
            if (
              /(get\s*started|continue|next|claim|start|sign\s*up|register|submit|join|visit|open|verify|proceed|unlock|enter|bonus|offer|weiter|fortfahren|nächste|jetzt|los|bestätigen|absenden|anmelden|registrieren|suivant|continuer|siguiente|continuar|volgende|avanti|dalej)/i.test(
                lower
              )
            ) {
              score += 28;
            }
            if (href && /^https?:\/\//i.test(href) && !href.startsWith(currentOrigin)) {
              score += 14;
            }
            if (tag === 'button' || el.getAttribute('role') === 'button' || dataUrl) {
              score += 10;
            }
            if (rect.top >= 0 && rect.top <= vh) {
              score += 6;
            }
            if (
              /(privacy|terms|cookie|policy|gdpr|disclaimer|unsubscribe|sitemap|about\s*us|contact\s*us|faq)/i.test(
                lower
              )
            ) {
              score -= 22;
            }

            const cx = Math.min(92, Math.max(8, Math.round(((rect.left + rect.width / 2) / vw) * 100)));
            const cy = Math.min(92, Math.max(8, Math.round(((rect.top + rect.height / 2) / vh) * 100)));

            results.push({
              index: i,
              frameIndex: frameIdx,
              text: cleanText,
              href: href || window.location.href,
              tag,
              selector: `[data-pg-target="${pgId}"]`,
              targetKey,
              xPct: cx,
              yPct: cy,
              score,
            });
          }

          return results;
        },
        {
          primarySel: primarySelector,
          fallbackSel: fallbackSelector,
          signupBoost: preferSignup,
          frameIdx: fIdx,
          isCustom: Boolean(customSelector.trim()),
        }
      );

      for (const item of frameTargets) {
        if (skipKeys?.has(item.targetKey)) continue;
        if (globalSeen.has(item.targetKey)) continue;
        globalSeen.add(item.targetKey);
        allResults.push(item);
      }
    } catch {
      // Cross-origin or detached iframe skipped safely
    }
  }

  allResults.sort((a, b) => b.score - a.score);
  return allResults.slice(0, 35);
}

async function dismissBlockingOverlays(page: Page): Promise<void> {
  try {
    const dismissSelector = await page.evaluate(() => {
      const btns = Array.from(
        document.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"]')
      ) as HTMLElement[];
      for (const el of btns) {
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 16 || r.top < 0 || r.bottom > window.innerHeight) continue;
        const st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
        const txt = ((el as HTMLInputElement).value || el.innerText || el.getAttribute('aria-label') || '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        if (
          /^(accept(\s+all)?(\s+cookies)?|allow\s+all|i\s+agree|agree(\s*&\s*continue)?|got\s+it|ok,?\s*got\s+it|accept\s*&\s*continue|reject\s+all|decline|alle\s+akzeptieren|akzeptieren|zustimmen|einverstanden|verstanden|akzeptieren\s*&\s*weiter|tout\s+accepter|accepter|j'accepte|aceptar(\s+todo)?|accetta(\s+tutto)?|akceptuję|accepteer(\s+alles)?)$/i.test(
            txt
          )
        ) {
          const inConsent = Boolean(
            el.closest('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [id*="gdpr" i], [class*="gdpr" i], [id*="dsgvo" i], [class*="dsgvo" i], [role="dialog"], [aria-modal="true"]')
          );
          if (inConsent || /(cookie|agree|consent|akzept|zustimm|einverstand|accepter|aceptar)/i.test(txt)) {
            el.setAttribute('data-pg-consent', '1');
            return '[data-pg-consent="1"]';
          }
        }
      }
      return null;
    });
    if (dismissSelector) {
      await page.locator(dismissSelector).first().click({ timeout: 2500 }).catch(() => {});
      await humanPause(400, 800);
    }
  } catch {
    // Safe no-op
  }
}

async function hasVisibleFormOrSurvey(page: Page): Promise<boolean> {
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const found = await frame.evaluate(() => {
        const inputs = Array.from(
          document.querySelectorAll('input, textarea, select, [role="radio"], [role="checkbox"]')
        ) as HTMLElement[];

        let selectOnlyCount = 0;
        let checkChoiceCount = 0;

        for (const el of inputs) {
          if ((el as HTMLInputElement).disabled) continue;
          if (el.closest('header, nav, footer, [id*="cookie" i], [class*="cookie" i]')) continue;
          const tag = el.tagName.toLowerCase();
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          if (['hidden', 'submit', 'button', 'image', 'reset', 'file'].includes(type)) continue;
          const hint = `${el.getAttribute('name') || ''} ${el.id || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
          if (type === 'search' || /\b(search|suche|lang|language|locale|currency|country-switch)\b/.test(hint)) continue;

          const rect = el.getBoundingClientRect();
          const st = window.getComputedStyle(el);
          const isVisible =
            rect.width >= 4 &&
            rect.height >= 4 &&
            st.display !== 'none' &&
            st.visibility !== 'hidden' &&
            st.opacity !== '0';

          if (type === 'radio' || type === 'checkbox' || el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'checkbox') {
            let labelVisible = false;
            if (!isVisible) {
              const lbl =
                (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) ||
                el.closest('label');
              if (lbl) {
                const lr = lbl.getBoundingClientRect();
                const lst = window.getComputedStyle(lbl);
                labelVisible =
                  lr.width >= 8 && lr.height >= 8 && lst.display !== 'none' && lst.visibility !== 'hidden';
              }
            }
            if (isVisible || labelVisible) {
              checkChoiceCount++;
              if (checkChoiceCount >= 2) return true;
            }
            continue;
          }

          if (!isVisible) continue;
          if (tag === 'select') {
            selectOnlyCount++;
            if (selectOnlyCount >= 2) return true;
            continue;
          }

          return true;
        }

        // Also detect button-card / option-card surveys (no <input> needed)
        const cardCandidates = Array.from(
          document.querySelectorAll(
            'button, [role="button"], a[class*="answer" i], a[class*="option" i], a[class*="btn" i], label, div[class*="answer" i], div[class*="option" i], li[class*="option" i]'
          )
        ) as HTMLElement[];
        let answerLikeCount = 0;
        for (const btn of cardCandidates) {
          if (btn.closest('header, nav, footer, [id*="cookie" i], [class*="cookie" i]')) continue;
          const r = btn.getBoundingClientRect();
          const st = window.getComputedStyle(btn);
          if (r.width < 28 || r.height < 22 || st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
          const txt = (btn.innerText || '').replace(/\s+/g, ' ').trim();
          if (!txt || txt.length > 75) continue;
          if (/^(privacy|terms|cookie|menu|login|sign\s*in|home|back|close|x|impressum|datenschutz|agb)$/i.test(txt)) continue;
          if (
            /^(yes|no|maybe|male|female|other|18-24|25-34|35-44|45-54|55\+|65\+|always|often|sometimes|rarely|never|daily|weekly|monthly|agree|strongly|start|begin|continue|next|android|iphone|ios|windows|mac|ja|nein|vielleicht|männlich|weiblich|divers|mann|frau|weiter|fortfahren|jetzt|los|starten|nächste|stimme\s*zu|oui|non|suivant|continuer|sí|si|siguiente|continuar|volgende|avanti|dalej)/i.test(
              txt
            ) ||
            /(option|choice|answer|survey|quiz|poll|step|cta|btn)/i.test(typeof btn.className === 'string' ? btn.className : '')
          ) {
            return true;
          }
          answerLikeCount++;
        }
        if (answerLikeCount >= 2) return true;

        return false;
      });
      if (found) return true;
    } catch {
      // Cross-origin frame skipped
    }
  }
  return false;
}

async function performRealSignUpForm(
  page: Page,
  identity: GeneratedIdentity,
  signUpConfig?: SignUpFormConfig,
  humanLike = true,
  cursor: { x: number; y: number } = { x: 420, y: 280 }
): Promise<{
  filledFields: number;
  submitted: boolean;
  details: string[];
  signature: string;
}> {
  const details: string[] = [];
  let filledFields = 0;

  async function humanTypeInto(frame: Frame, sel: string, val: string): Promise<void> {
    const loc = frame.locator(sel).first();
    await humanMoveAndClick(page, frame, sel, cursor, humanLike);
    if (humanLike) {
      await loc.fill('', { timeout: 2000 }).catch(() => {});
      await loc.pressSequentially(val, { delay: Math.round(randBetween(45, 98)) });
      await humanPause(140, 320);
    } else {
      await loc.fill(val, { timeout: 2500 });
    }
  }

  // 1. Apply explicit custom fields if configured
  if (signUpConfig?.customFields?.trim()) {
    const lines = signUpConfig.customFields.split(/\r?\n/);
    for (const line of lines) {
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const sel = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (!sel) continue;
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 1000 })) {
          await humanTypeInto(page.mainFrame(), sel, val);
          filledFields++;
          details.push(`Custom ${sel}`);
        }
      } catch {
        // Ignore missing custom selector
      }
    }
  }

  let latestSignature = page.url();

  // 2. Scan main frame + visible frames for sign-up & survey inputs (including hidden inputs with clickable labels)
  const frames = page.frames();
  for (let fIdx = 0; fIdx < frames.length; fIdx++) {
    const frame = frames[fIdx];
    let scanResult: {
      fields: Array<{
        pgInputId: string;
        pgLabelId: string | null;
        tag: string;
        type: string;
        name: string;
        hint: string;
        labelOnly: string;
        required: boolean;
        checked: boolean;
        currentVal: string;
        inputHidden: boolean;
        insideForm: boolean;
        selectOptions: Array<{ value: string; text: string }>;
      }>;
      ariaChoices: Array<{
        pgAriaId: string;
        role: string;
        groupKey: string;
        questionHint: string;
        checked: boolean;
        text: string;
      }>;
      surveyCardButtons: Array<{
        pgCardId: string;
        text: string;
        questionHint: string;
      }>;
      sig: string;
    } = { fields: [], ariaChoices: [], surveyCardButtons: [], sig: '' };

    try {
      scanResult = await frame.evaluate((frameIdx) => {
        const inputs = Array.from(
          document.querySelectorAll('input, textarea, select')
        ) as Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;

        const fields: Array<{
          pgInputId: string;
          pgLabelId: string | null;
          tag: string;
          type: string;
          name: string;
          hint: string;
          labelOnly: string;
          required: boolean;
          checked: boolean;
          currentVal: string;
          inputHidden: boolean;
          insideForm: boolean;
          selectOptions: Array<{ value: string; text: string }>;
        }> = [];

        inputs.forEach((el, idx) => {
          if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) return;
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          if (['hidden', 'submit', 'button', 'image', 'reset', 'file'].includes(type)) return;

          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const inputHidden =
            rect.width < 4 ||
            rect.height < 4 ||
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0';

          let labelEl: HTMLElement | null = null;
          if (el.id) {
            try {
              labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`) as HTMLElement | null;
            } catch {
              labelEl = null;
            }
          }
          if (!labelEl) {
            labelEl = el.closest('label') as HTMLElement | null;
          }

          let labelVisible = false;
          let pgLabelId: string | null = null;
          if (labelEl) {
            const lr = labelEl.getBoundingClientRect();
            const ls = window.getComputedStyle(labelEl);
            labelVisible =
              lr.width >= 6 &&
              lr.height >= 6 &&
              ls.display !== 'none' &&
              ls.visibility !== 'hidden';
            if (labelVisible) {
              pgLabelId = `pg-f${frameIdx}-lbl-${idx}`;
              labelEl.setAttribute('data-pg-label', pgLabelId);
            }
          }

          if (inputHidden && !((type === 'radio' || type === 'checkbox') && labelVisible)) {
            return;
          }

          const labelledByIds = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
          const labelledByText = labelledByIds
            .map((lid) => document.getElementById(lid)?.textContent || '')
            .join(' ');
          const prevSibText = el.previousElementSibling?.textContent?.slice(0, 120) || '';
          const questionWrap = el.closest(
            'fieldset, .question, .form-group, .field, [class*="question" i], [class*="field" i], li, tr, div'
          );
          const wrapPrompt =
            questionWrap?.querySelector('legend, h1, h2, h3, h4, p, .label, label')?.textContent?.slice(0, 160) || '';
          const parentText = questionWrap?.textContent?.slice(0, 220) || '';
          const labelText = labelEl?.textContent || '';

          const hint = [
            el.getAttribute('name') || '',
            el.id || '',
            el.getAttribute('placeholder') || '',
            el.getAttribute('aria-label') || '',
            el.getAttribute('autocomplete') || '',
            el.getAttribute('data-name') || '',
            el.getAttribute('data-field') || '',
            el.getAttribute('title') || '',
            labelledByText,
            labelText,
            prevSibText,
            wrapPrompt,
            parentText,
          ]
            .join(' ')
            .replace(/\s+/g, ' ')
            .toLowerCase();

          const pgInputId = `pg-f${frameIdx}-in-${idx}`;
          el.setAttribute('data-pg-input', pgInputId);

          let selectOptions: Array<{ value: string; text: string }> = [];
          if (el.tagName.toLowerCase() === 'select') {
            selectOptions = Array.from((el as HTMLSelectElement).options)
              .filter((opt, oIdx) => {
                if (opt.disabled) return false;
                const t = opt.text.trim().toLowerCase();
                if (oIdx === 0 && (!opt.value || /^(select|choose|pick|--|\s*$)/i.test(t))) {
                  return false;
                }
                return Boolean(opt.value || t);
              })
              .map((opt) => ({ value: opt.value, text: opt.text.trim() }));
          }

          fields.push({
            pgInputId,
            pgLabelId,
            tag: el.tagName.toLowerCase(),
            type,
            name: el.getAttribute('name') || `anon_${idx}`,
            hint,
            labelOnly: `${labelText} ${el.getAttribute('value') || ''}`.replace(/\s+/g, ' ').trim().toLowerCase(),
            required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
            checked: Boolean((el as HTMLInputElement).checked),
            currentVal: (el as HTMLInputElement).value || '',
            inputHidden,
            insideForm: Boolean(el.closest('form, [role="form"], section, main')),
            selectOptions,
          });
        });

        const ariaNodes = Array.from(
          document.querySelectorAll('[role="radio"], [role="checkbox"]')
        ) as HTMLElement[];
        const ariaChoices: Array<{
          pgAriaId: string;
          role: string;
          groupKey: string;
          questionHint: string;
          checked: boolean;
          text: string;
        }> = [];
        ariaNodes.forEach((el, idx) => {
          if (el.querySelector('input')) return;
          const r = el.getBoundingClientRect();
          const st = window.getComputedStyle(el);
          if (r.width < 8 || r.height < 8 || st.display === 'none' || st.visibility === 'hidden') return;
          const pgAriaId = `pg-f${frameIdx}-ar-${idx}`;
          el.setAttribute('data-pg-aria', pgAriaId);
          const groupEl = el.closest('[role="radiogroup"], [role="group"], form, section, div');
          const groupKey =
            groupEl?.getAttribute('aria-label') ||
            groupEl?.id ||
            `aria_grp_${idx}`;
          const questionHint = (
            groupEl?.querySelector('h1,h2,h3,h4,p,legend,label')?.textContent ||
            groupEl?.getAttribute('aria-label') ||
            ''
          )
            .replace(/\s+/g, ' ')
            .toLowerCase();
          ariaChoices.push({
            pgAriaId,
            role: el.getAttribute('role') || 'radio',
            groupKey,
            questionHint,
            checked: el.getAttribute('aria-checked') === 'true',
            text: (el.innerText || '').trim().slice(0, 60),
          });
        });

        const pageQuestionPrompt = (
          document.querySelector('h1, h2, h3, legend, [class*="question" i]')?.textContent || ''
        )
          .replace(/\s+/g, ' ')
          .toLowerCase();

        const surveyCardButtons: Array<{ pgCardId: string; text: string; questionHint: string }> = [];
        if (fields.length === 0 && ariaChoices.length === 0) {
          const btns = Array.from(
            document.querySelectorAll(
              'button, [role="button"], label, a[class*="answer" i], a[class*="option" i], a[class*="btn" i], a[class*="button" i], a[class*="cta" i], div[class*="answer" i], div[class*="option" i], div[class*="btn" i], div[class*="cta" i], li[class*="option" i]'
            )
          ) as HTMLElement[];

          const fallbackCardPool: Array<{ btn: HTMLElement; txt: string }> = [];

          btns.forEach((btn, idx) => {
            if (btn.closest('header, nav, footer, [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i]')) {
              return;
            }
            const r = btn.getBoundingClientRect();
            const st = window.getComputedStyle(btn);
            if (r.width < 24 || r.height < 20 || st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') {
              return;
            }
            const txt = (btn.innerText || (btn as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim();
            if (!txt || txt.length > 80) return;
            if (/^(privacy|terms|cookie|menu|login|sign\s*in|home|back|close|x|skip|cancel|impressum|datenschutz|agb|abbrechen)$/i.test(txt)) {
              return;
            }
            const cls = typeof btn.className === 'string' ? btn.className : '';
            if (
              /^(yes|no|maybe|male|female|other|18-24|25-34|35-44|45-54|55\+|65\+|always|often|sometimes|rarely|never|daily|weekly|monthly|agree|strongly|start|begin|next|continue|android|iphone|ios|windows|mac|under|over|ja|nein|vielleicht|männlich|weiblich|divers|mann|frau|weiter|fortfahren|jetzt|los|starten|nächste|stimme\s*zu|oui|non|suivant|continuer|sí|si|siguiente|continuar|volgende|avanti|dalej)/i.test(
                txt
              ) ||
              /(option|choice|answer|survey-opt|quiz|poll|step|cta|btn)/i.test(cls)
            ) {
              const pgCardId = `pg-f${frameIdx}-card-${idx}`;
              btn.setAttribute('data-pg-card', pgCardId);
              surveyCardButtons.push({ pgCardId, text: txt, questionHint: pageQuestionPrompt });
            } else {
              fallbackCardPool.push({ btn, txt });
            }
          });

          if (surveyCardButtons.length === 0 && fallbackCardPool.length >= 1) {
            fallbackCardPool.slice(0, 12).forEach((item, idx) => {
              const pgCardId = `pg-f${frameIdx}-fbcard-${idx}`;
              item.btn.setAttribute('data-pg-card', pgCardId);
              surveyCardButtons.push({ pgCardId, text: item.txt, questionHint: pageQuestionPrompt });
            });
          }
        }

        const bodySnippet = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 220);
        const cardSig = surveyCardButtons.map((b) => b.text).slice(0, 6).join(',');
        const sig = `${window.location.href}|${fields.map((f) => `${f.type}:${f.name}`).join(',')}|${ariaChoices.length}|${cardSig}|${bodySnippet}`;
        return { fields, ariaChoices, surveyCardButtons, sig };
      }, fIdx);
    } catch {
      continue;
    }

    latestSignature = scanResult.sig || latestSignature;
    const { fields, ariaChoices, surveyCardButtons } = scanResult;
    if (fields.length === 0 && ariaChoices.length === 0 && surveyCardButtons.length === 0) {
      continue;
    }

    const pickSmartChoice = <T extends { textHint: string }>(options: T[], promptHint: string): T => {
      if (options.length <= 1) return options[0];
      const combinedPrompt = `${promptHint} ${options.map((o) => o.textHint).join(' ')}`.toLowerCase();

      // 1. Gender match (English + German + EU)
      if (/\b(male|female|männlich|weiblich|mann|frau|homme|femme)\b/i.test(combinedPrompt)) {
        const genderRegex =
          identity.gender === 'Male'
            ? /^\s*(male|männlich|mann|herr|homme|masculino)\b/i
            : /^\s*(female|weiblich|frau|femme|femenino)\b/i;
        const gMatch = options.find((o) => genderRegex.test(o.textHint));
        if (gMatch) return gMatch;
      }

      // 2. Age range match
      const ageNum = Number(identity.age) || 28;
      const ageMatch = options.find((o) => {
        const m = o.textHint.match(/(\d{2})\s*[-–to]+\s*(\d{2})/i);
        if (m) {
          const lo = Number(m[1]);
          const hi = Number(m[2]);
          return ageNum >= lo && ageNum <= hi;
        }
        return false;
      });
      if (ageMatch) return ageMatch;

      // 3. Eligibility / Consent / Positive answers (avoid "No", "Nein", "Disagree", "Under 18", "None")
      const eligiblePool = options.filter(
        (o) =>
          !/^\s*(no|nein|non|disagree|never|nie|none|keine|none of the above|prefer not|under\s*18|unter\s*18)\b/i.test(
            o.textHint
          )
      );
      if (
        /(18|21|older|älter|agree|consent|terms|confirm|eligible|interested|qualify|subscribe|stimme|datenschutz|agb|teilnehmen)/i.test(
          promptHint
        )
      ) {
        const yesChoice = eligiblePool.find((o) =>
          /\b(yes|ja|oui|sí|si|agree|accept|confirm|true|stimme|akzeptiere|weiter)\b/i.test(o.textHint)
        );
        if (yesChoice) return yesChoice;
      }

      const pool = eligiblePool.length > 0 ? eligiblePool : options;
      return pool[Math.floor(Math.random() * pool.length)];
    };

    const radioGroups = new Map<string, typeof fields>();
    const surveyCheckboxes: typeof fields = [];

    for (const field of fields) {
      if (field.type === 'radio') {
        const list = radioGroups.get(field.name) ?? [];
        list.push(field);
        radioGroups.set(field.name, list);
        continue;
      }

      const sel = `[data-pg-input="${field.pgInputId}"]`;
      const clickTargetSel =
        field.inputHidden && field.pgLabelId ? `[data-pg-label="${field.pgLabelId}"]` : sel;
      const loc = frame.locator(sel).first();

      try {
        if (field.type === 'checkbox') {
          if (field.checked) continue;
          if (
            field.required ||
            /(terms|agree|policy|privacy|consent|accept|confirm|newsletter|rules|age\s*18|opt.?in|i\s+am)/i.test(
              field.hint
            )
          ) {
            if (field.inputHidden && field.pgLabelId) {
              await humanMoveAndClick(page, frame, clickTargetSel, cursor, humanLike);
            } else {
              await loc.check({ force: true });
            }
            filledFields++;
            details.push('Checked consent box');
            if (humanLike) await humanPause(120, 260);
          } else {
            surveyCheckboxes.push(field);
          }
          continue;
        }

        if (field.tag === 'select') {
          if (field.selectOptions.length > 0) {
            const h = field.hint;
            let matchedOpt: { value: string; text: string } | undefined;

            if (/(country|nation)/i.test(h)) {
              matchedOpt = field.selectOptions.find((o) => {
                const lv = o.value.toLowerCase();
                const lt = o.text.toLowerCase();
                return (
                  lt.includes(identity.country.toLowerCase()) ||
                  lv === identity.countryCode.toLowerCase() ||
                  lt === identity.countryCode.toLowerCase() ||
                  (identity.countryCode === 'US' && /\bunited\s*states\b|\busa\b/i.test(lt)) ||
                  (identity.countryCode === 'GB' && /\bunited\s*kingdom\b|\bgreat\s*britain\b/i.test(lt))
                );
              });
            } else if (/(gender|sex)/i.test(h)) {
              matchedOpt = field.selectOptions.find((o) =>
                `${o.value} ${o.text}`.toLowerCase().includes(identity.gender.toLowerCase())
              );
            } else if (/(state|province|region)/i.test(h)) {
              matchedOpt = field.selectOptions.find((o) =>
                `${o.value} ${o.text}`.toLowerCase().includes(identity.state.toLowerCase())
              );
            } else if (/(birth.?year|yob|year)/i.test(h)) {
              matchedOpt = field.selectOptions.find((o) =>
                `${o.value} ${o.text}`.includes(identity.birthYear)
              );
            } else if (/(birth.?month|\bmonth\b)/i.test(h)) {
              matchedOpt = field.selectOptions.find((o) => {
                const lt = o.text.toLowerCase();
                const lv = o.value.toLowerCase();
                return (
                  lt.includes(identity.birthMonthName.toLowerCase()) ||
                  lt.includes(identity.birthMonthShort.toLowerCase()) ||
                  lv === identity.birthMonth ||
                  lv === String(identity.birthMonthNum)
                );
              });
            } else if (/(birth.?day|\bday\b)/i.test(h)) {
              matchedOpt = field.selectOptions.find((o) => {
                const lv = o.value.trim();
                const lt = o.text.trim();
                return (
                  lv === identity.birthDay ||
                  lv === String(Number(identity.birthDay)) ||
                  lt === identity.birthDay ||
                  lt === String(Number(identity.birthDay))
                );
              });
            } else if (/(salutation|title|prefix)/i.test(h)) {
              const titlePref = identity.gender === 'Male' ? 'mr' : 'ms';
              matchedOpt = field.selectOptions.find((o) =>
                o.text.toLowerCase().replace(/\./g, '').startsWith(titlePref)
              );
            }

            const cleanPool = field.selectOptions.filter(
              (o) => !/(prefer not|none|n\/a|other)/i.test(o.text)
            );
            const fallbackPool = cleanPool.length > 0 ? cleanPool : field.selectOptions;
            const pick = matchedOpt || fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
            await loc.selectOption(pick.value).catch(async () => {
              await loc.selectOption({ index: 1 }).catch(() => {});
            });
            filledFields++;
            details.push(`Selected ${pick.text || pick.value}`);
          } else {
            await loc.selectOption({ index: 1 }).catch(() => {});
            filledFields++;
            details.push('Selected dropdown option');
          }
          continue;
        }

        if (field.currentVal && field.currentVal.trim().length > 0 && field.type !== 'email') {
          continue;
        }

        let value = '';
        if (/(search|suche|query|captcha)/i.test(field.hint)) {
          continue;
        } else if (/confirm.*e-?mail|re.?enter.*e-?mail|verify.*e-?mail|e-?mail.*bestätig|e-?mail.*wiederhol/i.test(field.hint)) {
          value = identity.email;
          details.push(`Confirm Email (${identity.email})`);
        } else if (field.type === 'email' || /e-?mail|gmail/i.test(field.hint)) {
          value = identity.email;
          details.push(`Email (${identity.email})`);
        } else if (/confirm.*pass|re.?enter.*pass|pass.*again|verify.*pass|passwort.*bestätig|passwort.*wiederhol|kennwort.*wiederhol/i.test(field.hint)) {
          value = identity.password;
          details.push('Confirm Password');
        } else if (field.type === 'password' || /pass(word|code|wort)?|kennwort|pwd/i.test(field.hint)) {
          value = identity.password;
          details.push('Password');
        } else if (field.type === 'tel' || /(phone|mobile|cell|whatsapp|\btel\b|telefon|handy|mobil|rufnummer)/i.test(field.hint)) {
          value = identity.phone;
          details.push('Phone');
        } else if (/(address.*2|apt|suite|unit|line\s*2|adresszusatz)/i.test(field.hint)) {
          value = 'Apt 2B';
          details.push('Address 2');
        } else if (/(street|address|addr|line\s*1|straße|strasse|anschrift|adresse|dirección)/i.test(field.hint)) {
          value = identity.streetAddress;
          details.push(`Address (${identity.streetAddress})`);
        } else if (/(zip|postal|postcode|plz|postleitzahl|code\s*postal)/i.test(field.hint)) {
          value = identity.zip;
          details.push(`Zip (${identity.zip})`);
        } else if (/(city|town|suburb|stadt|\bort\b|wohnort|ville|ciudad)/i.test(field.hint)) {
          value = identity.city;
          details.push(`City (${identity.city})`);
        } else if (/(state|province|region|county|bundesland)/i.test(field.hint)) {
          value = identity.state;
          details.push(`State (${identity.state})`);
        } else if (/(country|nation|\bland\b|pays|país)/i.test(field.hint)) {
          value = identity.country;
          details.push(`Country (${identity.country})`);
        } else if (/(birth.?year|yob|year.?of.?birth|geburtsjahr)/i.test(field.hint)) {
          value = identity.birthYear;
          details.push(`Birth Year (${identity.birthYear})`);
        } else if (/(birth.?month|month.?of.?birth|geburtsmonat)/i.test(field.hint)) {
          value = identity.birthMonth;
          details.push(`Birth Month (${identity.birthMonth})`);
        } else if (/(birth.?day|day.?of.?birth|geburtstag)/i.test(field.hint)) {
          value = identity.birthDay;
          details.push(`Birth Day (${identity.birthDay})`);
        } else if (/(dob|date.?of.?birth|birthday|birth.?date|geburtsdatum)/i.test(field.hint) || field.type === 'date') {
          value = field.type === 'date' ? identity.dobIso : (identity.countryCode === 'US' ? identity.dobUs : identity.dobEu);
          details.push('DOB');
        } else if (/\bage\b|how\s+old|\balter\b|wie\s+alt/i.test(field.hint)) {
          value = identity.age;
          details.push(`Age (${identity.age})`);
        } else if (/(gender|sex|geschlecht)/i.test(field.hint)) {
          value = identity.gender;
          details.push(`Gender (${identity.gender})`);
        } else if (/(first.?name|fname|given|vorname|prénom|nombre)/i.test(field.hint)) {
          value = identity.firstName;
          details.push('First name');
        } else if (/(last.?name|lname|surname|family|nachname|familienname|apellido)/i.test(field.hint)) {
          value = identity.lastName;
          details.push('Last name');
        } else if (/(user.?name|handle|login|nick|benutzername|spitzname)/i.test(field.hint)) {
          value = identity.username;
          details.push(`Username (${identity.username})`);
        } else if (/(company|organization|employer|business|firma|unternehmen)/i.test(field.hint)) {
          value = identity.company;
          details.push('Company');
        } else if (/(job|occupation|role|profession|title|beruf|tätigkeit)/i.test(field.hint)) {
          value = identity.jobTitle;
          details.push('Occupation');
        } else if (/(income|salary|einkommen|gehalt)/i.test(field.hint)) {
          value = identity.income;
          details.push('Income');
        } else if (/(website|url|blog)/i.test(field.hint)) {
          value = 'https://example.com';
          details.push('Website');
        } else if (/(heard|referral|source|how\s+did\s+you)/i.test(field.hint)) {
          value = 'Google Search';
          details.push('Referral source');
        } else if (/(name|full.?name|\bnom\b)/i.test(field.hint)) {
          value = identity.fullName;
          details.push(`Name (${identity.fullName})`);
        } else if (field.type === 'number') {
          value = identity.age;
          details.push('Numeric field');
        } else if (field.tag === 'textarea') {
          value = 'Great service and clear options, thank you.';
          details.push('Survey feedback');
        } else if (field.required || field.insideForm) {
          value = identity.fullName;
          details.push('Form field');
        } else {
          continue;
        }

        await humanTypeInto(frame, sel, value);
        filledFields++;
      } catch {
        // Skip non-interactable input
      }
    }

    // Pick smart option per radio question group (matching gender, age range, eligibility)
    for (const [, group] of radioGroups) {
      if (group.length === 0 || group.some((g) => g.checked)) continue;
      const chosen = pickSmartChoice(
        group.map((g) => ({ ...g, textHint: g.labelOnly || g.hint })),
        group[0].hint
      );
      try {
        if (chosen.pgLabelId) {
          await humanMoveAndClick(page, frame, `[data-pg-label="${chosen.pgLabelId}"]`, cursor, humanLike);
        } else {
          await frame.locator(`[data-pg-input="${chosen.pgInputId}"]`).first().check({ force: true });
        }
        filledFields++;
        details.push(`Selected: ${chosen.labelOnly || 'survey option'}`.slice(0, 42));
        if (humanLike) await humanPause(140, 300);
      } catch {
        await frame
          .locator(`[data-pg-input="${chosen.pgInputId}"]`)
          .first()
          .check({ force: true })
          .catch(() => {});
      }
    }

    if (surveyCheckboxes.length > 0 && !surveyCheckboxes.some((c) => c.checked)) {
      const picked = surveyCheckboxes[Math.floor(Math.random() * surveyCheckboxes.length)];
      try {
        if (picked.pgLabelId) {
          await humanMoveAndClick(page, frame, `[data-pg-label="${picked.pgLabelId}"]`, cursor, humanLike);
        } else {
          await frame.locator(`[data-pg-input="${picked.pgInputId}"]`).first().check({ force: true });
        }
        filledFields++;
        details.push('Checked survey option');
      } catch {
        // Ignore
      }
    }

    if (ariaChoices.length > 0) {
      const ariaGroups = new Map<string, typeof ariaChoices>();
      for (const item of ariaChoices) {
        if (item.role === 'checkbox') {
          if (!item.checked && Math.random() < 0.75) {
            await humanMoveAndClick(page, frame, `[data-pg-aria="${item.pgAriaId}"]`, cursor, humanLike).catch(() => {});
            filledFields++;
            details.push(`ARIA check: ${item.text || 'option'}`);
          }
        } else {
          const grp = ariaGroups.get(item.groupKey) ?? [];
          grp.push(item);
          ariaGroups.set(item.groupKey, grp);
        }
      }
      for (const [, grp] of ariaGroups) {
        if (grp.some((g) => g.checked)) continue;
        const pick = pickSmartChoice(
          grp.map((g) => ({ ...g, textHint: g.text.toLowerCase() })),
          grp[0].questionHint
        );
        await humanMoveAndClick(page, frame, `[data-pg-aria="${pick.pgAriaId}"]`, cursor, humanLike).catch(() => {});
        filledFields++;
        details.push(`Survey answer: ${pick.text || 'selected'}`);
      }
    }

    if (filledFields === 0 && surveyCardButtons.length > 0) {
      const pick = pickSmartChoice(
        surveyCardButtons.map((b) => ({ ...b, textHint: b.text.toLowerCase() })),
        surveyCardButtons[0].questionHint
      );
      await humanMoveAndClick(page, frame, `[data-pg-card="${pick.pgCardId}"]`, cursor, humanLike).catch(() => {});
      filledFields++;
      details.push(`Survey card: ${pick.text}`);
      await page.waitForLoadState('domcontentloaded', { timeout: 3500 }).catch(() => {});
      await humanPause(450, 900);
      return { filledFields, submitted: true, details, signature: latestSignature };
    }

    // 3. Submit inside the frame where form/survey inputs were found
    let submitted = false;
    if (filledFields > 0 || signUpConfig?.submitSelector?.trim()) {
      const customSub = signUpConfig?.submitSelector?.trim();
      if (customSub) {
        try {
          const btn = frame.locator(customSub).first();
          if (await btn.isVisible({ timeout: 2000 })) {
            await humanMoveAndClick(page, frame, customSub, cursor, humanLike);
            submitted = true;
          }
        } catch {
          // Fallback below
        }
      }

      if (!submitted) {
        const submitSelector = await frame
          .evaluate(() => {
            const candidates = Array.from(
              document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a')
            ) as HTMLElement[];

            let best: { el: HTMLElement; score: number } | null = null;
            for (const el of candidates) {
              const rect = el.getBoundingClientRect();
              if (rect.width < 6 || rect.height < 6) continue;
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

              const type = (el.getAttribute('type') || '').toLowerCase();
              const txt = ((el as HTMLInputElement).value || el.innerText || el.getAttribute('aria-label') || '').trim().toLowerCase();
              let score = 0;
              if (type === 'submit') score += 35;
              if (
                /^(sign\s*up|register|create\s*account|submit|join|continue|get\s*started|next|finish|complete|done|confirm|claim|send|enter|proceed|weiter|fortfahren|nächste|absenden|senden|bestätigen|anmelden|registrieren|fertig|abschließen|teilnehmen|jetzt|los|suivant|continuer|valider|siguiente|continuar|enviar|volgende|ga\s*verder|verstuur|avanti|continua|invia|dalej|wyślij)$/i.test(
                  txt
                )
              ) {
                score += 48;
              } else if (
                /(sign\s*up|register|create|submit|join|continue|next|finish|complete|confirm|claim|verify|proceed|get\s*started|weiter|fortfahren|absenden|bestätigen|anmelden|registrieren|kostenlos|teilnehmen|suivant|continuer|siguiente|continuar|volgende|avanti|dalej)/i.test(
                  txt
                )
              ) {
                score += 24;
              }
              if (el.closest('form')) score += 16;
              if (score > 0 && (!best || score > best.score)) {
                best = { el, score };
              }
            }
            if (!best) return null;
            best.el.setAttribute('data-pg-submit', '1');
            return '[data-pg-submit="1"]';
          })
          .catch(() => null);

        if (submitSelector) {
          try {
            await humanMoveAndClick(page, frame, submitSelector, cursor, humanLike);
            submitted = true;
          } catch {
            await page.keyboard.press('Enter').catch(() => {});
            submitted = true;
          }
        } else if (filledFields > 0) {
          await page.keyboard.press('Enter').catch(() => {});
          submitted = true;
        }
      }

      if (submitted) {
        await page.waitForLoadState('domcontentloaded', { timeout: 4500 }).catch(() => {});
        await humanPause(550, 1050);
        return { filledFields, submitted: true, details, signature: latestSignature };
      }
    }
  }

  return { filledFields, submitted: false, details, signature: latestSignature };
}

async function runMultiStepSurveyAndSignUp(params: {
  page: Page;
  context: BrowserContext;
  device: DeviceProfile;
  config: AutomationConfig;
  identity: GeneratedIdentity;
  runningState: RunningProfileState;
  humanLike: boolean;
  cursor: { x: number; y: number };
  shouldAbort: () => boolean;
  appendStep: (
    profile: RunningProfileState,
    phase: RunningProfileState['steps'][number]['phase'],
    message: string,
    detail?: string
  ) => void;
  onStateSync?: (profile: RunningProfileState) => void;
  onClickExecuted: () => void;
}): Promise<{ totalFilled: number; stepsSubmitted: number; emailSubmitted: boolean }> {
  const {
    page,
    context,
    device,
    config,
    identity,
    runningState,
    humanLike,
    cursor,
    shouldAbort,
    appendStep,
    onStateSync,
    onClickExecuted,
  } = params;

  let totalFilled = 0;
  let stepsSubmitted = 0;
  let emailSubmitted = false;
  const seenSignatures = new Set<string>();
  const MAX_SURVEY_STEPS = 12;

  for (let step = 1; step <= MAX_SURVEY_STEPS && !shouldAbort(); step++) {
    const res = await performRealSignUpForm(
      page,
      identity,
      config.signUpConfig,
      humanLike,
      cursor
    );

    if (res.filledFields === 0 && !res.submitted) {
      break;
    }

    totalFilled += res.filledFields;
    if (res.details.some((d) => /email/i.test(d))) {
      emailSubmitted = true;
    }
    runningState.screenshotDataUrl =
      (await captureScreenshotDataUrl(page)) || runningState.screenshotDataUrl;
    runningState.currentUrl = page.url();
    runningState.pageTitle = (await page.title().catch(() => '')) || runningState.currentUrl;
    runningState.cookiesCapturedCount = await syncCookiesFromContext(
      context,
      device,
      config.saveCookies
    );

    if (res.submitted) {
      stepsSubmitted++;
      onClickExecuted();
      runningState.formSubmitted = true;
      runningState.clickedUrls.push(runningState.currentUrl);
      if (runningState.clickedUrls.length > 100) {
        runningState.clickedUrls = runningState.clickedUrls.slice(-100);
      }
      appendStep(
        runningState,
        'signup_form',
        `Step ${step}: Completed survey/form (${res.filledFields} fields · ${identity.email})`,
        res.details.slice(0, 4).join(' · ')
      );
      onStateSync?.(runningState);
    } else if (res.filledFields > 0) {
      appendStep(
        runningState,
        'signup_form',
        `Step ${step}: Filled ${res.filledFields} field(s) (${identity.email})`,
        res.details.slice(0, 4).join(' · ')
      );
      onStateSync?.(runningState);
      break;
    }

    if (res.signature && seenSignatures.has(res.signature)) {
      break;
    }
    if (res.signature) {
      seenSignatures.add(res.signature);
    }

    await humanPause(450, 850);
    const hasNextStep = await hasVisibleFormOrSurvey(page);
    if (!hasNextStep) break;
  }

  return { totalFilled, stepsSubmitted, emailSubmitted };
}

function isTunnelOrTransientProxyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_CONNECTION_RESET|ERR_TIMED_OUT|ERR_EMPTY_RESPONSE/i.test(
    msg
  );
}

async function safeNavigate(
  page: Page,
  url: string,
  options?: {
    timeoutMs?: number;
    onSlowNotice?: (msg: string) => void;
  }
) {
  const timeoutMs = options?.timeoutMs ?? 24000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      return response;
    } catch (err) {
      lastError = err;
      const currentUrl = page.url();
      const isLoaded =
        Boolean(currentUrl) &&
        currentUrl !== 'about:blank' &&
        !currentUrl.startsWith('chrome-error://');

      if (isLoaded) {
        options?.onSlowNotice?.(
          `Slow page scripts timed out at ${Math.round(timeoutMs / 1000)}s — continuing on ${currentUrl}`
        );
        await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(1500);
        return null;
      }

      if (isTunnelOrTransientProxyError(err) && attempt === 1) {
        options?.onSlowNotice?.(
          'Proxy tunnel dropped (ERR_TUNNEL_CONNECTION_FAILED) — retrying connection cleanly…'
        );
        await humanPause(1200, 2000);
        continue;
      }

      // Fallback: retry using 'commit'
      options?.onSlowNotice?.(`Retrying slow tracker/redirect with commit mode: ${url}`);
      try {
        const retryResponse = await page.goto(url, {
          waitUntil: 'commit',
          timeout: 35000,
        });
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(2000);
        const afterRetryUrl = page.url();
        if (
          afterRetryUrl &&
          afterRetryUrl !== 'about:blank' &&
          !afterRetryUrl.startsWith('chrome-error://')
        ) {
          return retryResponse;
        }
      } catch (commitErr) {
        lastError = commitErr;
      }
    }
  }

  throw lastError;
}

export async function runDeviceInRealBrowser(params: {
  executablePath: string | null;
  device: DeviceProfile;
  deviceIndex?: number;
  config: AutomationConfig;
  runningState: RunningProfileState;
  shouldAbort: () => boolean;
  appendStep: (
    profile: RunningProfileState,
    phase: RunningProfileState['steps'][number]['phase'],
    message: string,
    detail?: string
  ) => void;
  onStateSync?: (profile: RunningProfileState) => void;
  onClickExecuted: () => void;
}): Promise<{
  clickedCount: number;
  formSubmitted: boolean;
}> {
  const {
    executablePath,
    device,
    deviceIndex = 0,
    config,
    runningState,
    shouldAbort,
    appendStep,
    onStateSync,
    onClickExecuted,
  } = params;

  const { chromium } = await import('playwright-core');
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let proxyBridge: LocalProxyBridge | undefined;
  const openPopups: Page[] = [];
  let clickedCount = 0;
  let formSubmitted = false;
  let emailSubmitted = false;

  try {
    const isHeaded = Boolean(config.headedBrowser);
    const humanLike = config.humanLike !== false;
    const useNewHeadless = !isHeaded && process.platform !== 'linux';
    const followNewPages =
      config.followNewPages !== false ||
      config.clickMode === 'human_journey' ||
      config.clickMode === 'survey_and_email' ||
      config.clickMode === 'click_and_signup' ||
      config.clickMode === 'auto_cta';

    const winX = 60 + (deviceIndex % 4) * 42;
    const winY = 40 + (deviceIndex % 3) * 34;

    const resolvedProxy = await resolvePlaywrightProxy(device);
    const proxy = resolvedProxy.proxy;
    proxyBridge = resolvedProxy.bridge;

    const launchArgs = [
      '--disable-blink-features=AutomationControlled',
      '--disable-popup-blocking',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--enforce-webrtc-ip-permission-check',
      '--disable-quic',
      '--disable-background-networking',
      '--dns-prefetch-disable',
      '--disable-features=AsyncDns,DnsOverHttps',
      ...(proxy ? ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost'] : []),
      '--no-first-run',
      '--no-default-browser-check',
      ...(useNewHeadless ? ['--headless=new'] : []),
      ...(isHeaded
        ? [
            '--new-window',
            `--window-position=${winX},${winY}`,
            `--window-size=${Math.max(device.fingerprint.viewportWidth, 980)},${Math.max(device.fingerprint.viewportHeight, 760)}`,
          ]
        : []),
      ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    ];

    const ignoreDefaultArgs = useNewHeadless
      ? ['--enable-automation', '--headless']
      : ['--enable-automation'];

    const launchBase = {
      headless: !isHeaded,
      slowMo: isHeaded ? (humanLike ? 65 : 90) : 0,
      ignoreDefaultArgs,
      args: launchArgs,
      ...(proxy ? { proxy } : {}),
    };

    if (executablePath) {
      try {
        browser = await chromium.launch({
          executablePath,
          ...launchBase,
        });
      } catch {
        try {
          browser = await chromium.launch({
            channel: 'chrome',
            ...launchBase,
          });
        } catch {
          browser = await chromium.launch({
            channel: 'msedge',
            ...launchBase,
          });
        }
      }
    } else {
      try {
        browser = await chromium.launch({
          channel: 'chrome',
          ...launchBase,
        });
      } catch {
        browser = await chromium.launch({
          channel: 'msedge',
          ...launchBase,
        });
      }
    }

    context = await browser.newContext({
      userAgent: device.fingerprint.userAgent,
      viewport: {
        width: device.fingerprint.viewportWidth,
        height: device.fingerprint.viewportHeight,
      },
      deviceScaleFactor: device.fingerprint.devicePixelRatio || 1,
      isMobile: device.userAgent.mobile,
      hasTouch: device.fingerprint.maxTouchPoints > 0,
      locale: device.fingerprint.languages[0] || 'en-US',
      timezoneId: device.fingerprint.timezone || 'UTC',
      geolocation: {
        latitude: device.fingerprint.geolocation.lat,
        longitude: device.fingerprint.geolocation.lon,
        accuracy: device.fingerprint.geolocation.accuracy,
      },
      permissions: ['geolocation'],
      ignoreHTTPSErrors: true,
      bypassCSP: true,
      ...(proxy ? { proxy } : {}),
    });

    // Full human anti-bot stealth + fingerprint binding + WebRTC LAN IP leak protection
    await context.addInitScript((fp) => {
      try {
        // Scrub LAN/host IP candidates from WebRTC when routed via proxy
        if (typeof window.RTCPeerConnection === 'function') {
          const OrigRTC = window.RTCPeerConnection;
          const isPrivateCandidate = (cand: string): boolean =>
            /\b(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|127\.0\.0\.1|fe80:|::1|\.local\b|typ\s+(host|srflx|prflx))/i.test(
              cand
            );
          const WrappedRTC = function (config?: RTCConfiguration) {
            const safeConfig: RTCConfiguration = {
              ...(config || {}),
              iceTransportPolicy: 'relay',
            };
            const pc = new OrigRTC(safeConfig);
            const origAddListener = pc.addEventListener.bind(pc);
            pc.addEventListener = function (
              type: string,
              listener: EventListenerOrEventListenerObject,
              options?: boolean | AddEventListenerOptions
            ) {
              if (type === 'icecandidate' && typeof listener === 'function') {
                return origAddListener(
                  type,
                  (ev: Event) => {
                    const cand = (ev as RTCPeerConnectionIceEvent)?.candidate?.candidate || '';
                    if (cand && isPrivateCandidate(cand)) return;
                    listener(ev);
                  },
                  options
                );
              }
              return origAddListener(type, listener, options);
            };
            let userOnIceCandidate: ((this: RTCPeerConnection, ev: RTCPeerConnectionIceEvent) => unknown) | null = null;
            try {
              Object.defineProperty(pc, 'onicecandidate', {
                get: () => userOnIceCandidate,
                set: (fn) => {
                  userOnIceCandidate = typeof fn === 'function' ? fn : null;
                  origAddListener('icecandidate', (ev: Event) => {
                    if (!userOnIceCandidate) return;
                    const iceEv = ev as RTCPeerConnectionIceEvent;
                    const cand = iceEv?.candidate?.candidate || '';
                    if (cand && isPrivateCandidate(cand)) return;
                    userOnIceCandidate.call(pc, iceEv);
                  });
                },
                configurable: true,
              });
            } catch {
              // Ignore if onicecandidate is non-configurable
            }
            return pc;
          } as unknown as typeof RTCPeerConnection;
          WrappedRTC.prototype = OrigRTC.prototype;
          window.RTCPeerConnection = WrappedRTC;
          const winAny = window as unknown as Record<string, unknown>;
          if (typeof winAny.webkitRTCPeerConnection === 'function') {
            winAny.webkitRTCPeerConnection = WrappedRTC;
          }
        }

        Object.defineProperty(Navigator.prototype, 'webdriver', {
          get: () => undefined,
          configurable: true,
        });
        Object.defineProperty(navigator, 'platform', { get: () => fp.platform });
        Object.defineProperty(navigator, 'vendor', { get: () => fp.vendor });
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => fp.hardwareConcurrency,
        });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => fp.deviceMemory });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => fp.maxTouchPoints });
        Object.defineProperty(navigator, 'languages', { get: () => fp.languages });

        if (!('connection' in navigator)) {
          Object.defineProperty(navigator, 'connection', {
            get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }),
            configurable: true,
          });
        }
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
            Object.defineProperty(Notification, 'permission', {
              get: () => 'default',
              configurable: true,
            });
          }
        } catch {
          // Ignore Notification read-only
        }

        const isChromiumUa =
          !/Firefox|iPhone|iPad|iPod/i.test(fp.userAgent) &&
          !fp.os.includes('iOS') &&
          !(/Version\/[\d.]+.*Safari/i.test(fp.userAgent) && !/Chrome\//i.test(fp.userAgent));
        if (isChromiumUa) {
          const uaBrands = /Edg\//i.test(fp.userAgent)
            ? [
                { brand: 'Microsoft Edge', version: '131' },
                { brand: 'Chromium', version: '131' },
                { brand: 'Not_A Brand', version: '24' },
              ]
            : [
                { brand: 'Google Chrome', version: '131' },
                { brand: 'Chromium', version: '131' },
                { brand: 'Not_A Brand', version: '24' },
              ];
          const isMob = Boolean(fp.maxTouchPoints > 0 || /Android|iPhone|iPad/i.test(fp.userAgent));
          const chPlatform = fp.os.includes('Android')
            ? 'Android'
            : fp.os.includes('macOS')
              ? 'macOS'
              : fp.os.includes('iOS')
                ? 'iOS'
                : fp.os.includes('Linux')
                  ? 'Linux'
                  : 'Windows';
          try {
            Object.defineProperty(navigator, 'userAgentData', {
              get: () => ({
                brands: uaBrands,
                mobile: isMob,
                platform: chPlatform,
                getHighEntropyValues: async (hints: string[]) => {
                  const res: Record<string, unknown> = {
                    brands: uaBrands,
                    mobile: isMob,
                    platform: chPlatform,
                  };
                  if (hints.includes('architecture')) res.architecture = isMob ? 'arm' : 'x86';
                  if (hints.includes('bitness')) res.bitness = '64';
                  if (hints.includes('model')) res.model = isMob ? 'Pixel 8' : '';
                  if (hints.includes('platformVersion')) res.platformVersion = chPlatform === 'Windows' ? '15.0.0' : '14.0.0';
                  return res;
                },
                toJSON: () => ({ brands: uaBrands, mobile: isMob, platform: chPlatform }),
              }),
              configurable: true,
            });
          } catch {
            // Ignore read-only userAgentData
          }

          if (!window.outerWidth || !window.outerHeight) {
            try {
              Object.defineProperty(window, 'outerWidth', { get: () => fp.viewportWidth + 16 });
              Object.defineProperty(window, 'outerHeight', { get: () => fp.viewportHeight + 88 });
            } catch {
              // Ignore read-only outer dimensions
            }
          }

          const fakePlugins = [
            { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
            { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
          ];
          Object.defineProperty(navigator, 'plugins', {
            get: () => fakePlugins,
          });
          if (!(window as unknown as Record<string, unknown>).chrome) {
            Object.defineProperty(window, 'chrome', {
              value: {
                runtime: {},
                app: { isInstalled: false },
                loadTimes: () => ({}),
                csi: () => ({}),
              },
              configurable: true,
            });
          }
        }

        if (navigator.permissions?.query) {
          const origQuery = navigator.permissions.query.bind(navigator.permissions);
          navigator.permissions.query = (params: PermissionDescriptor) => {
            if (params?.name === 'notifications') {
              return Promise.resolve({
                state: 'prompt',
                onchange: null,
              } as unknown as PermissionStatus);
            }
            return origQuery(params);
          };
        }

        const origGetParam = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (param: number) {
          if (param === 37445) return fp.webglVendor;
          if (param === 37446) return fp.webglRenderer;
          return origGetParam.call(this, param);
        };

        if (typeof WebGL2RenderingContext !== 'undefined') {
          const origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
          WebGL2RenderingContext.prototype.getParameter = function (param: number) {
            if (param === 37445) return fp.webglVendor;
            if (param === 37446) return fp.webglRenderer;
            return origGetParam2.call(this, param);
          };
        }

        // Bind unique Screen dimensions matching each device
        try {
          Object.defineProperty(window.screen, 'width', { get: () => fp.viewportWidth });
          Object.defineProperty(window.screen, 'height', { get: () => fp.viewportHeight });
          Object.defineProperty(window.screen, 'availWidth', { get: () => fp.viewportWidth });
          Object.defineProperty(window.screen, 'availHeight', {
            get: () => Math.max(400, fp.viewportHeight - 40),
          });
          Object.defineProperty(window.screen, 'colorDepth', { get: () => fp.colorDepth || 24 });
          Object.defineProperty(window.screen, 'pixelDepth', { get: () => fp.colorDepth || 24 });
          Object.defineProperty(window, 'devicePixelRatio', {
            get: () => fp.devicePixelRatio || 1,
          });
        } catch {
          // Ignore if read-only
        }

        // Deterministic per-device Canvas 2D & AudioContext noise so no two devices share hashes
        let seedHash = 2166136261;
        for (let i = 0; i < fp.seed.length; i++) {
          seedHash ^= fp.seed.charCodeAt(i);
          seedHash = Math.imul(seedHash, 16777619);
        }
        const noiseDelta = ((seedHash >>> 0) % 5) - 2 || 1;
        const noiseOffset = (((seedHash >>> 8) % 9) + 1) * 1e-7;

        const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function (
          sx: number,
          sy: number,
          sw: number,
          sh: number
        ) {
          const img = origGetImageData.call(this, sx, sy, sw, sh);
          if (img.data.length >= 4) {
            img.data[0] = Math.max(0, Math.min(255, img.data[0] + noiseDelta));
          }
          return img;
        };

        const origToDataUrl = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (type?: string, quality?: number) {
          try {
            const flagObj = this as unknown as { __pgNoised?: boolean };
            if (!flagObj.__pgNoised) {
              const ctx = this.getContext('2d');
              if (ctx && this.width > 0 && this.height > 0) {
                const px = origGetImageData.call(ctx, 0, 0, 1, 1);
                px.data[0] = Math.max(0, Math.min(255, px.data[0] + noiseDelta));
                ctx.putImageData(px, 0, 0);
                flagObj.__pgNoised = true;
              }
            }
          } catch {
            // Ignore WebGL or tainted canvases
          }
          return origToDataUrl.call(this, type, quality);
        };

        if (typeof AudioBuffer !== 'undefined') {
          const origGetChannelData = AudioBuffer.prototype.getChannelData;
          AudioBuffer.prototype.getChannelData = function (channel: number) {
            const data = origGetChannelData.call(this, channel);
            if (data && data.length > 0) {
              data[0] = data[0] + noiseOffset;
            }
            return data;
          };
        }
      } catch {
        // Ignore read-only environments
      }
    }, device.fingerprint);

    const applyCdpStealthHeaders = async (targetPage: Page) => {
      try {
        const cdp = await context!.newCDPSession(targetPage);
        const fp = device.fingerprint;
        const isNonChromium =
          /Firefox|iPhone|iPad|iPod/i.test(fp.userAgent) ||
          fp.os.includes('iOS') ||
          (/Version\/[\d.]+.*Safari/i.test(fp.userAgent) && !/Chrome\//i.test(fp.userAgent));
        const isEdge = /Edg\//i.test(fp.userAgent);
        const isMob = Boolean(fp.maxTouchPoints > 0 || /Android|iPhone|iPad/i.test(fp.userAgent));
        const chPlatform = fp.os.includes('Android')
          ? 'Android'
          : fp.os.includes('macOS')
            ? 'macOS'
            : fp.os.includes('iOS')
              ? 'iOS'
              : fp.os.includes('Linux')
                ? 'Linux'
                : 'Windows';
        const acceptLang = fp.languages
          .map((l, idx) => (idx === 0 ? l : `${l};q=${Math.max(0.5, 0.9 - idx * 0.1).toFixed(1)}`))
          .join(',');

        await cdp.send('Network.setUserAgentOverride', {
          userAgent: fp.userAgent,
          acceptLanguage: acceptLang || 'en-US,en;q=0.9',
          platform: fp.platform,
          ...(!isNonChromium
            ? {
                userAgentMetadata: {
                  brands: isEdge
                    ? [
                        { brand: 'Microsoft Edge', version: '131' },
                        { brand: 'Chromium', version: '131' },
                        { brand: 'Not_A Brand', version: '24' },
                      ]
                    : [
                        { brand: 'Google Chrome', version: '131' },
                        { brand: 'Chromium', version: '131' },
                        { brand: 'Not_A Brand', version: '24' },
                      ],
                  fullVersionList: isEdge
                    ? [
                        { brand: 'Microsoft Edge', version: '131.0.2903.86' },
                        { brand: 'Chromium', version: '131.0.6778.109' },
                        { brand: 'Not_A Brand', version: '24.0.0.0' },
                      ]
                    : [
                        { brand: 'Google Chrome', version: '131.0.6778.109' },
                        { brand: 'Chromium', version: '131.0.6778.109' },
                        { brand: 'Not_A Brand', version: '24.0.0.0' },
                      ],
                  platform: chPlatform,
                  platformVersion: chPlatform === 'Windows' ? '15.0.0' : '14.0.0',
                  architecture: isMob ? 'arm' : 'x86',
                  model: isMob ? 'Pixel 8' : '',
                  mobile: isMob,
                  bitness: '64',
                },
              }
            : {}),
        });
      } catch {
        // Ignore if CDP session unsupported
      }
    };

    const mainPage = await context.newPage();
    mainPage.setDefaultTimeout(30000);
    mainPage.setDefaultNavigationTimeout(45000);
    await applyCdpStealthHeaders(mainPage);
    context.on('page', (newPg) => {
      void applyCdpStealthHeaders(newPg);
    });
    if (isHeaded) {
      await mainPage.bringToFront().catch(() => {});
    }

    let activePage = mainPage;
    const cursorPos = {
      x: Math.round(device.fingerprint.viewportWidth * randBetween(0.3, 0.7)),
      y: Math.round(device.fingerprint.viewportHeight * randBetween(0.25, 0.6)),
    };

    appendStep(
      runningState,
      'navigate',
      `Opening in Real Browser${isHeaded ? ' (Live Window)' : ''}: ${config.targetUrl}`,
      `${humanLike ? 'Human Stealth Active · ' : ''}${device.userAgent.raw.slice(0, 64)}`
    );

    const navStart = Date.now();
    const response = await safeNavigate(activePage, config.targetUrl, {
      timeoutMs: 45000,
      onSlowNotice: (msg) => appendStep(runningState, 'navigate', msg),
    });
    await humanPause(300, 550);

    if (shouldAbort()) return { clickedCount, formSubmitted };

    const latencyMs = Date.now() - navStart;
    const finalUrl = activePage.url();
    const title = (await activePage.title().catch(() => '')) || new URL(finalUrl).hostname;
    const httpStatus = response?.status() ?? 200;

    const preferSignup =
      config.clickMode === 'human_journey' ||
      config.clickMode === 'survey_and_email' ||
      config.clickMode === 'click_and_signup' ||
      config.clickMode === 'sign_up_form' ||
      Boolean(config.signUpConfig?.enabled);

    let realTargets = await discoverRealClickTargets(
      activePage,
      config.clickMode === 'selector' ? config.clickSelector : '',
      preferSignup
    );
    if (realTargets.length === 0 && !(await hasVisibleFormOrSurvey(activePage))) {
      for (let w = 0; w < 3 && realTargets.length === 0 && !shouldAbort(); w++) {
        await humanPause(650, 1000);
        await activePage.waitForLoadState('domcontentloaded', { timeout: 2500 }).catch(() => {});
        realTargets = await discoverRealClickTargets(
          activePage,
          config.clickMode === 'selector' ? config.clickSelector : '',
          preferSignup
        );
        if (realTargets.length > 0 || (await hasVisibleFormOrSurvey(activePage))) break;
      }
    }
    const links: DiscoveredLink[] = realTargets.map((t) => ({
      text: t.text,
      href: t.href,
      tag: t.tag,
      selector: t.selector,
      clicked: false,
    }));

    runningState.engineUsed = 'real_browser';
    runningState.currentUrl = activePage.url() || finalUrl;
    runningState.pageTitle = (await activePage.title().catch(() => '')) || title;
    runningState.httpStatus = httpStatus;
    runningState.latencyMs = latencyMs;
    runningState.discoveredLinks = links;
    runningState.screenshotDataUrl = await captureScreenshotDataUrl(activePage);
    runningState.cookiesCapturedCount = await syncCookiesFromContext(
      context,
      device,
      config.saveCookies
    );

    device.session.lastActiveOrigin = new URL(runningState.currentUrl).origin;
    device.session.history.unshift({
      id: uid('hist'),
      url: runningState.currentUrl,
      title: runningState.pageTitle,
      status: httpStatus,
      latencyMs,
      action: 'Browser Visit',
      timestamp: new Date().toISOString(),
    });

    appendStep(
      runningState,
      'dom_parse',
      `Rendered "${runningState.pageTitle}" (HTTP ${httpStatus} in ${latencyMs}ms)`,
      `${realTargets.length} real clickable element(s) found (frames included)`
    );

    // Dismiss blocking cookie/GDPR overlays cleanly so clicks reach actual CTAs
    await dismissBlockingOverlays(activePage);

    // Execute immediately after quick visual scroll (0.5s–1s) while keeping full min–max stay after click/survey
    const sessionStartAt = Date.now();
    if (humanLike) {
      await humanWiggleMouse(activePage, cursorPos);
    }
    await humanScrollPage(activePage, Math.min(config.scrollDepthPct || 55, 55), false);
    const fullStayMs = pickHumanStayMs(config);
    if (config.clickMode === 'scroll_only') {
      appendStep(
        runningState,
        'dom_parse',
        `Human reading stay for ${Math.round(fullStayMs / 1000)}s (Visit Only)`,
        `Target stay ${config.minDwellSec ?? 30}s – ${config.maxDwellSec ?? 120}s`
      );
      await humanActiveStay(
        activePage,
        fullStayMs,
        cursorPos,
        humanLike,
        shouldAbort,
        (elapsed, total, snap) => {
          if (snap) runningState.screenshotDataUrl = snap;
          runningState.activePhase = `Reading page (${elapsed}s / ${total}s)…`;
          runningState.updatedAt = new Date().toISOString();
          onStateSync?.(runningState);
        }
      );
    } else {
      await humanPause(350, 700);
    }
    if (shouldAbort()) return { clickedCount, formSubmitted };

    // Execute random human multi-step clicking + multi-step survey/email completion
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

    const deviceIdentity = buildSignUpIdentity(device, config.signUpConfig, deviceIndex);

    let preSurveySteps = 0;
    // If the landing page ALREADY displays a survey or email sign-up form, complete it FIRST before clicking unrelated links away
    if (!shouldAbort() && shouldRunSignUp && (await hasVisibleFormOrSurvey(activePage))) {
      appendStep(
        runningState,
        'signup_form',
        `Detected survey/email form on page — auto-completing (${deviceIdentity.email})`,
        activePage.url()
      );
      const multiRes = await runMultiStepSurveyAndSignUp({
        page: activePage,
        context,
        device,
        config,
        identity: deviceIdentity,
        runningState,
        humanLike,
        cursor: cursorPos,
        shouldAbort,
        appendStep,
        onStateSync,
        onClickExecuted: () => {
          clickedCount++;
          onClickExecuted();
        },
      });
      preSurveySteps = multiRes.stepsSubmitted;
      if (multiRes.stepsSubmitted > 0) {
        formSubmitted = true;
      }
      if (multiRes.emailSubmitted) {
        emailSubmitted = true;
      }
    }

    const skipExtraLinksAfterSurvey =
      config.clickMode === 'survey_and_email' && emailSubmitted && preSurveySteps >= 2;

    if (shouldClickLinks && !skipExtraLinksAfterSurvey && clickedCount < (Boolean(config.unlimitedClicks) || config.maxClicksPerDevice <= 0 ? Number.POSITIVE_INFINITY : Math.max(config.maxClicksPerDevice || 2, 1))) {
      const isUnlimited =
        Boolean(config.unlimitedClicks) || config.maxClicksPerDevice <= 0;
      const clickQuota = isUnlimited
        ? Number.POSITIVE_INFINITY
        : Math.max(config.maxClicksPerDevice || 2, 1);

      const visitedTargetKeys = new Set<string>();
      let currentTargets: RealDomTarget[] = [];
      let lastRevisitClickCount = -1;
      let failedClickAttempts = 0;

      while (clickedCount < clickQuota && !shouldAbort()) {
        // Always refresh targets live right before picking so dynamic DOM changes during 30s-120s dwell never cause stale selectors
        const fresh = await discoverRealClickTargets(
          activePage,
          config.clickMode === 'selector' ? config.clickSelector : '',
          preferSignup,
          visitedTargetKeys
        );
        if (fresh.length > 0) {
          currentTargets = fresh;
        }
        let target = pickRandomTarget(currentTargets, visitedTargetKeys);

        // If current page/chain is exhausted AND quota still remains, revisit targetUrl once per cycle
        if (!target && clickedCount < clickQuota && lastRevisitClickCount !== clickedCount) {
          lastRevisitClickCount = clickedCount;
          if (activePage !== mainPage) {
            await activePage.close().catch(() => {});
            activePage = mainPage;
            if (isHeaded) await activePage.bringToFront().catch(() => {});
          }
          visitedTargetKeys.clear();
          await safeNavigate(activePage, config.targetUrl, { timeoutMs: 35000 }).catch(() => {});
          await activePage.waitForLoadState('networkidle', { timeout: 4500 }).catch(() => {});
          await humanScrollPage(activePage, Math.round(randBetween(35, 75)), humanLike);
          if (shouldAbort()) break;
          currentTargets = await discoverRealClickTargets(
            activePage,
            config.clickMode === 'selector' ? config.clickSelector : '',
            preferSignup
          );
          target = pickRandomTarget(currentTargets, visitedTargetKeys);
        }

        if (!target) {
          if (clickedCount === 0) {
            appendStep(
              runningState,
              'auto_click',
              'No clickable links/buttons detected on page (visit & scroll completed)',
              activePage.url()
            );
          }
          break;
        }

        visitedTargetKeys.add(target.targetKey);

        runningState.clickTargetText = target.text;
        runningState.clickCoordinates = { xPct: target.xPct, yPct: target.yPct };
        onStateSync?.(runningState);

        appendStep(
          runningState,
          'auto_click',
          `Random Human Click "${target.text}" (${isUnlimited ? `#${clickedCount + 1} · Unlimited` : `${clickedCount + 1}/${clickQuota}`})`,
          `${target.tag} · ${target.href}`
        );

        try {
          const clickStart = Date.now();
          const urlBeforeClick = activePage.url();
          const domBefore = await activePage
            .evaluate(() => {
              const txt = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
              const ctrl = document.querySelectorAll('input, select, textarea, button, a, [role="button"]').length;
              return { len: txt.length, head: txt.slice(0, 180), ctrl };
            })
            .catch(() => ({ len: 0, head: '', ctrl: 0 }));
          const targetFrame = activePage.frames()[target.frameIndex] ?? activePage.mainFrame();

          const popupHolder: { page: Page | null } = { page: null };
          const onPopupCapture = (p: Page) => {
            if (!popupHolder.page) popupHolder.page = p;
          };
          context.on('page', onPopupCapture);

          try {
            await humanMoveAndClick(
              activePage,
              targetFrame,
              target.selector,
              cursorPos,
              humanLike,
              device.userAgent.mobile
            );

            await humanPause(450, 750);
            if (!popupHolder.page) {
              await activePage.waitForLoadState('domcontentloaded', { timeout: 6500 }).catch(() => {});
              await humanPause(350, 550);
            }

            if (!popupHolder.page) {
              const domAfterFirst = await activePage
                .evaluate(() => {
                  const txt = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
                  const ctrl = document.querySelectorAll('input, select, textarea, button, a, [role="button"]').length;
                  return { len: txt.length, head: txt.slice(0, 180), ctrl };
                })
                .catch(() => domBefore);

              const pageReacted =
                activePage.url() !== urlBeforeClick ||
                domAfterFirst.len !== domBefore.len ||
                domAfterFirst.head !== domBefore.head ||
                domAfterFirst.ctrl !== domBefore.ctrl;

              // If a button/div/SPA step didn't react to mouse click, force-click & dispatch DOM click
              if (!pageReacted) {
                await targetFrame
                  .locator(target.selector)
                  .first()
                  .click({ force: true, timeout: 3000 })
                  .catch(() => {});
                await humanPause(550, 850);

                if (!popupHolder.page) {
                  const domAfterSecond = await activePage
                    .evaluate(() => {
                      const txt = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
                      const ctrl = document.querySelectorAll('input, select, textarea, button, a, [role="button"]').length;
                      return { len: txt.length, head: txt.slice(0, 180), ctrl };
                    })
                    .catch(() => domBefore);

                  const reactedSecond =
                    activePage.url() !== urlBeforeClick ||
                    domAfterSecond.len !== domBefore.len ||
                    domAfterSecond.head !== domBefore.head ||
                    domAfterSecond.ctrl !== domBefore.ctrl;

                  if (!reactedSecond) {
                    await targetFrame
                      .locator(target.selector)
                      .first()
                      .evaluate((el) => {
                        const htmlEl = el as HTMLElement;
                        htmlEl.focus?.();
                        htmlEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                        htmlEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
                        htmlEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                        htmlEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                        htmlEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        htmlEl.click();
                      })
                      .catch(() => {});
                    await humanPause(450, 750);
                    await activePage.waitForLoadState('domcontentloaded', { timeout: 5500 }).catch(() => {});

                    if (
                      !popupHolder.page &&
                      activePage.url() === urlBeforeClick &&
                      /^https?:\/\//i.test(target.href) &&
                      target.href !== urlBeforeClick
                    ) {
                      await safeNavigate(activePage, target.href, { timeoutMs: 22000 }).catch(() => {});
                    }
                  }
                }
              }
            }
          } finally {
            context.off('page', onPopupCapture);
          }

          const popupPage = popupHolder.page;
          if (popupPage) {
            openPopups.push(popupPage);
            popupPage.setDefaultTimeout(30000);
            popupPage.setDefaultNavigationTimeout(45000);
            if (isHeaded) {
              await popupPage.bringToFront().catch(() => {});
            }
            await popupPage.waitForLoadState('domcontentloaded', { timeout: 18000 }).catch(() => {});
            await popupPage.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
            await humanPause(400, 750);

            if (followNewPages) {
              activePage = popupPage;
              appendStep(
                runningState,
                'navigate',
                `Followed new tab to: ${activePage.url()}`,
                'Scanning newly opened page for surveys / CTAs / Sign Up form'
              );
            } else {
              await humanPause(900, 1500);
            }
          }

          const afterUrl = activePage.url();
          const afterTitle = (await activePage.title().catch(() => '')) || afterUrl;

          const matchedLink = links.find((l) => l.text === target?.text || l.href === target?.href);
          if (matchedLink) matchedLink.clicked = true;

          clickedCount++;
          onClickExecuted();

          runningState.clickTargetText = null;
          runningState.clickCoordinates = null;
          runningState.clickedUrls.push(afterUrl);
          if (runningState.clickedUrls.length > 100) {
            runningState.clickedUrls = runningState.clickedUrls.slice(-100);
          }
          runningState.currentUrl = afterUrl;
          runningState.pageTitle = afterTitle;
          runningState.latencyMs = Date.now() - clickStart;
          runningState.screenshotDataUrl =
            (await captureScreenshotDataUrl(activePage)) || runningState.screenshotDataUrl;
          runningState.cookiesCapturedCount = await syncCookiesFromContext(
            context,
            device,
            config.saveCookies
          );
          onStateSync?.(runningState);

          device.session.history.unshift({
            id: uid('hist'),
            url: afterUrl,
            title: afterTitle,
            status: runningState.httpStatus,
            latencyMs: runningState.latencyMs,
            action: `Human Click: ${target.text.slice(0, 32)}`,
            timestamp: new Date().toISOString(),
          });
          if (device.session.history.length > 40) {
            device.session.history = device.session.history.slice(0, 40);
          }

          await dismissBlockingOverlays(activePage);
          if (humanLike && !shouldAbort()) {
            await humanScrollPage(activePage, Math.round(randBetween(20, 48)), false);
          }

          // If a Survey or Sign Up / Email form appeared on this newly opened page, complete multi-step survey & submit right away!
          if (!shouldAbort() && shouldRunSignUp && !formSubmitted && (await hasVisibleFormOrSurvey(activePage))) {
            await humanPause(450, 900);
            const multiRes = await runMultiStepSurveyAndSignUp({
              page: activePage,
              context,
              device,
              config,
              identity: deviceIdentity,
              runningState,
              humanLike,
              cursor: cursorPos,
              shouldAbort,
              appendStep,
              onStateSync,
              onClickExecuted: () => {
                clickedCount++;
                onClickExecuted();
              },
            });
            if (multiRes.stepsSubmitted > 0) {
              formSubmitted = true;
            }
            if (multiRes.emailSubmitted) {
              emailSubmitted = true;
            }
          }

          // Brief natural transition pause between funnel clicks (full Min–Max Stay completes at end so steps never stall)
          if (!shouldAbort() && clickedCount < clickQuota && !(emailSubmitted && config.clickMode === 'survey_and_email')) {
            await humanPause(950, 2100);
          }

          // Re-discover what appeared on the active page (supports new pages, redirects, and in-page modals)
          const nextTargets = await discoverRealClickTargets(
            activePage,
            config.clickMode === 'selector' ? config.clickSelector : '',
            preferSignup,
            visitedTargetKeys
          );
          currentTargets = nextTargets;
          runningState.discoveredLinks = nextTargets.map((t) => ({
            text: t.text,
            href: t.href,
            tag: t.tag,
            selector: t.selector,
            clicked: false,
          }));

          if (emailSubmitted && config.clickMode === 'survey_and_email') {
            break;
          }

          // If popup was NOT followed (followNewPages false), close it cleanly after registering
          if (popupPage && !followNewPages) {
            await popupPage.close().catch(() => {});
            if (isHeaded) await activePage.bringToFront().catch(() => {});
          }
        } catch (clickErr) {
          failedClickAttempts++;
          appendStep(
            runningState,
            'error',
            `Click skipped on "${target.text}"`,
            clickErr instanceof Error ? clickErr.message : 'Element detached'
          );
          if (failedClickAttempts >= Math.max(currentTargets.length, 3) && clickedCount === 0) {
            break;
          }
        }
      }
    }

    // Final Multi-Step Survey & Sign Up check if not yet submitted
    if (!shouldAbort() && shouldRunSignUp && !formSubmitted) {
      appendStep(
        runningState,
        'signup_form',
        `Scanning active page for Survey / Email Sign Up form (${deviceIdentity.email})`,
        activePage.url()
      );

      const finalRes = await runMultiStepSurveyAndSignUp({
        page: activePage,
        context,
        device,
        config,
        identity: deviceIdentity,
        runningState,
        humanLike,
        cursor: cursorPos,
        shouldAbort,
        appendStep,
        onStateSync,
        onClickExecuted: () => {
          clickedCount++;
          onClickExecuted();
        },
      });

      if (finalRes.stepsSubmitted > 0) {
        formSubmitted = true;
      }
      if (finalRes.emailSubmitted) {
        emailSubmitted = true;
      } else if (finalRes.totalFilled === 0) {
        appendStep(
          runningState,
          'signup_form',
          'No visible survey or email form inputs detected on current page',
          'Tip: Enable Survey + Email Submit or Human Auto-Browse so clicks reach the survey/sign-up page first'
        );
      }
    }

    // Ensure total human dwell meets at least the user's randomized min–max stay target before closing
    const minTargetStayMs = pickHumanStayMs(config);
    const elapsedTotalMs = Date.now() - sessionStartAt;
    if (!shouldAbort() && elapsedTotalMs < minTargetStayMs) {
      const remainingStayMs = minTargetStayMs - elapsedTotalMs;
      appendStep(
        runningState,
        'dom_parse',
        `Human dwell remaining ${Math.round(remainingStayMs / 1000)}s on final page`,
        activePage.url()
      );
      await humanActiveStay(
        activePage,
        remainingStayMs,
        cursorPos,
        humanLike,
        shouldAbort,
        (elapsed, total, snap) => {
          if (snap) runningState.screenshotDataUrl = snap;
          runningState.activePhase = `Staying naturally on final page (${elapsed}s / ${total}s)…`;
          runningState.updatedAt = new Date().toISOString();
          onStateSync?.(runningState);
        }
      );
    }

    // Wait briefly for any async analytics beacons / tracking pixels fired on the final action before closing context
    if (!shouldAbort()) {
      await activePage.waitForLoadState('networkidle', { timeout: 3500 }).catch(() => {});
      await humanPause(1400, 2200).catch(() => {});
    }

    return { clickedCount, formSubmitted };
  } finally {
    for (const p of openPopups) {
      await p.close().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (proxyBridge) {
      await proxyBridge.close().catch(() => {});
    }
  }
}
