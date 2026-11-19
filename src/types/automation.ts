export type DeviceType = 'Desktop' | 'Mobile' | 'Tablet';
export type ProxyProtocol = 'http' | 'https' | 'socks4' | 'socks5' | 'direct';
export type ProxyStatus = 'unchecked' | 'checking' | 'online' | 'offline';
export type DeviceStatus = 'ready' | 'running' | 'completed' | 'error' | 'off';
export type ClickMode =
  | 'human_journey'
  | 'survey_and_email'
  | 'auto_cta'
  | 'click_and_signup'
  | 'sign_up_form'
  | 'selector'
  | 'all_links'
  | 'scroll_only';
export type ExecutionEngine = 'auto' | 'real_browser' | 'http_fast';
export type WebRTCMode = 'altered' | 'disabled' | 'real';
export type EmailSourceMode = 'auto_gmail' | 'gmail_pool' | 'custom';

export interface SignUpFormConfig {
  enabled?: boolean;
  mode: 'auto' | 'custom';
  emailSource?: EmailSourceMode;
  gmailPool?: string;
  preferGmail?: boolean;
  fullName: string;
  email: string;
  username: string;
  password: string;
  phone: string;
  submitSelector: string;
  customFields: string;
}

export interface UserAgentEntry {
  id: string;
  raw: string;
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  deviceType: DeviceType;
  platform: string;
  mobile: boolean;
  label: string;
  addedAt: string;
}

export interface ProxyEntry {
  id: string;
  raw: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
  status: ProxyStatus;
  latencyMs: number | null;
  exitIp: string | null;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  timezone: string | null;
  language: string | null;
  lat: number | null;
  lon: number | null;
  error: string | null;
  checkedAt: string | null;
}

export interface FingerprintProfile {
  seed: string;
  userAgent: string;
  platform: string;
  vendor: string;
  os: string;
  deviceType: DeviceType;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  colorDepth: number;
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints: number;
  languages: string[];
  timezone: string;
  geolocation: {
    lat: number;
    lon: number;
    accuracy: number;
  };
  webglVendor: string;
  webglRenderer: string;
  canvasHash: string;
  audioHash: string;
  macAddress?: string;
  webRTCMode: WebRTCMode;
  doNotTrack: string | null;
  clientHints: {
    secChUa: string;
    secChUaMobile: string;
    secChUaPlatform: string;
  };
  consistencyNotes: string[];
}

export interface CookieEntry {
  id: string;
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
  expires: string;
}

export interface StorageEntry {
  key: string;
  value: string;
  origin: string;
}

export interface SessionHistoryItem {
  id: string;
  url: string;
  title: string;
  status: number | null;
  latencyMs: number;
  action: string;
  timestamp: string;
}

export interface DeviceSession {
  cookies: CookieEntry[];
  localStorage: StorageEntry[];
  sessionStorage: StorageEntry[];
  history: SessionHistoryItem[];
  lastActiveOrigin: string | null;
}

export interface DeviceProfile {
  id: string;
  name: string;
  status: DeviceStatus;
  userAgentId: string;
  userAgent: UserAgentEntry;
  proxyId: string | null;
  proxy: ProxyEntry | null;
  fingerprint: FingerprintProfile;
  session: DeviceSession;
  createdAt: string;
  lastRunAt: string | null;
  totalRuns: number;
  totalClicks: number;
}

export interface DiscoveredLink {
  text: string;
  href: string;
  tag: string;
  selector: string;
  clicked: boolean;
}

export interface ProfileStepLog {
  id: string;
  timestamp: string;
  phase:
    | 'proxy_connect'
    | 'fingerprint_bind'
    | 'navigate'
    | 'dom_parse'
    | 'auto_click'
    | 'signup_form'
    | 'session_save'
    | 'auto_clean'
    | 'done'
    | 'error';
  message: string;
  detail?: string;
}

export interface RunningProfileState {
  deviceId: string;
  deviceName: string;
  runId: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  activePhase: string;
  currentUrl: string;
  pageTitle: string;
  httpStatus: number | null;
  latencyMs: number | null;
  proxyLabel: string;
  proxyLocation: string;
  userAgentLabel: string;
  viewportWidth: number;
  viewportHeight: number;
  clickTargetText: string | null;
  clickCoordinates: { xPct: number; yPct: number } | null;
  discoveredLinks: DiscoveredLink[];
  clickedUrls: string[];
  cookiesCapturedCount: number;
  previewHtml: string;
  screenshotDataUrl?: string | null;
  engineUsed?: 'real_browser' | 'http';
  formSubmitted?: boolean;
  steps: ProfileStepLog[];
  startedAt: string;
  updatedAt: string;
  error: string | null;
}

export interface AutomationConfig {
  targetUrl: string;
  clickMode: ClickMode;
  clickSelector: string;
  maxClicksPerDevice: number;
  unlimitedClicks?: boolean;
  dwellTimeMs: number;
  minDwellSec?: number;
  maxDwellSec?: number;
  scrollDepthPct: number;
  concurrency: number;
  staggerDelayMs: number;
  followRedirects: boolean;
  saveCookies: boolean;
  autoCleanAfterRun?: boolean;
  autoCleanRunHistory?: boolean;
  disableDeviceOnComplete?: boolean;
  rotateMacOnStart?: boolean;
  executionEngine?: ExecutionEngine;
  headedBrowser?: boolean;
  customBrowserPath?: string;
  humanLike?: boolean;
  followNewPages?: boolean;
  proxyFailover?: boolean;
  signUpConfig?: SignUpFormConfig;
  deviceIds: string[];
}

export interface AutomationRunSummary {
  id: string;
  targetUrl: string;
  clickMode: ClickMode;
  deviceCount: number;
  completedCount: number;
  errorCount: number;
  totalClicksExecuted: number;
  status: 'running' | 'completed' | 'stopped';
  macChangeSummary?: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface WorkspaceState {
  userAgents: UserAgentEntry[];
  proxies: ProxyEntry[];
  devices: DeviceProfile[];
  runs: AutomationRunSummary[];
  runningProfiles: Record<string, RunningProfileState>;
  activeRunId: string | null;
}
