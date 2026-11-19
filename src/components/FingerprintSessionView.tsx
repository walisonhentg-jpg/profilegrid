import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cookie,
  Download,
  Fingerprint,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import type {
  CookieEntry,
  DeviceProfile,
  WebRTCMode,
} from '../types/automation.ts';

interface FingerprintSessionViewProps {
  devices: DeviceProfile[];
  selectedDeviceId: string | null;
  onSelectDevice: (id: string) => void;
  onUpdateDevice: (id: string, payload: Partial<DeviceProfile>) => Promise<void>;
  onRegenerateFingerprint: (id: string) => Promise<void>;
}

export function FingerprintSessionView({
  devices,
  selectedDeviceId,
  onSelectDevice,
  onUpdateDevice,
  onRegenerateFingerprint,
}: FingerprintSessionViewProps) {
  const device =
    devices.find((d) => d.id === selectedDeviceId) ?? devices[0] ?? null;

  const [subTab, setSubTab] = useState<'fingerprint' | 'session'>('fingerprint');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Editable fingerprint fields
  const [vw, setVw] = useState(1920);
  const [vh, setVh] = useState(1080);
  const [timezone, setTimezone] = useState('America/New_York');
  const [langs, setLangs] = useState('en-US, en');
  const [webrtc, setWebrtc] = useState<WebRTCMode>('altered');
  const [webglRenderer, setWebglRenderer] = useState('');

  // Add cookie state
  const [cookieName, setCookieName] = useState('');
  const [cookieValue, setCookieValue] = useState('');
  const [cookieDomain, setCookieDomain] = useState('');

  // Add localStorage state
  const [lsKey, setLsKey] = useState('');
  const [lsVal, setLsVal] = useState('');
  const [lsOrigin, setLsOrigin] = useState('https://example.com');

  useEffect(() => {
    if (!device) return;
    setVw(device.fingerprint.viewportWidth);
    setVh(device.fingerprint.viewportHeight);
    setTimezone(device.fingerprint.timezone);
    setLangs(device.fingerprint.languages.join(', '));
    setWebrtc(device.fingerprint.webRTCMode);
    setWebglRenderer(device.fingerprint.webglRenderer);
    setCookieDomain(
      device.session.lastActiveOrigin
        ? new URL(device.session.lastActiveOrigin).hostname
        : 'example.com'
    );
    if (device.session.lastActiveOrigin) {
      setLsOrigin(device.session.lastActiveOrigin);
    }
  }, [device?.id, device?.fingerprint.seed]);

  if (!device) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
        <Fingerprint className="h-8 w-8 text-slate-400 mx-auto mb-3" />
        <h2 className="font-display text-base font-semibold text-slate-900">
          No device profile selected
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Provision or create a device profile first to inspect its automated browser fingerprint and isolated session store.
        </p>
      </div>
    );
  }

  async function handleSaveFingerprint(e: React.FormEvent) {
    e.preventDefault();
    if (!device) return;
    setSaving(true);
    setToast(null);
    try {
      await onUpdateDevice(device.id, {
        fingerprint: {
          ...device.fingerprint,
          viewportWidth: Number(vw) || 1440,
          viewportHeight: Number(vh) || 900,
          timezone: timezone.trim() || 'UTC',
          languages: langs
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          webRTCMode: webrtc,
          webglRenderer: webglRenderer.trim() || device.fingerprint.webglRenderer,
        },
      });
      setToast('Fingerprint overrides saved to device profile.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCookie(e: React.FormEvent) {
    e.preventDefault();
    if (!device || !cookieName.trim()) return;
    const entry: CookieEntry = {
      id: `ck_${Date.now().toString(36)}`,
      name: cookieName.trim(),
      value: cookieValue,
      domain: cookieDomain.trim() || 'example.com',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
      expires: 'Session',
    };
    await onUpdateDevice(device.id, {
      session: {
        ...device.session,
        cookies: [entry, ...device.session.cookies],
      },
    });
    setCookieName('');
    setCookieValue('');
    setToast('Added cookie to isolated session jar.');
  }

  async function handleDeleteCookie(cookieId: string) {
    if (!device) return;
    await onUpdateDevice(device.id, {
      session: {
        ...device.session,
        cookies: device.session.cookies.filter((c) => c.id !== cookieId),
      },
    });
  }

  async function handleClearCookies() {
    if (!device) return;
    await onUpdateDevice(device.id, {
      session: {
        ...device.session,
        cookies: [],
      },
    });
    setToast('Cleared isolated cookie jar for this device.');
  }

  async function handleAddLocalStorage(e: React.FormEvent) {
    e.preventDefault();
    if (!device || !lsKey.trim()) return;
    await onUpdateDevice(device.id, {
      session: {
        ...device.session,
        localStorage: [
          { key: lsKey.trim(), value: lsVal, origin: lsOrigin.trim() || 'https://example.com' },
          ...device.session.localStorage,
        ],
      },
    });
    setLsKey('');
    setLsVal('');
  }

  function handleExportProfile() {
    if (!device) return;
    const blob = new Blob([JSON.stringify(device, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${device.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Device Switcher & Sub-Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 lg:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 min-w-0">
          <label className="text-xs font-semibold text-slate-700 whitespace-nowrap">
            Active Device:
          </label>
          <select
            value={device.id}
            onChange={(e) => onSelectDevice(e.target.value)}
            className="h-9 px-3 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 min-w-[260px]"
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.session.cookies.length} cookies)
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSubTab('fingerprint')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'fingerprint'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Fingerprint className="h-3.5 w-3.5" />
              <span>Browser Fingerprint</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('session')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'session'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Cookie className="h-3.5 w-3.5" />
              <span>Session Management ({device.session.cookies.length})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportProfile}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export JSON</span>
          </button>
        </div>
      </div>

      {toast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-4 py-2.5 rounded-lg flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {subTab === 'fingerprint' ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Fingerprint Specs & Overrides */}
          <form
            onSubmit={handleSaveFingerprint}
            className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-5"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Automated Hardware &amp; Browser Fingerprint
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Seed: {device.fingerprint.seed}
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await onRegenerateFingerprint(device.id);
                  setToast('Generated fresh hardware & canvas fingerprint seed.');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Regenerate Seed</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-medium text-slate-600 mb-1">
                  Viewport Width (px)
                </label>
                <input
                  type="number"
                  value={vw}
                  onChange={(e) => setVw(Number(e.target.value))}
                  className="w-full h-9 px-3 font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 mb-1">
                  Viewport Height (px)
                </label>
                <input
                  type="number"
                  value={vh}
                  onChange={(e) => setVh(Number(e.target.value))}
                  className="w-full h-9 px-3 font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 mb-1">
                  Timezone (Proxy-Synced)
                </label>
                <input
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full h-9 px-3 font-mono bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 mb-1">
                  Navigator Languages
                </label>
                <input
                  type="text"
                  value={langs}
                  onChange={(e) => setLangs(e.target.value)}
                  className="w-full h-9 px-3 font-mono bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 mb-1">
                  WebRTC Leak Policy
                </label>
                <select
                  value={webrtc}
                  onChange={(e) => setWebrtc(e.target.value as WebRTCMode)}
                  className="w-full h-9 px-3 bg-slate-50 border border-slate-200 rounded-lg"
                >
                  <option value="altered">Altered (Spoof Public IP to Proxy)</option>
                  <option value="disabled">Disabled</option>
                  <option value="real">Real Interface</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-600 mb-1">
                  WebGL Renderer
                </label>
                <input
                  type="text"
                  value={webglRenderer}
                  onChange={(e) => setWebglRenderer(e.target.value)}
                  className="w-full h-9 px-3 font-mono bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? 'Saving…' : 'Save Fingerprint Overrides'}</span>
              </button>
            </div>
          </form>

          {/* Telemetry & Consistency Audit */}
          <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Fingerprint Vector Matrix
            </h3>

            <dl className="divide-y divide-slate-100 text-xs">
              <div className="py-2 flex justify-between gap-4">
                <dt className="text-slate-500">Hardware MAC</dt>
                <dd className="font-mono text-slate-900">
                  {device.fingerprint.macAddress || 'Auto-Generated'}
                </dd>
              </div>
              <div className="py-2 flex justify-between gap-4">
                <dt className="text-slate-500">Canvas Hash</dt>
                <dd className="font-mono text-slate-900">{device.fingerprint.canvasHash}</dd>
              </div>
              <div className="py-2 flex justify-between gap-4">
                <dt className="text-slate-500">AudioContext Hash</dt>
                <dd className="font-mono text-slate-900">{device.fingerprint.audioHash}</dd>
              </div>
              <div className="py-2 flex justify-between gap-4">
                <dt className="text-slate-500">Platform / Vendor</dt>
                <dd className="font-mono text-slate-900">
                  {device.fingerprint.platform} · {device.fingerprint.vendor || 'Gecko'}
                </dd>
              </div>
              <div className="py-2 flex justify-between gap-4">
                <dt className="text-slate-500">CPU / RAM / Touch</dt>
                <dd className="font-mono tabular-nums text-slate-900">
                  {device.fingerprint.hardwareConcurrency} cores ·{' '}
                  {device.fingerprint.deviceMemory} GB ·{' '}
                  {device.fingerprint.maxTouchPoints} pts
                </dd>
              </div>
              <div className="py-2 flex justify-between gap-4">
                <dt className="text-slate-500">Geolocation</dt>
                <dd className="font-mono tabular-nums text-slate-900">
                  {device.fingerprint.geolocation.lat.toFixed(3)},{' '}
                  {device.fingerprint.geolocation.lon.toFixed(3)}
                </dd>
              </div>
              <div className="py-2 flex flex-col gap-1">
                <dt className="text-slate-500">Sec-CH-UA Client Hints</dt>
                <dd className="font-mono text-[11px] text-slate-700 break-all">
                  {device.fingerprint.clientHints.secChUa || 'Omitted (Firefox/Safari)'}
                </dd>
              </div>
            </dl>

            <div className="border-t border-slate-200 pt-4">
              <h4 className="text-xs font-semibold text-slate-900 mb-2">
                Alignment Verification
              </h4>
              <ul className="space-y-1.5 text-xs text-slate-600">
                {device.fingerprint.consistencyNotes.map((note, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Cookies Manager */}
          <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Isolated Cookie Jar ({device.session.cookies.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Automatically sends matching cookies on visits and saves Set-Cookie headers per device.
                </p>
              </div>
              {device.session.cookies.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearCookies}
                  className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap"
                >
                  Clear Cookies
                </button>
              )}
            </div>

            <form
              onSubmit={handleAddCookie}
              className="p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-4 gap-2"
            >
              <input
                type="text"
                value={cookieName}
                onChange={(e) => setCookieName(e.target.value)}
                placeholder="Cookie name"
                className="h-8 px-2.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
              />
              <input
                type="text"
                value={cookieValue}
                onChange={(e) => setCookieValue(e.target.value)}
                placeholder="Value"
                className="h-8 px-2.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
              />
              <input
                type="text"
                value={cookieDomain}
                onChange={(e) => setCookieDomain(e.target.value)}
                placeholder="Domain (e.g. example.com)"
                className="h-8 px-2.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
              />
              <button
                type="submit"
                disabled={!cookieName.trim()}
                className="h-8 px-3 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 inline-flex items-center justify-center gap-1 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Cookie</span>
              </button>
            </form>

            {device.session.cookies.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No cookies stored for this device yet. Run a URL campaign or add cookies manually above.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
                      <th className="py-2 px-3">Name</th>
                      <th className="py-2 px-3">Value</th>
                      <th className="py-2 px-3">Domain</th>
                      <th className="py-2 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                    {device.session.cookies.map((ck) => (
                      <tr key={ck.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-medium text-slate-900">{ck.name}</td>
                        <td className="py-2 px-3 text-slate-600 max-w-[180px] truncate">
                          {ck.value}
                        </td>
                        <td className="py-2 px-3 text-slate-500">{ck.domain}</td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteCookie(ck.id)}
                            className="p-1 text-slate-400 hover:text-red-600"
                            aria-label="Delete cookie"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* LocalStorage & Session History */}
          <div className="xl:col-span-5 space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                LocalStorage Partition ({device.session.localStorage.length})
              </h3>
              <form onSubmit={handleAddLocalStorage} className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={lsKey}
                  onChange={(e) => setLsKey(e.target.value)}
                  placeholder="Key"
                  className="h-8 px-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md"
                />
                <input
                  type="text"
                  value={lsVal}
                  onChange={(e) => setLsVal(e.target.value)}
                  placeholder="Value"
                  className="h-8 px-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md"
                />
                <button
                  type="submit"
                  disabled={!lsKey.trim()}
                  className="h-8 px-2.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50"
                >
                  Set Key
                </button>
              </form>
              {device.session.localStorage.length > 0 && (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg text-xs font-mono">
                  {device.session.localStorage.map((item, idx) => (
                    <div key={idx} className="px-3 py-2 flex justify-between gap-2">
                      <span className="text-slate-900 truncate">{item.key}</span>
                      <span className="text-slate-500 truncate">{item.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Device Navigation History ({device.session.history.length})
                </h3>
              </div>
              {device.session.history.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No navigation history recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                  {device.session.history.map((h) => (
                    <div key={h.id} className="px-4 py-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-800 truncate">{h.action}</span>
                        <span className="font-mono tabular-nums text-slate-500 shrink-0">
                          {h.status ?? '—'} · {h.latencyMs}ms
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 truncate mt-0.5">
                        {h.url}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
