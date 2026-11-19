import type {
  FingerprintProfile,
  ProxyEntry,
  UserAgentEntry,
} from '../types/automation.ts';

function fnv1aHash(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function seededRandom(seedStr: string): () => number {
  let state = parseInt(fnv1aHash(seedStr), 16) || 123456789;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const COUNTRY_LANGUAGE_MAP: Record<string, string[]> = {
  US: ['en-US', 'en'],
  GB: ['en-GB', 'en'],
  UK: ['en-GB', 'en'],
  CA: ['en-CA', 'fr-CA', 'en'],
  AU: ['en-AU', 'en'],
  DE: ['de-DE', 'de', 'en-US'],
  FR: ['fr-FR', 'fr', 'en-US'],
  NL: ['nl-NL', 'nl', 'en-US'],
  SG: ['en-SG', 'zh-SG', 'en'],
  JP: ['ja-JP', 'ja', 'en-US'],
  IN: ['en-IN', 'hi-IN', 'en'],
  BD: ['bn-BD', 'en-US', 'en'],
  BR: ['pt-BR', 'pt', 'en-US'],
  ES: ['es-ES', 'es', 'en-US'],
  IT: ['it-IT', 'it', 'en-US'],
  PL: ['pl-PL', 'pl', 'en-US'],
  SE: ['sv-SE', 'sv', 'en-US'],
  NO: ['nb-NO', 'no', 'en-US'],
  MX: ['es-MX', 'es', 'en-US'],
};

const COUNTRY_DEFAULT_GEO: Record<string, { timezone: string; lat: number; lon: number }> = {
  US: { timezone: 'America/New_York', lat: 40.7128, lon: -74.006 },
  GB: { timezone: 'Europe/London', lat: 51.5074, lon: -0.1278 },
  UK: { timezone: 'Europe/London', lat: 51.5074, lon: -0.1278 },
  CA: { timezone: 'America/Toronto', lat: 43.6532, lon: -79.3832 },
  AU: { timezone: 'Australia/Sydney', lat: -33.8688, lon: 151.2093 },
  DE: { timezone: 'Europe/Berlin', lat: 52.52, lon: 13.405 },
  FR: { timezone: 'Europe/Paris', lat: 48.8566, lon: 2.3522 },
  NL: { timezone: 'Europe/Amsterdam', lat: 52.3676, lon: 4.9041 },
  SG: { timezone: 'Asia/Singapore', lat: 1.3521, lon: 103.8198 },
  JP: { timezone: 'Asia/Tokyo', lat: 35.6762, lon: 139.6503 },
  IN: { timezone: 'Asia/Kolkata', lat: 19.076, lon: 72.8777 },
  BD: { timezone: 'Asia/Dhaka', lat: 23.8103, lon: 90.4125 },
  BR: { timezone: 'America/Sao_Paulo', lat: -23.5505, lon: -46.6333 },
  ES: { timezone: 'Europe/Madrid', lat: 40.4168, lon: -3.7038 },
  IT: { timezone: 'Europe/Rome', lat: 41.9028, lon: 12.4964 },
  PL: { timezone: 'Europe/Warsaw', lat: 52.2297, lon: 21.0122 },
  SE: { timezone: 'Europe/Stockholm', lat: 59.3293, lon: 18.0686 },
  NO: { timezone: 'Europe/Oslo', lat: 59.9139, lon: 10.7522 },
  MX: { timezone: 'America/Mexico_City', lat: 19.4326, lon: -99.1332 },
};

const DESKTOP_RESOLUTIONS = [
  { w: 1920, h: 1080, dpr: 1 },
  { w: 1440, h: 900, dpr: 2 },
  { w: 1536, h: 864, dpr: 1.25 },
  { w: 2560, h: 1440, dpr: 1 },
  { w: 1366, h: 768, dpr: 1 },
  { w: 1600, h: 900, dpr: 1 },
  { w: 1680, h: 1050, dpr: 1 },
  { w: 1280, h: 720, dpr: 1 },
  { w: 1280, h: 800, dpr: 1.5 },
  { w: 1920, h: 1200, dpr: 1 },
  { w: 1728, h: 1117, dpr: 2 },
  { w: 1512, h: 982, dpr: 2 },
];

const MOBILE_RESOLUTIONS = [
  { w: 393, h: 852, dpr: 3 },
  { w: 412, h: 915, dpr: 2.625 },
  { w: 390, h: 844, dpr: 3 },
  { w: 430, h: 932, dpr: 3 },
  { w: 375, h: 812, dpr: 3 },
  { w: 360, h: 800, dpr: 2 },
  { w: 414, h: 896, dpr: 2 },
  { w: 384, h: 854, dpr: 2.75 },
];

const TABLET_RESOLUTIONS = [
  { w: 820, h: 1180, dpr: 2 },
  { w: 1024, h: 1366, dpr: 2 },
  { w: 768, h: 1024, dpr: 2 },
  { w: 834, h: 1194, dpr: 2 },
  { w: 800, h: 1280, dpr: 1.5 },
];

const WINDOWS_GPUS = [
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
];

const MAC_GPUS = [
  { vendor: 'Apple Inc.', renderer: 'Apple M1' },
  { vendor: 'Apple Inc.', renderer: 'Apple M1 Pro' },
  { vendor: 'Apple Inc.', renderer: 'Apple M2' },
  { vendor: 'Apple Inc.', renderer: 'Apple M2 Pro' },
  { vendor: 'Apple Inc.', renderer: 'Apple M3' },
  { vendor: 'Apple Inc.', renderer: 'Apple M3 Pro' },
];

const ANDROID_GPUS = [
  { vendor: 'Qualcomm', renderer: 'Adreno (TM) 740' },
  { vendor: 'Qualcomm', renderer: 'Adreno (TM) 730' },
  { vendor: 'Qualcomm', renderer: 'Adreno (TM) 660' },
  { vendor: 'Qualcomm', renderer: 'Adreno (TM) 650' },
  { vendor: 'ARM', renderer: 'Mali-G715 MC7' },
  { vendor: 'ARM', renderer: 'Mali-G78 MP14' },
];

const LINUX_GPUS = [
  { vendor: 'Intel', renderer: 'Mesa Intel(R) Iris(R) Xe Graphics (ADL GT2)' },
  { vendor: 'Intel', renderer: 'Mesa Intel(R) UHD Graphics 630 (CFL GT2)' },
  { vendor: 'AMD', renderer: 'AMD Radeon RX 6700 XT (navi22, LLVM 15.0.7, DRM 3.49)' },
  { vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce RTX 3060/PCIe/SSE2' },
];

export function generateFingerprint(
  ua: UserAgentEntry,
  proxy: ProxyEntry | null,
  customSeed?: string
): FingerprintProfile {
  const seed =
    customSeed ??
    `${fnv1aHash(ua.raw + (proxy?.id ?? proxy?.host ?? 'direct') + Date.now().toString())}-${Math.random()
      .toString(36)
      .slice(2, 8)}-${Math.random().toString(36).slice(2, 6)}`;
  const rand = seededRandom(seed);

  const resPool =
    ua.deviceType === 'Mobile'
      ? MOBILE_RESOLUTIONS
      : ua.deviceType === 'Tablet'
        ? TABLET_RESOLUTIONS
        : DESKTOP_RESOLUTIONS;
  const chosenRes = resPool[Math.floor(rand() * resPool.length)];

  let vendor = 'Google Inc.';
  if (ua.browser === 'Safari' || ua.os === 'iOS' || ua.os === 'iPadOS') {
    vendor = 'Apple Computer, Inc.';
  } else if (ua.browser === 'Firefox') {
    vendor = '';
  }

  let gpuChoice = WINDOWS_GPUS[Math.floor(rand() * WINDOWS_GPUS.length)];
  if (ua.os === 'macOS') {
    gpuChoice = MAC_GPUS[Math.floor(rand() * MAC_GPUS.length)];
  } else if (ua.os === 'iOS' || ua.os === 'iPadOS') {
    gpuChoice = { vendor: 'Apple Inc.', renderer: 'Apple GPU' };
  } else if (ua.os === 'Android') {
    gpuChoice = ANDROID_GPUS[Math.floor(rand() * ANDROID_GPUS.length)];
  } else if (ua.os === 'Linux') {
    gpuChoice = LINUX_GPUS[Math.floor(rand() * LINUX_GPUS.length)];
  }

  const webglVendor = gpuChoice.vendor;
  const webglRenderer = gpuChoice.renderer;

  const concurrencyPool = ua.deviceType === 'Mobile' ? [4, 6, 8] : [4, 6, 8, 12, 16];
  const memoryPool = ua.deviceType === 'Mobile' ? [4, 6, 8, 12] : [8, 16, 24, 32];
  const hardwareConcurrency = concurrencyPool[Math.floor(rand() * concurrencyPool.length)];
  const deviceMemory = memoryPool[Math.floor(rand() * memoryPool.length)];
  const maxTouchPoints = ua.deviceType === 'Desktop' ? 0 : 5;

  const countryCode = proxy?.countryCode?.toUpperCase() ?? 'US';
  const geoFallback = COUNTRY_DEFAULT_GEO[countryCode] ?? COUNTRY_DEFAULT_GEO.US;
  const languages = COUNTRY_LANGUAGE_MAP[countryCode] ?? (proxy?.language ? [proxy.language, 'en'] : ['en-US', 'en']);
  const timezone = proxy?.timezone || geoFallback.timezone;
  const baseLat = proxy?.lat ?? geoFallback.lat;
  const baseLon = proxy?.lon ?? geoFallback.lon;
  const geolocation = {
    lat: Number((baseLat + (rand() - 0.5) * 0.05).toFixed(4)),
    lon: Number((baseLon + (rand() - 0.5) * 0.05).toFixed(4)),
    accuracy: Math.round(15 + rand() * 45),
  };

  const chromeMatch = ua.raw.match(/Chrome\/([\d]+)/);
  const majorVer = chromeMatch?.[1] || ua.browserVersion.split('.')[0] || '131';
  const secChUa =
    ua.browser === 'Firefox' || ua.browser === 'Safari' || ua.os === 'iOS' || ua.os === 'iPadOS'
      ? ''
      : `"Chromium";v="${majorVer}", "Not_A Brand";v="24", "${ua.browser === 'Edge' ? 'Microsoft Edge' : 'Google Chrome'}";v="${majorVer}"`;

  const secChUaPlatform =
    ua.os === 'macOS'
      ? '"macOS"'
      : ua.os === 'Android'
        ? '"Android"'
        : ua.os === 'iOS' || ua.os === 'iPadOS'
          ? '"iOS"'
          : ua.os === 'Linux'
            ? '"Linux"'
            : '"Windows"';

  const canvasHash = `0x${fnv1aHash(seed + 'canvas')}${fnv1aHash(ua.raw + seed).slice(0, 6)}`;
  const audioHash = `0x${fnv1aHash(seed + 'audio')}${fnv1aHash(webglRenderer + seed).slice(0, 4)}`;
  const macAddress = generateDeviceMacAddress(seed);

  const consistencyNotes: string[] = [
    `Navigator.platform (${ua.platform}) matches ${ua.os}`,
    `WebGL renderer (${webglRenderer.split('(')[0].trim()}) aligned with ${ua.os}`,
    `Timezone (${timezone}) & locale (${languages[0]}) bound to ${proxy?.country ?? 'Default'} exit node`,
    `Touch points (${maxTouchPoints}) consistent with ${ua.deviceType} viewport (${chosenRes.w}x${chosenRes.h})`,
    `Device MAC (${macAddress}) isolated for ${ua.os} profile`,
  ];

  return {
    seed,
    userAgent: ua.raw,
    platform: ua.platform,
    vendor,
    os: ua.os,
    deviceType: ua.deviceType,
    viewportWidth: chosenRes.w,
    viewportHeight: chosenRes.h,
    devicePixelRatio: chosenRes.dpr,
    colorDepth: 24,
    hardwareConcurrency,
    deviceMemory,
    maxTouchPoints,
    languages,
    timezone,
    geolocation,
    webglVendor,
    webglRenderer,
    canvasHash,
    audioHash,
    macAddress,
    webRTCMode: 'altered',
    doNotTrack: null,
    clientHints: {
      secChUa,
      secChUaMobile: ua.mobile ? '?1' : '?0',
      secChUaPlatform,
    },
    consistencyNotes,
  };
}

export function generateDeviceMacAddress(seedSource?: string): string {
  const rand = seededRandom(
    seedSource ? `${seedSource}-mac` : `${Date.now()}-${Math.random()}`
  );
  // First octet must be unicast (bit 0 = 0) & locally administered (bit 1 = 1) for Windows NIC driver compatibility
  const b0 = ((Math.floor(rand() * 256) & 0xfc) | 0x02) >>> 0;
  const bytes = [
    b0,
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
    Math.floor(rand() * 256),
  ];
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
}
