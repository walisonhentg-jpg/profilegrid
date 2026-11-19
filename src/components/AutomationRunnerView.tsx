import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Eraser,
  Globe,
  Loader2,
  MousePointerClick,
  Network,
  Play,
  Power,
  RefreshCw,
  Square,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type {
  AutomationConfig,
  AutomationRunSummary,
  ClickMode,
  DeviceProfile,
  EmailSourceMode,
  ExecutionEngine,
  SignUpFormConfig,
} from '../types/automation.ts';

interface AutomationRunnerViewProps {
  devices: DeviceProfile[];
  userAgentsCount: number;
  onlineProxiesCount: number;
  runs: AutomationRunSummary[];
  isRunning: boolean;
  onStartRun: (config: AutomationConfig) => Promise<void>;
  onStopRun: () => Promise<void>;
  onProvisionAllDevices: () => Promise<void>;
  onToggleDeviceStatus: (deviceId: string, nextStatus: 'ready' | 'off') => Promise<void>;
  onResetDevicesStatus: () => Promise<void>;
  onDevicesUpdated: (devices: DeviceProfile[]) => void;
  onCleanWorkspace: (scope: 'sessions' | 'runs' | 'all') => Promise<void>;
  onViewRunningProfiles: () => void;
}

const DEFAULT_SIGNUP: SignUpFormConfig = {
  enabled: true,
  mode: 'auto',
  emailSource: 'auto_gmail',
  gmailPool: '',
  preferGmail: true,
  fullName: '',
  email: '',
  username: '',
  password: '',
  phone: '',
  submitSelector: '',
  customFields: '',
};

function cleanTargetUrl(raw: string): string {
  return raw.trim().replace(/^(https?:\/\/)+(https?:\/\/)/i, '$2');
}

export function AutomationRunnerView({
  devices,
  userAgentsCount,
  onlineProxiesCount,
  runs,
  isRunning,
  onStartRun,
  onStopRun,
  onProvisionAllDevices,
  onToggleDeviceStatus,
  onResetDevicesStatus,
  onDevicesUpdated,
  onCleanWorkspace,
  onViewRunningProfiles,
}: AutomationRunnerViewProps) {
  const [targetUrl, setTargetUrl] = useState('https://example.com');
  const [clickMode, setClickMode] = useState<ClickMode>('human_journey');
  const [clickSelector, setClickSelector] = useState('a, button, input[type="submit"]');
  const [maxClicksPerDevice, setMaxClicksPerDevice] = useState(3);
  const [unlimitedClicks, setUnlimitedClicks] = useState(false);
  const [minDwellSec, setMinDwellSec] = useState(30);
  const [maxDwellSec, setMaxDwellSec] = useState(120);
  const [scrollDepthPct] = useState(75);
  const [concurrency, setConcurrency] = useState(3);
  const [staggerDelayMs, setStaggerDelayMs] = useState(800);
  const [followRedirects, setFollowRedirects] = useState(true);
  const [saveCookies, setSaveCookies] = useState(true);
  const [humanLike, setHumanLike] = useState(true);
  const [followNewPages, setFollowNewPages] = useState(true);
  const [proxyFailover, setProxyFailover] = useState(true);
  const [autoCleanAfterRun, setAutoCleanAfterRun] = useState(true);
  const [autoCleanRunHistory, setAutoCleanRunHistory] = useState(false);
  const [disableDeviceOnComplete, setDisableDeviceOnComplete] = useState(true);
  const [rotateMacOnStart, setRotateMacOnStart] = useState(true);
  const [executionEngine, setExecutionEngine] = useState<ExecutionEngine>('auto');
  const [headedBrowser, setHeadedBrowser] = useState(() =>
    typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)
  );
  const [customBrowserPath, setCustomBrowserPath] = useState('');
  const [signUpConfig, setSignUpConfig] = useState<SignUpFormConfig>(DEFAULT_SIGNUP);
  const [browserStatus, setBrowserStatus] = useState<{
    available: boolean;
    name: string | null;
    platform?: string;
  } | null>(null);
  const [macStatus, setMacStatus] = useState<{
    platform: string;
    canRotateOsMac: boolean;
    isAdmin: boolean;
    adapterName: string | null;
    interfaceDescription?: string | null;
    ipv4?: string | null;
    currentMac: string | null;
    reason?: string;
  } | null>(null);
  const [rotatingMac, setRotatingMac] = useState(false);
  const [macNotice, setMacNotice] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    devices.filter((d) => d.status !== 'off').map((d) => d.id)
  );
  const [submitting, setSubmitting] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [validatingEmails, setValidatingEmails] = useState(false);
  const [emailValidationSummary, setEmailValidationSummary] = useState<{
    validCount: number;
    invalidCount: number;
    mxChecked: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getBrowserStatus(customBrowserPath)
      .then((res) =>
        setBrowserStatus({
          available: res.available,
          name: res.name,
          platform: res.platform,
        })
      )
      .catch(() => setBrowserStatus({ available: false, name: null }));
  }, [customBrowserPath]);

  useEffect(() => {
    void api
      .getMacStatus()
      .then((res) => setMacStatus(res))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setSelectedIds((prev) => {
      const activeIds = new Set(
        devices.filter((d) => d.status !== 'off').map((d) => d.id)
      );
      if (activeIds.size === 0) return [];
      const kept = prev.filter((id) => activeIds.has(id));
      return kept.length > 0 ? kept : Array.from(activeIds);
    });
  }, [devices]);

  function toggleDevice(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleBuildDevicesNow() {
    setProvisioning(true);
    setError(null);
    try {
      await onProvisionAllDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build devices');
    } finally {
      setProvisioning(false);
    }
  }

  async function handleClean(scope: 'sessions' | 'runs' | 'all') {
    setCleaning(true);
    try {
      await onCleanWorkspace(scope);
    } finally {
      setCleaning(false);
    }
  }

  async function handleValidateGmailPool() {
    const raw = signUpConfig.gmailPool || '';
    if (!raw.trim()) {
      setEmailValidationSummary({ validCount: 0, invalidCount: 0, mxChecked: false });
      return;
    }
    setValidatingEmails(true);
    setError(null);
    try {
      const res = await api.validateEmails(raw);
      setSignUpConfig((s) => ({
        ...s,
        gmailPool: res.validEmails.join('\n'),
      }));
      setEmailValidationSummary({
        validCount: res.validEmails.length,
        invalidCount: res.invalidEmails.length,
        mxChecked: res.mxChecked,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to validate Gmail list');
    } finally {
      setValidatingEmails(false);
    }
  }

  async function handleLaunch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalizedUrl = cleanTargetUrl(targetUrl);
    if (!normalizedUrl) {
      setError('Enter your target website URL.');
      return;
    }
    if (normalizedUrl !== targetUrl) {
      setTargetUrl(normalizedUrl);
    }
    if (selectedIds.length === 0 && devices.length > 0) {
      setError('Select at least one device profile.');
      return;
    }
    if (devices.length === 0 && userAgentsCount === 0 && onlineProxiesCount === 0) {
      setError("No devices yet. Import User-Agents/Proxies or click 'Load Starter Devices' at the top.");
      return;
    }

    setSubmitting(true);
    try {
      const targetDeviceIds = selectedIds;
      if (devices.length === 0) {
        await onProvisionAllDevices();
      }
      const safeMinSec = Math.max(1, Math.min(minDwellSec || 30, 600));
      const safeMaxSec = Math.max(safeMinSec, Math.min(maxDwellSec || 120, 600));
      await onStartRun({
        targetUrl: normalizedUrl,
        clickMode,
        clickSelector,
        maxClicksPerDevice: unlimitedClicks ? 0 : Math.max(maxClicksPerDevice || 1, 1),
        unlimitedClicks,
        dwellTimeMs: safeMinSec * 1000,
        minDwellSec: safeMinSec,
        maxDwellSec: safeMaxSec,
        scrollDepthPct,
        concurrency,
        staggerDelayMs,
        followRedirects,
        saveCookies,
        humanLike,
        followNewPages,
        proxyFailover,
        autoCleanAfterRun,
        autoCleanRunHistory,
        disableDeviceOnComplete,
        rotateMacOnStart,
        executionEngine,
        headedBrowser,
        customBrowserPath: customBrowserPath.trim() || undefined,
        signUpConfig,
        deviceIds: targetDeviceIds,
      });
      void api.getMacStatus().then(setMacStatus).catch(() => {});
      onViewRunningProfiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start automation');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRotateMacNow() {
    setRotatingMac(true);
    setMacNotice(null);
    try {
      const res = await api.rotateMacAddress();
      setMacStatus(res.status);
      onDevicesUpdated(res.devices);
      setMacNotice(res.rotation.message);
    } catch (err) {
      setMacNotice(err instanceof Error ? err.message : 'Failed to rotate MAC');
    } finally {
      setRotatingMac(false);
    }
  }

  const signUpEnabled = Boolean(signUpConfig.enabled);
  const emailSource: EmailSourceMode =
    signUpConfig.emailSource ?? (signUpConfig.mode === 'custom' ? 'custom' : 'auto_gmail');

  function handleToggleSignUp(checked: boolean) {
    setSignUpConfig((s) => ({ ...s, enabled: checked }));
    if (
      !checked &&
      (clickMode === 'click_and_signup' ||
        clickMode === 'sign_up_form' ||
        clickMode === 'survey_and_email')
    ) {
      setClickMode('auto_cta');
    }
  }

  function handleChangeClickMode(nextMode: ClickMode) {
    setClickMode(nextMode);
    if (
      nextMode === 'click_and_signup' ||
      nextMode === 'sign_up_form' ||
      nextMode === 'survey_and_email'
    ) {
      setSignUpConfig((s) => ({ ...s, enabled: true }));
    } else if (nextMode === 'scroll_only') {
      setSignUpConfig((s) => ({ ...s, enabled: false }));
    }
  }

  function handleSelectEmailSource(nextSource: EmailSourceMode) {
    setSignUpConfig((s) => ({
      ...s,
      emailSource: nextSource,
      mode: nextSource === 'custom' ? 'custom' : 'auto',
    }));
  }

  return (
    <div className="space-y-6">
      {devices.length === 0 && (userAgentsCount > 0 || onlineProxiesCount > 0) && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              {userAgentsCount} User-Agent(s) &amp; {onlineProxiesCount} Online Proxy(s) ready
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Build isolated real device profiles pairing all your User-Agents and Proxies before running URL clicks &amp; Sign Up forms.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleBuildDevicesNow()}
            disabled={provisioning}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {provisioning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Cpu className="h-3.5 w-3.5" />
            )}
            <span>{provisioning ? 'Building Devices…' : 'Build All Real Devices Now'}</span>
          </button>
        </div>
      )}

      <form onSubmit={handleLaunch} className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Target URL, Click & Sign Up Behavior */}
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Target Website, Click &amp; Sign Up Automation
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Each device opens your URL with its own Proxy, User-Agent, and Browser Fingerprint, clicks CTAs/links, fills &amp; submits Sign Up forms, then wipes all session traces.
              </p>
            </div>
            {browserStatus && (
              <span className="text-[11px] font-mono text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md whitespace-nowrap shrink-0">
                {browserStatus.available
                  ? `Engine: ${browserStatus.name}`
                  : 'Engine: HTTP + Form POST'}
              </span>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Website Link (Target URL)
            </label>
            <div className="relative">
              <Globe className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="url"
                required
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value.replace(/^(https?:\/\/)+(https?:\/\/)/i, '$2'))}
                placeholder="https://your-website.com/signup"
                className="w-full h-10 pl-9 pr-3 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Action Mode (Click / Sign Up Form)
              </label>
              <select
                value={clickMode}
                onChange={(e) => handleChangeClickMode(e.target.value as ClickMode)}
                className="w-full h-9 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="human_journey">
                  Human Auto-Browse (Click What Appears &amp; Follow Offer / Sign Up Pages)
                </option>
                <option value="survey_and_email">
                  Complete Multi-Step Survey &amp; Auto Valid Gmail Submit
                </option>
                <option value="auto_cta">Auto-Discover &amp; Click CTAs / Buttons</option>
                <option value="click_and_signup">Click CTA + Fill &amp; Submit Sign Up Form</option>
                <option value="sign_up_form">Sign Up / Survey Form Auto-Fill &amp; Submit Only</option>
                <option value="selector">Click Specific CSS Selector</option>
                <option value="all_links">Click Any Discovered Link / Button</option>
                <option value="scroll_only">Visit Only (No Clicks)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Execution Engine
              </label>
              <select
                value={executionEngine}
                onChange={(e) => setExecutionEngine(e.target.value as ExecutionEngine)}
                className="w-full h-9 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="auto">Auto (Real Chrome/Edge on PC, HTTP fallback)</option>
                <option value="real_browser">Real Browser Only (Chrome / Edge)</option>
                <option value="http_fast">Fast HTTP + Form POST</option>
              </select>
              {browserStatus && !browserStatus.available && browserStatus.platform === 'linux' && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-1.5 leading-snug">
                  Web Preview runs on Cloud Linux (no Chrome/Edge installed, HTTP-only). JS trackers, Cloudflare &amp; website click counters require running <strong>ProfileGrid.exe</strong> on your Windows PC.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Click CSS Selector {clickMode !== 'selector' && '(Optional Override)'}
              </label>
              <input
                type="text"
                value={clickSelector}
                onChange={(e) => setClickSelector(e.target.value)}
                disabled={clickMode === 'scroll_only' || clickMode === 'sign_up_form'}
                placeholder="a, button, input[type='submit']"
                className="w-full h-9 px-3 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-50"
              />
            </div>

            <div className="flex flex-col justify-end pb-1 gap-1.5">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={headedBrowser}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setHeadedBrowser(checked);
                    if (checked && executionEngine === 'http_fast') {
                      setExecutionEngine('auto');
                    }
                  }}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Show Browser Window (Visible Chrome/Edge — bypasses headless bot filters)</span>
              </label>

              {headedBrowser && browserStatus && (
                browserStatus.available ? (
                  <p className="text-[11px] text-emerald-700 font-medium">
                    Ready: {browserStatus.name} window will open visibly on your PC.
                  </p>
                ) : browserStatus.platform === 'linux' ? (
                  <p className="text-[11px] text-amber-700">
                    Cloud preview runs on Linux (no PC window) — use downloaded <strong>ProfileGrid.exe</strong> on your Windows PC to watch Chrome/Edge live.
                  </p>
                ) : (
                  <div className="space-y-1">
                    <p className="text-[11px] text-amber-700">
                      Chrome/Edge auto-check didn&apos;t match default folders (will try system channel or paste browser path below):
                    </p>
                    <input
                      type="text"
                      value={customBrowserPath}
                      onChange={(e) => setCustomBrowserPath(e.target.value)}
                      placeholder="Optional: C:\Program Files\Google\Chrome\Application\chrome.exe"
                      className="w-full h-8 px-2.5 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-md"
                    />
                  </div>
                )
              )}
            </div>
          </div>

          {/* Optional Sign Up Form Auto-Fill Toggle + Settings */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={signUpEnabled}
                  onChange={(e) => handleToggleSignUp(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <UserPlus className="h-4 w-4 text-blue-600 shrink-0" />
                <div>
                  <span className="text-xs font-semibold text-slate-900 block">
                    Survey &amp; Email Sign Up Auto-Fill Settings
                  </span>
                  <span className="text-[11px] text-slate-500 block">
                    {signUpEnabled
                      ? 'Enabled: Auto-completes multi-step surveys, radio choices, zip/age & valid @gmail.com submits'
                      : 'Off: Tick checkbox to enable automatic survey & Gmail form submission'}
                  </span>
                </div>
              </label>

              {signUpEnabled && (
                <div className="inline-flex flex-wrap items-center gap-1 p-0.5 bg-white border border-slate-200 rounded-lg text-[11px] self-start sm:self-center">
                  <button
                    type="button"
                    onClick={() => handleSelectEmailSource('auto_gmail')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      emailSource === 'auto_gmail'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Auto Valid @gmail.com
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectEmailSource('gmail_pool')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      emailSource === 'gmail_pool'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Verified Gmail Pool
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectEmailSource('custom')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      emailSource === 'custom'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Custom Single
                  </button>
                </div>
              )}
            </div>

            {signUpEnabled && (
              <>
                {emailSource === 'gmail_pool' && (
                  <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-800">
                        Paste Your Gmail List (1 valid Gmail per line · 1 unique Gmail assigned per device)
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleValidateGmailPool()}
                        disabled={validatingEmails}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                      >
                        {validatingEmails ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        <span>
                          {validatingEmails
                            ? 'Checking Syntax & MX…'
                            : 'Verify Valid Gmail (Syntax + MX)'}
                        </span>
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={signUpConfig.gmailPool || ''}
                      onChange={(e) => {
                        setSignUpConfig((s) => ({ ...s, gmailPool: e.target.value }));
                        setEmailValidationSummary(null);
                      }}
                      placeholder={`Paste your Gmail addresses (one per line):\nalex.carter92@gmail.com\ntaylor.brooks88@gmail.com\n\nIf left empty, unique valid-format @gmail.com addresses are auto-generated per device.`}
                      className="w-full p-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    {emailValidationSummary && (
                      <div className="text-[11px] font-medium text-emerald-700 flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {emailValidationSummary.validCount} valid email(s) kept
                          {emailValidationSummary.mxChecked ? ' (DNS MX verified)' : ''}
                          {emailValidationSummary.invalidCount > 0
                            ? ` · ${emailValidationSummary.invalidCount} invalid format removed`
                            : ''}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {emailSource === 'auto_gmail' && (
                  <div className="text-[11px] text-slate-600 bg-white border border-slate-200/80 rounded-lg px-3 py-2">
                    Auto-generates a unique, realistic valid-syntax <code className="font-mono text-slate-900">@gmail.com</code> address + matching Name, Zip, Age, and Survey selections for every device.
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs pt-1 border-t border-slate-200/80">
                  <input
                    type="text"
                    value={signUpConfig.fullName}
                    onChange={(e) =>
                      setSignUpConfig((s) => ({ ...s, fullName: e.target.value }))
                    }
                    placeholder={
                      emailSource !== 'custom'
                        ? 'Full Name (leave blank for auto-generated)'
                        : 'Full Name (e.g. Alex Carter)'
                    }
                    className="h-8 px-2.5 bg-white border border-slate-200 rounded-md"
                  />
                  <input
                    type="email"
                    value={signUpConfig.email}
                    onChange={(e) =>
                      setSignUpConfig((s) => ({ ...s, email: e.target.value }))
                    }
                    placeholder={
                      emailSource === 'auto_gmail'
                        ? 'Optional fixed Gmail override (blank = auto unique)'
                        : emailSource === 'gmail_pool'
                          ? 'Optional fallback Gmail if pool is empty'
                          : 'Custom Gmail (e.g. alex.carter@gmail.com)'
                    }
                    className="h-8 px-2.5 bg-white border border-slate-200 rounded-md"
                  />
                  <input
                    type="text"
                    value={signUpConfig.username}
                    onChange={(e) =>
                      setSignUpConfig((s) => ({ ...s, username: e.target.value }))
                    }
                    placeholder="Username (optional / auto)"
                    className="h-8 px-2.5 bg-white border border-slate-200 rounded-md"
                  />
                  <input
                    type="text"
                    value={signUpConfig.password}
                    onChange={(e) =>
                      setSignUpConfig((s) => ({ ...s, password: e.target.value }))
                    }
                    placeholder="Password (optional / auto strong)"
                    className="h-8 px-2.5 bg-white border border-slate-200 rounded-md"
                  />
                  <input
                    type="text"
                    value={signUpConfig.phone}
                    onChange={(e) =>
                      setSignUpConfig((s) => ({ ...s, phone: e.target.value }))
                    }
                    placeholder="Phone (optional / auto)"
                    className="h-8 px-2.5 bg-white border border-slate-200 rounded-md"
                  />
                  <input
                    type="text"
                    value={signUpConfig.submitSelector}
                    onChange={(e) =>
                      setSignUpConfig((s) => ({ ...s, submitSelector: e.target.value }))
                    }
                    placeholder="Submit Button Selector (optional, e.g. #signup-btn)"
                    className="h-8 px-2.5 font-mono bg-white border border-slate-200 rounded-md"
                  />
                </div>

                <textarea
                  rows={2}
                  value={signUpConfig.customFields}
                  onChange={(e) =>
                    setSignUpConfig((s) => ({ ...s, customFields: e.target.value }))
                  }
                  placeholder={`Optional custom field overrides (one per line):\n#company=Acme Labs\ninput[name="promo"]=WELCOME20`}
                  className="w-full p-2 text-xs font-mono bg-white border border-slate-200 rounded-md"
                />
              </>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Clicks / Device
              </label>
              <input
                type="number"
                min={1}
                max={100000}
                disabled={unlimitedClicks}
                value={maxClicksPerDevice}
                onChange={(e) => setMaxClicksPerDevice(Number(e.target.value))}
                className="w-full h-9 px-3 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg disabled:opacity-50"
              />
              <label className="inline-flex items-center gap-1.5 mt-1.5 text-[11px] text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={unlimitedClicks}
                  onChange={(e) => setUnlimitedClicks(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Unlimited (until Stop)</span>
              </label>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Min Stay (sec)
              </label>
              <input
                type="number"
                min={1}
                max={600}
                step={5}
                value={minDwellSec}
                onChange={(e) => {
                  const val = Math.max(1, Number(e.target.value));
                  setMinDwellSec(val);
                  if (maxDwellSec < val) setMaxDwellSec(val);
                }}
                className="w-full h-9 px-3 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Default: 30s</span>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Max Stay (sec)
              </label>
              <input
                type="number"
                min={1}
                max={600}
                step={5}
                value={maxDwellSec}
                onChange={(e) => setMaxDwellSec(Math.max(minDwellSec, Number(e.target.value)))}
                className="w-full h-9 px-3 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Default: 120s (2m)</span>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Concurrency
              </label>
              <input
                type="number"
                min={1}
                max={6}
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                className="w-full h-9 px-3 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Stagger (ms)
              </label>
              <input
                type="number"
                min={0}
                max={5000}
                step={100}
                value={staggerDelayMs}
                onChange={(e) => setStaggerDelayMs(Number(e.target.value))}
                className="w-full h-9 px-3 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="space-y-2.5 pt-1 text-xs text-slate-700">
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-3 space-y-2">
              <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-slate-900">
                <input
                  type="checkbox"
                  checked={humanLike}
                  onChange={(e) => setHumanLike(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600"
                />
                <span>
                  Human-Like Behavior (Slow curved mouse movement, gradual scroll, natural click &amp; anti-bot stealth)
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-5">
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={followNewPages}
                    onChange={(e) => setFollowNewPages(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>Follow clicked Offer / Sign Up pages &amp; new tabs (click whatever appears)</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={proxyFailover}
                    onChange={(e) => setProxyFailover(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>Auto-Failover backup proxy on ERR_TUNNEL_CONNECTION_FAILED</span>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-5">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={followRedirects}
                  onChange={(e) => setFollowRedirects(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Follow HTTP &amp; JS redirects</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveCookies}
                  onChange={(e) => setSaveCookies(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Capture session cookies during run</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-5">
              <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-slate-900">
                <input
                  type="checkbox"
                  checked={disableDeviceOnComplete}
                  onChange={(e) => setDisableDeviceOnComplete(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Turn Off Device After Completion (1-time click/run per device; stays OFF)</span>
              </label>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-slate-900">
                  <input
                    type="checkbox"
                    checked={rotateMacOnStart}
                    onChange={(e) => setRotateMacOnStart(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <Network className="h-3.5 w-3.5 text-blue-600" />
                  <span>Rotate Internet NIC MAC + Per-Device MAC on Start</span>
                </label>
                <button
                  type="button"
                  onClick={() => void handleRotateMacNow()}
                  disabled={rotatingMac || isRunning}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 disabled:opacity-50"
                >
                  {rotatingMac ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  <span>Rotate Internet MAC Now</span>
                </button>
              </div>
              {macStatus && (
                <div className="text-[11px] font-mono text-slate-600 flex flex-wrap items-center gap-2">
                  <span>
                    Internet Adapter: <strong>{macStatus.adapterName || 'Auto'}</strong>
                    {macStatus.ipv4 ? ` (${macStatus.ipv4})` : ''} · Current MAC:{' '}
                    <strong className="text-slate-900">{macStatus.currentMac || 'Unknown'}</strong>
                  </span>
                  {macStatus.platform === 'win32' && !macStatus.isAdmin && (
                    <span className="text-amber-700 font-sans">
                      (Will prompt Windows permission once, or run ProfileGrid.exe as Admin)
                    </span>
                  )}
                </div>
              )}
              {macNotice && (
                <p className="text-[11px] text-blue-700 font-medium">{macNotice}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-5">
              <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-slate-900">
                <input
                  type="checkbox"
                  checked={autoCleanAfterRun}
                  onChange={(e) => setAutoCleanAfterRun(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Auto-Clean cookies, storage &amp; cache after each device finishes (zero data left)</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer text-slate-600">
                <input
                  type="checkbox"
                  checked={autoCleanRunHistory}
                  onChange={(e) => setAutoCleanRunHistory(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Also wipe run history &amp; previews automatically on finish</span>
              </label>
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="pt-2 flex items-center justify-between gap-3 border-t border-slate-100">
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {selectedIds.length} of {devices.length} devices targeted
            </span>
            {isRunning ? (
              <button
                type="button"
                onClick={onStopRun}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors whitespace-nowrap"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Stop Automation</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  submitting ||
                  (devices.length === 0 && userAgentsCount === 0 && onlineProxiesCount === 0)
                }
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-current" />
                )}
                <span>Start Devices &amp; Open Running Profiles</span>
              </button>
            )}
          </div>
        </div>

        {/* Right: Device Selector */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Select Target Devices ({selectedIds.length})
            </h3>
            <div className="flex items-center gap-2 text-xs">
              {devices.some((d) => d.status === 'off') && (
                <button
                  type="button"
                  onClick={() => void onResetDevicesStatus()}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100"
                >
                  <Power className="h-3 w-3" />
                  <span>Turn On All OFF ({devices.filter((d) => d.status === 'off').length})</span>
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(devices.filter((d) => d.status !== 'off').map((d) => d.id))
                }
                className="text-blue-600 hover:underline font-medium"
              >
                All Active
              </button>
              <span className="text-slate-300" aria-hidden="true">/</span>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-slate-500 hover:text-slate-900 font-medium"
              >
                None
              </button>
            </div>
          </div>

          {devices.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 space-y-3">
              <p>No devices available yet. Import User-Agents &amp; Proxies or build devices from your pool.</p>
              {(userAgentsCount > 0 || onlineProxiesCount > 0) && (
                <button
                  type="button"
                  onClick={() => void handleBuildDevicesNow()}
                  disabled={provisioning}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <Cpu className="h-3.5 w-3.5" />
                  <span>Build All Real Devices</span>
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {devices.map((dev) => {
                const isOff = dev.status === 'off';
                const checked = !isOff && selectedIds.includes(dev.id);
                return (
                  <div
                    key={dev.id}
                    className={`flex items-center justify-between gap-3 px-4 py-3 ${
                      isOff ? 'bg-slate-50/70 opacity-75' : 'hover:bg-slate-50'
                    }`}
                  >
                    <label
                      className={`flex items-center gap-3 min-w-0 flex-1 ${
                        isOff ? 'cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isOff}
                        onChange={() => toggleDevice(dev.id)}
                        className="rounded border-slate-300 text-blue-600 disabled:opacity-40"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs font-medium text-slate-900">
                          <span className="truncate">{dev.name}</span>
                          {isOff && (
                            <span className="text-[10px] font-mono font-semibold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded shrink-0">
                              OFF
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 truncate">
                          {dev.userAgent.label} · {dev.proxy?.countryCode || 'DIRECT'}
                          {dev.fingerprint.macAddress ? ` · MAC ${dev.fingerprint.macAddress}` : ''}
                        </div>
                      </div>
                    </label>
                    <div className="flex items-center gap-2 shrink-0">
                      {isOff && (
                        <button
                          type="button"
                          onClick={() => void onToggleDeviceStatus(dev.id, 'ready')}
                          className="text-[11px] font-medium text-emerald-700 hover:underline"
                        >
                          Turn On
                        </button>
                      )}
                      <span className="text-[11px] font-mono tabular-nums text-slate-400">
                        {dev.totalRuns}r / {dev.totalClicks}c
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </form>

      {/* Run History with Clean Controls */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Campaign Run History
            </h3>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {runs.length} recorded run(s)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleClean('sessions')}
              disabled={cleaning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Eraser className="h-3.5 w-3.5 text-slate-500" />
              <span>Clean History &amp; Cookies</span>
            </button>
            <button
              type="button"
              onClick={() => void handleClean('all')}
              disabled={cleaning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Wipe All Data</span>
            </button>
          </div>
        </div>
        {runs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No automation runs recorded yet. All session traces are clean.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 px-4">Target Website</th>
                  <th className="py-2.5 px-4">Strategy</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Devices</th>
                  <th className="py-2.5 px-4 text-right">Clicks Executed</th>
                  <th className="py-2.5 px-4 text-right">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 font-mono text-slate-900 max-w-xs truncate">
                      {run.targetUrl}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                      {run.clickMode}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {run.status === 'running' ? (
                        <span className="inline-flex items-center gap-1.5 text-blue-700 font-medium">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Running
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {run.status === 'stopped' ? 'Stopped' : 'Completed'}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                      {run.completedCount}/{run.deviceCount}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                      <span className="inline-flex items-center gap-1">
                        <MousePointerClick className="h-3 w-3 text-slate-400" />
                        {run.totalClicksExecuted}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(run.startedAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
