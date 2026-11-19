import { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ProxyEntry } from '../types/automation.ts';

interface ProxyCheckerViewProps {
  proxies: ProxyEntry[];
  onImportProxies: (
    rawText: string,
    autoCheck: boolean,
    autoProvision: boolean,
    allowDuplicates?: boolean,
    repeatCount?: number
  ) => Promise<{
    addedCount: number;
    skippedCount?: number;
    skippedSample?: string[];
  }>;
  onCheckProxies: (
    proxyIds?: string[],
    autoProvision?: boolean
  ) => Promise<{ checkedCount: number; provisionedCount: number }>;
  onProvisionDevices: () => Promise<{ createdCount: number }>;
  onDeleteProxy: (id: string) => Promise<void>;
  onClearProxies: () => Promise<void>;
}

export function ProxyCheckerView({
  proxies,
  onImportProxies,
  onCheckProxies,
  onProvisionDevices,
  onDeleteProxy,
  onClearProxies,
}: ProxyCheckerViewProps) {
  const [rawText, setRawText] = useState('');
  const [autoCheck, setAutoCheck] = useState(true);
  const [autoProvision, setAutoProvision] = useState(true);
  const [allowDuplicates, setAllowDuplicates] = useState(true);
  const [repeatCount, setRepeatCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'online' | 'offline' | 'unchecked'>('all');
  const [search, setSearch] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const stats = useMemo(() => {
    return {
      total: proxies.length,
      online: proxies.filter((p) => p.status === 'online').length,
      offline: proxies.filter((p) => p.status === 'offline').length,
      checking: proxies.filter((p) => p.status === 'checking').length,
    };
  }, [proxies]);

  const filtered = useMemo(() => {
    return proxies.filter((p) => {
      if (filter !== 'all' && p.status !== filter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          p.host.toLowerCase().includes(q) ||
          (p.country ?? '').toLowerCase().includes(q) ||
          (p.city ?? '').toLowerCase().includes(q) ||
          (p.exitIp ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [proxies, filter, search]);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!rawText.trim()) return;
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await onImportProxies(
        rawText,
        autoCheck,
        autoProvision,
        allowDuplicates,
        repeatCount
      );
      if (res.addedCount > 0) {
        setRawText('');
        setStatusMsg(
          autoCheck
            ? `Imported ${res.addedCount} proxy node(s). Verifying connectivity, GeoIP location & auto-provisioning devices…`
            : `Imported ${res.addedCount} proxy node(s).`
        );
      }
      if (res.skippedCount && res.skippedCount > 0) {
        setErrorMsg(
          `Skipped ${res.skippedCount} unrecognized entry(s)${
            res.skippedSample?.length ? ` (e.g. "${res.skippedSample[0]}")` : ''
          }.`
        );
      } else if (res.addedCount === 0) {
        setErrorMsg('No valid proxies found in input. Check format (e.g. host:port or user:pass@host:port).');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to import proxies');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddDirectNode() {
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      await onImportProxies('direct://local', true, true, true, 1);
      setStatusMsg('Added & verified Local Exit Node and auto-built a device profile.');
    } finally {
      setBusy(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await onImportProxies(
        text,
        autoCheck,
        autoProvision,
        allowDuplicates,
        repeatCount
      );
      setStatusMsg(`Imported ${res.addedCount} proxies from ${file.name}.`);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function handleCheckAll() {
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await onCheckProxies(
        proxies.map((p) => p.id),
        true
      );
      setStatusMsg(
        `Checked ${res.checkedCount} proxies · Auto-created ${res.provisionedCount} new device profile(s).`
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleBuildDevicesNow() {
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await onProvisionDevices();
      setStatusMsg(`Auto-provisioned ${res.createdCount} new device profile(s) from verified proxies.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Proxy Importer */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Bulk Proxy Importer &amp; Auto-Device Provisioning
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Paste unlimited proxies (<span className="font-mono">ip:port</span>,{' '}
              <span className="font-mono">user:pass@ip:port</span>,{' '}
              <span className="font-mono">ip:port:user:pass</span>,{' '}
              <span className="font-mono">user:pass:ip:port</span>,{' '}
              <span className="font-mono">socks5://...</span>). Supports rotating proxies and bulk paste.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Import File</span>
            </button>
            <button
              type="button"
              onClick={handleAddDirectNode}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
            >
              <Globe className="h-3.5 w-3.5" />
              <span>Add Local Exit Node</span>
            </button>
          </div>
        </div>

        <form onSubmit={handleImport} className="space-y-3">
          <textarea
            rows={5}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={`user:pass@proxy.example.com:8080\nhttp://user:pass@203.0.113.10:8080\nsocks5://198.51.100.42:1080\n192.0.2.55:3128:proxyuser:proxypass`}
            className="w-full p-3 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
          />

          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoCheck}
                  onChange={(e) => setAutoCheck(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Auto-check GeoIP</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoProvision}
                  onChange={(e) => setAutoProvision(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Auto-create devices</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowDuplicates}
                  onChange={(e) => setAllowDuplicates(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Allow rotating / duplicate lines</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <span className="text-slate-600">Multiply each ×</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={repeatCount}
                  onChange={(e) => setRepeatCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                  className="w-16 h-7 px-2 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-md"
                />
              </label>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {rawText.split(/[\r\n,;]+/).filter((l) => l.trim()).length} line(s)
              </span>
              <button
                type="submit"
                disabled={busy || !rawText.trim()}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span>Import &amp; Check Proxies</span>
              </button>
            </div>
          </div>
          {statusMsg && <p className="text-xs text-blue-700 font-medium">{statusMsg}</p>}
          {errorMsg && <p className="text-xs text-red-600 font-medium">{errorMsg}</p>}
        </form>
      </div>

      {/* Proxy Results Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['all', 'online', 'offline', 'unchecked'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilter(tab)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 ${
                    filter === tab
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="text-xs text-slate-500 font-mono tabular-nums flex items-center gap-2">
              <span>{stats.online} online</span>
              <span aria-hidden="true">·</span>
              <span>{stats.offline} offline</span>
              {stats.checking > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-blue-600">{stats.checking} checking</span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-52">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter IP, country, city…"
                className="w-full h-9 pl-8 pr-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {proxies.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleCheckAll}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Re-Check All</span>
                </button>
                <button
                  type="button"
                  onClick={handleBuildDevicesNow}
                  disabled={busy || stats.online === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  <Cpu className="h-3.5 w-3.5" />
                  <span>Auto-Build Devices ({stats.online})</span>
                </button>
                <button
                  type="button"
                  onClick={onClearProxies}
                  className="px-2.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No proxies imported yet. Paste proxy endpoints above or add a Local Exit Node to verify real GeoIP binding.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 px-4">Endpoint</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Latency</th>
                  <th className="py-2.5 px-4">Exit IP</th>
                  <th className="py-2.5 px-4">Location</th>
                  <th className="py-2.5 px-4">Timezone &amp; ISP</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.map((px) => (
                  <tr key={px.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 font-mono text-slate-900 whitespace-nowrap">
                      <span className="uppercase text-[10px] text-slate-400 mr-1.5">
                        {px.protocol}
                      </span>
                      {px.host}
                      {px.port > 0 ? `:${px.port}` : ''}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {px.status === 'online' && (
                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Online
                        </span>
                      )}
                      {px.status === 'checking' && (
                        <span className="inline-flex items-center gap-1.5 font-medium text-blue-700">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Checking
                        </span>
                      )}
                      {px.status === 'offline' && (
                        <span
                          className="inline-flex items-center gap-1.5 font-medium text-red-700"
                          title={px.error ?? 'Unreachable'}
                        >
                          <AlertCircle className="h-3.5 w-3.5" />
                          Offline
                        </span>
                      )}
                      {px.status === 'unchecked' && (
                        <span className="text-slate-500">Unchecked</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {px.latencyMs !== null ? `${px.latencyMs} ms` : '—'}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-700 whitespace-nowrap">
                      {px.exitIp ?? '—'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-800 whitespace-nowrap">
                      {px.country
                        ? [px.city, px.countryCode || px.country].filter(Boolean).join(', ')
                        : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500 max-w-xs truncate">
                      {px.error && px.status === 'offline' ? (
                        <span className="text-red-600 font-mono text-[11px]">{px.error}</span>
                      ) : (
                        <span>
                          {px.timezone ?? '—'}
                          {px.isp ? ` · ${px.isp}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onCheckProxies([px.id], true)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 rounded-md transition-colors"
                          aria-label="Re-check proxy"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteProxy(px.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-md transition-colors"
                          aria-label="Delete proxy"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
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
