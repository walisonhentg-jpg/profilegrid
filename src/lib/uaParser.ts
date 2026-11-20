import type { DeviceType, UserAgentEntry } from '../types/automation.ts';

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function stripUaWrapper(line: string): string {
  let s = line.trim();
  // Strip trailing comma/semicolon left over from JSON/CSV/lists
  s = s.replace(/[,;]+$/, '').trim();
  // Strip surrounding matching quotes
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  // Strip leading list markers like "1. ", "1) ", "- ", "* ", "#1 "
  s = s.replace(/^(?:#?\d+[.):\-]\s*|[-*•]\s+)/, '').trim();
  // Strip optional label prefix before Mozilla/ or Dalvik/ (e.g. "FB iOS: Mozilla/5.0...")
  const uaStart = s.search(/(?:Mozilla|Dalvik)\/\d/i);
  if (uaStart > 0 && uaStart < 45) {
    const prefix = s.slice(0, uaStart).trim();
    if (/^[a-z0-9\s._/\-|()[\]:]+$/i.test(prefix)) {
      s = s.slice(uaStart).trim();
    }
  }
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

export function extractUserAgentLines(rawInput: string): string[] {
  const trimmed = rawInput.trim();
  if (!trimmed) return [];

  // 1. Handle JSON arrays/objects pasted directly
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const extracted: string[] = [];
      for (const item of items) {
        const val =
          typeof item === 'string'
            ? item
            : item && typeof item === 'object'
              ? ((item as Record<string, unknown>).userAgent ??
                  (item as Record<string, unknown>).ua ??
                  (item as Record<string, unknown>).user_agent ??
                  (item as Record<string, unknown>).raw)
              : null;
        if (typeof val === 'string' && val.trim().length >= 8) {
          extracted.push(stripUaWrapper(val));
        }
      }
      if (extracted.length > 0) return extracted.filter(Boolean);
    } catch {
      // Fallback to line/token extraction below
    }
  }

  // 2. Split by newlines, pipes, tabs, or concatenated Mozilla/Dalvik tokens on the same line
  const results: string[] = [];
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Skip pure comments unless they actually contain a UA string
    if (
      (line.startsWith('#') || line.startsWith('//')) &&
      !/(?:Mozilla|Dalvik)\/\d|FBAN\/|FBAV\/|Instagram\s+\d|youtube/i.test(line)
    ) {
      continue;
    }

    // Split on pipes or tabs between entries, then split before any mid-line Mozilla/N or Dalvik/N
    const primaryParts = line.split(/\s*\|\s*|\t+/);
    for (const part of primaryParts) {
      const normalized = part
        .replace(/["']?\s*,\s*["']?(?=(?:Mozilla|Dalvik)\/\d)/gi, '\n')
        .replace(/\s+(?=(?:Mozilla|Dalvik)\/\d)/gi, '\n');

      for (const piece of normalized.split('\n')) {
        const cleaned = stripUaWrapper(piece);
        if (cleaned.length >= 8) {
          results.push(cleaned);
        }
      }
    }
  }

  return results;
}

export function parseUserAgent(rawInput: string, idOverride?: string): UserAgentEntry {
  const raw = rawInput.trim();
  const ua = raw;

  let browser = 'Chrome';
  let browserVersion = '131.0';
  if (/Instagram[\s/]+([\d.]+)/i.test(ua)) {
    browser = 'Instagram App';
    browserVersion = ua.match(/Instagram[\s/]+([\d.]+)/i)?.[1] ?? '358.0';
  } else if (/FBAV\/([\d.]+)|FBAN\/|FB_IAB\/|FB4A|FBIOS/i.test(ua)) {
    browser = 'Facebook App';
    browserVersion = ua.match(/FBAV\/([\d.]+)/i)?.[1] ?? '490.0';
  } else if (/com\.google\.(?:android|ios)\.youtube\/([\d.]+)|YouTube[\s/]+([\d.]+)/i.test(ua)) {
    browser = 'YouTube App';
    const ym = ua.match(/(?:com\.google\.(?:android|ios)\.youtube|YouTube)[\s/]+([\d.]+)/i);
    browserVersion = ym?.[1] ?? '19.45';
  } else if (/EdgA?\/([\d.]+)/.test(ua)) {
    browser = 'Edge';
    browserVersion = ua.match(/EdgA?\/([\d.]+)/)?.[1] ?? '131.0';
  } else if (/OPR\/([\d.]+)/.test(ua)) {
    browser = 'Opera';
    browserVersion = ua.match(/OPR\/([\d.]+)/)?.[1] ?? '114.0';
  } else if (/Firefox\/([\d.]+)/.test(ua)) {
    browser = 'Firefox';
    browserVersion = ua.match(/Firefox\/([\d.]+)/)?.[1] ?? '132.0';
  } else if (/CriOS\/([\d.]+)/.test(ua)) {
    browser = 'Chrome iOS';
    browserVersion = ua.match(/CriOS\/([\d.]+)/)?.[1] ?? '131.0';
  } else if (/Chrome\/([\d.]+)/.test(ua)) {
    browser = 'Chrome';
    browserVersion = ua.match(/Chrome\/([\d.]+)/)?.[1] ?? '131.0';
  } else if (/Version\/([\d.]+).*Safari/.test(ua)) {
    browser = 'Safari';
    browserVersion = ua.match(/Version\/([\d.]+)/)?.[1] ?? '18.0';
  }

  let os = 'Windows';
  let osVersion = '10/11';
  let platform = 'Win32';
  let deviceType: DeviceType = 'Desktop';
  let mobile = false;

  if (/iPhone/.test(ua)) {
    os = 'iOS';
    osVersion = ua.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') ?? '18.1';
    platform = 'iPhone';
    deviceType = 'Mobile';
    mobile = true;
  } else if (/iPad/.test(ua)) {
    os = 'iPadOS';
    osVersion = ua.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') ?? '18.1';
    platform = 'iPad';
    deviceType = 'Tablet';
    mobile = false;
  } else if (/Android/.test(ua)) {
    os = 'Android';
    osVersion = ua.match(/Android ([\d.]+)/)?.[1] ?? '14';
    platform = 'Linux armv81';
    mobile = /Mobile|FB4A|FB_IAB|FBAV|FBAN|Instagram|youtube/i.test(ua) && !/Tablet/i.test(ua);
    deviceType = mobile ? 'Mobile' : 'Tablet';
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    os = 'macOS';
    osVersion = ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.') ?? '14.6';
    platform = 'MacIntel';
    deviceType = 'Desktop';
    mobile = false;
  } else if (/Windows NT ([\d.]+)/.test(ua)) {
    os = 'Windows';
    const nt = ua.match(/Windows NT ([\d.]+)/)?.[1] ?? '10.0';
    osVersion = nt === '10.0' ? '10/11' : nt;
    platform = 'Win32';
    deviceType = 'Desktop';
    mobile = false;
  } else if (/Linux/.test(ua)) {
    os = 'Linux';
    osVersion = 'x86_64';
    platform = 'Linux x86_64';
    deviceType = 'Desktop';
    mobile = false;
  }

  const major = browserVersion.split('.')[0] || '131';
  const label = `${browser} ${major} · ${os} ${osVersion}`;

  return {
    id: idOverride ?? makeId('ua'),
    raw,
    browser,
    browserVersion,
    os,
    osVersion,
    deviceType,
    platform,
    mobile,
    label,
    addedAt: new Date().toISOString(),
  };
}

export const PRESET_USER_AGENTS: string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.39 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
];

export const SOCIAL_APP_USER_AGENTS: string[] = [
  'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.100 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/490.0.0.50.109;]',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 [FBAN/FBIOS;FBAV/490.0.0.48.108;FBBV/666111222;FBDV/iPhone16,1;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.100 Mobile Safari/537.36 Instagram 358.0.0.34.96 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba; en_US; 665987654)',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 Instagram 358.0.0.28.89 (iPhone16,1; iOS 18_1; en_US; en; scale=3.00; 1179x2556; 665987654)',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.100 Mobile Safari/537.36 com.google.android.youtube/19.45.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 com.google.ios.youtube/19.45.2 (iPhone16,1; U; CPU iOS 18_1 like Mac OS X; en_US)',
];
