import { useMemo, useState } from 'react';
import {
  Cpu,
  Fingerprint,
  Laptop,
  Monitor,
  Plus,
  Power,
  Search,
  Smartphone,
  Tablet,
  Trash2,
} from 'lucide-react';
import type {
  DeviceProfile,
  ProxyEntry,
  UserAgentEntry,
} from '../types/automation.ts';

interface DeviceProfilesViewProps {
  devices: DeviceProfile[];
  userAgents: UserAgentEntry[];
  proxies: ProxyEntry[];
  onProvisionFromProxies: () => Promise<{ createdCount: number }>;
  onCreateCustomDevice: (payload: {
    name?: string;
    userAgentId?: string;
    proxyId?: string | null;
  }) => Promise<void>;
  onDeleteDevice: (id: string) => Promise<void>;
  onClearDevices: () => Promise<void>;
  onInspectFingerprintSession: (deviceId: string) => void;
  onToggleDeviceStatus: (deviceId: string, nextStatus: 'ready' | 'off') => Promise<void>;
  onResetDevicesStatus: () => Promise<void>;
}

export function DeviceProfilesView({
  devices,
  userAgents,
  proxies,
  onProvisionFromProxies,
  onCreateCustomDevice,
  onDeleteDevice,
  onClearDevices,
  onInspectFingerprintSession,
  onToggleDeviceStatus,
  onResetDevicesStatus,
}: DeviceProfilesViewProps) {
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedUaId, setSelectedUaId] = useState(userAgents[0]?.id ?? '');
  const [selectedProxyId, setSelectedProxyId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const onlineProxiesCount = useMemo(
    () => proxies.filter((p) => p.status === 'online').length,
    [proxies]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return devices;
    const q = search.toLowerCase();
    return devices.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.userAgent.os.toLowerCase().includes(q) ||
        (d.proxy?.country ?? '').toLowerCase().includes(q) ||
        d.fingerprint.canvasHash.toLowerCase().includes(q)
    );
  }, [devices, search]);

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onCreateCustomDevice({
        name: newName,
        userAgentId: selectedUaId || userAgents[0]?.id,
        proxyId: selectedProxyId || null,
      });
      setNewName('');
      setShowCreate(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 lg:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Virtual Device Profiles
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Each device pairs an isolated User-Agent, Proxy exit location, deterministic Browser Fingerprint, and persistent Cookie/Storage jar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Custom Device</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              try {
                await onProvisionFromProxies();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy || userAgents.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Cpu className="h-3.5 w-3.5" />
            <span>
              Auto-Build All Devices (
              {onlineProxiesCount > 0
                ? Math.min(onlineProxiesCount, userAgents.length)
                : userAgents.length}
              )
            </span>
          </button>
        </div>
      </div>

      {/* Custom Device Form */}
      {showCreate && (
        <form
          onSubmit={handleCreateSubmit}
          className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-4 gap-4 items-end"
        >
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Device Label (Optional)
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. QA Chrome · London"
              className="w-full h-9 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              User-Agent
            </label>
            <select
              value={selectedUaId || userAgents[0]?.id || ''}
              onChange={(e) => setSelectedUaId(e.target.value)}
              className="w-full h-9 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {userAgents.length === 0 ? (
                <option value="">Default Chrome 131 · Windows</option>
              ) : (
                userAgents.map((ua) => (
                  <option key={ua.id} value={ua.id}>
                    {ua.label}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Bound Proxy Node
            </label>
            <select
              value={selectedProxyId}
              onChange={(e) => setSelectedProxyId(e.target.value)}
              className="w-full h-9 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">Direct Host Exit (No Proxy)</option>
              {proxies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.host}
                  {p.port ? `:${p.port}` : ''} ({p.countryCode || p.status})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 h-9 px-4 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              Create Profile
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="h-9 px-3 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Devices Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search device, OS, country, hash…"
              className="w-full h-9 pl-8 pr-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {filtered.length} device profile(s)
            </span>
            {devices.some((d) => d.status === 'off') && (
              <button
                type="button"
                onClick={() => void onResetDevicesStatus()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap"
              >
                <Power className="h-3.5 w-3.5" />
                <span>Turn On All OFF</span>
              </button>
            )}
            {devices.length > 0 && (
              <button
                type="button"
                onClick={onClearDevices}
                className="px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap"
              >
                Clear All
              </button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 mb-3">
              <Laptop className="h-5 w-5" />
            </div>
            <h3 className="font-display text-sm font-semibold text-slate-900">
              No device profiles provisioned
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Import and verify proxies in Proxy Checker to automatically assemble isolated devices, or click &ldquo;New Custom Device&rdquo; above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 px-4">Device Profile</th>
                  <th className="py-2.5 px-4">Browser &amp; Viewport</th>
                  <th className="py-2.5 px-4">Proxy &amp; Geo</th>
                  <th className="py-2.5 px-4">Fingerprint Hash</th>
                  <th className="py-2.5 px-4 text-right">Cookies</th>
                  <th className="py-2.5 px-4 text-right">Clicks</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.map((dev) => {
                  const isOff = dev.status === 'off';
                  return (
                  <tr key={dev.id} className={isOff ? 'bg-slate-50/70 opacity-75' : 'hover:bg-slate-50/80'}>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        {dev.userAgent.deviceType === 'Mobile' ? (
                          <Smartphone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        ) : dev.userAgent.deviceType === 'Tablet' ? (
                          <Tablet className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        ) : (
                          <Monitor className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        )}
                        <span>{dev.name}</span>
                        {isOff ? (
                          <span className="text-[10px] font-mono font-semibold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">
                            OFF
                          </span>
                        ) : dev.status === 'running' ? (
                          <span className="text-[10px] font-mono font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                            RUNNING
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                            ON
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {dev.fingerprint.timezone}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="text-slate-800">{dev.userAgent.label}</div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-500">
                        {dev.fingerprint.viewportWidth}x{dev.fingerprint.viewportHeight} · DPR{' '}
                        {dev.fingerprint.devicePixelRatio}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-mono text-slate-800">
                        {dev.proxy
                          ? `${dev.proxy.host}${dev.proxy.port ? `:${dev.proxy.port}` : ''}`
                          : 'direct://local'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {dev.proxy?.country
                          ? [dev.proxy.city, dev.proxy.countryCode].filter(Boolean).join(', ')
                          : 'Local Exit'}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                      <div>
                        Canvas {dev.fingerprint.canvasHash}
                        {dev.fingerprint.macAddress ? ` · MAC ${dev.fingerprint.macAddress}` : ''}
                      </div>
                      <div className="text-slate-400 truncate max-w-[220px]">
                        {dev.fingerprint.webglRenderer}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {dev.session.cookies.length}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {dev.totalClicks}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {dev.status !== 'running' && (
                          <button
                            type="button"
                            onClick={() => void onToggleDeviceStatus(dev.id, isOff ? 'ready' : 'off')}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                              isOff
                                ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                                : 'text-slate-600 bg-slate-100 hover:bg-slate-200'
                            }`}
                          >
                            <Power className="h-3.5 w-3.5" />
                            <span>{isOff ? 'Turn On' : 'Turn Off'}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onInspectFingerprintSession(dev.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
                        >
                          <Fingerprint className="h-3.5 w-3.5" />
                          <span>Inspect</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteDevice(dev.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-md transition-colors"
                          aria-label="Delete device"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
