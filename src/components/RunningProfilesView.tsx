import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eraser,
  ExternalLink,
  Fingerprint,
  Globe,
  Loader2,
  MousePointerClick,
  Play,
  Search,
} from 'lucide-react';
import type {
  DeviceProfile,
  RunningProfileState,
} from '../types/automation.ts';

interface RunningProfilesViewProps {
  runningProfiles: Record<string, RunningProfileState>;
  devices: DeviceProfile[];
  onOpenAutomation: () => void;
  onInspectDevice: (deviceId: string) => void;
  onQuickRunUrl: (url: string) => Promise<void>;
  onCleanRuns: () => Promise<void>;
  isRunningCampaign: boolean;
}

export function RunningProfilesView({
  runningProfiles,
  devices,
  onOpenAutomation,
  onInspectDevice,
  onQuickRunUrl,
  onCleanRuns,
  isRunningCampaign,
}: RunningProfilesViewProps) {
  const [filter, setFilter] = useState<'all' | 'running' | 'completed' | 'error'>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quickUrl, setQuickUrl] = useState('https://example.com');
  const [launching, setLaunching] = useState(false);
  const [quickErr, setQuickErr] = useState<string | null>(null);

  const profiles = useMemo(() => {
    const list = Object.values(runningProfiles).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    return list.filter((p) => {
      if (filter !== 'all' && p.status !== filter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          p.deviceName.toLowerCase().includes(q) ||
          p.currentUrl.toLowerCase().includes(q) ||
          p.proxyLocation.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [runningProfiles, filter, search]);

  const activeSelected =
    profiles.find((p) => p.deviceId === selectedId) ?? profiles[0] ?? null;

  const stats = useMemo(() => {
    const all = Object.values(runningProfiles);
    return {
      total: all.length,
      running: all.filter((p) => p.status === 'running').length,
      completed: all.filter((p) => p.status === 'completed').length,
      clicks: all.reduce((acc, p) => acc + p.clickedUrls.length, 0),
    };
  }, [runningProfiles]);

  async function handleQuickRun(e: React.FormEvent) {
    e.preventDefault();
    setQuickErr(null);
    if (!quickUrl.trim()) return;
    setLaunching(true);
    try {
      await onQuickRunUrl(quickUrl.trim());
    } catch (err) {
      setQuickErr(err instanceof Error ? err.message : 'Failed to start run');
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Quick Target Bar & Status Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 lg:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <form onSubmit={handleQuickRun} className="flex-1 flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Globe className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="url"
                value={quickUrl}
                onChange={(e) => setQuickUrl(e.target.value)}
                placeholder="https://your-website.com"
                className="w-full h-10 pl-9 pr-3 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>
            <button
              type="submit"
              disabled={
                launching ||
                isRunningCampaign ||
                devices.filter((d) => d.status !== 'off').length === 0
              }
              className="inline-flex items-center justify-center gap-2 h-10 px-4 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {launching || isRunningCampaign ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              <span>
                {devices.length === 0
                  ? 'No Devices Ready'
                  : devices.filter((d) => d.status !== 'off').length === 0
                    ? 'All Devices OFF (Completed)'
                    : isRunningCampaign
                      ? 'Running Devices…'
                      : `Auto-Click with ${devices.filter((d) => d.status !== 'off').length} Devices`}
              </span>
            </button>
          </form>

          <div className="flex items-center gap-5 text-xs text-slate-600 border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-100 shrink-0">
            <div>
              <span className="text-slate-400">Active</span>{' '}
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {stats.running}
              </span>
            </div>
            <span className="text-slate-300" aria-hidden="true">·</span>
            <div>
              <span className="text-slate-400">Completed</span>{' '}
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {stats.completed}
              </span>
            </div>
            <span className="text-slate-300" aria-hidden="true">·</span>
            <div>
              <span className="text-slate-400">Auto-Clicks</span>{' '}
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {stats.clicks}
              </span>
            </div>
          </div>
        </div>
        {quickErr && (
          <p className="mt-2.5 text-xs text-red-600 flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{quickErr}</span>
          </p>
        )}
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
          {(['all', 'running', 'completed', 'error'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 ${
                filter === tab
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter running profiles…"
              className="w-full h-9 pl-8 pr-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          {Object.keys(runningProfiles).length > 0 && (
            <button
              type="button"
              onClick={() => void onCleanRuns()}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Eraser className="h-3.5 w-3.5 text-slate-500" />
              <span>Clean Profiles &amp; Sessions</span>
            </button>
          )}
        </div>
      </div>

      {profiles.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <div className="mx-auto h-11 w-11 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 mb-3">
            <MousePointerClick className="h-5 w-5" />
          </div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            No running browser profiles yet
          </h2>
          <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
            {devices.length === 0
              ? 'Import your User-Agents and Proxies first to auto-build isolated devices, then enter your website link above.'
              : 'Enter a target website link above or open Automation Runner to watch every virtual device navigate, click, and persist sessions in real time.'}
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onOpenAutomation}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
            >
              Configure Automation Runner
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Live Browser Viewport Grid */}
          <div className="xl:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-4">
            {profiles.map((profile) => {
              const isSelected = activeSelected?.deviceId === profile.deviceId;
              return (
                <div
                  key={profile.deviceId}
                  onClick={() => setSelectedId(profile.deviceId)}
                  className={`cursor-pointer bg-white rounded-xl border transition-colors overflow-hidden ${
                    isSelected
                      ? 'border-blue-600 ring-1 ring-blue-600'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* Dark Browser Frame Header */}
                  <div className="bg-slate-900 px-3 py-2 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-white truncate">
                        {profile.deviceName}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-300 whitespace-nowrap shrink-0">
                      {profile.proxyLocation}
                    </span>
                  </div>

                  {/* Address Bar */}
                  <div className="bg-slate-800 px-3 py-1.5 flex items-center justify-between gap-2 border-b border-slate-700">
                    <div className="flex-1 min-w-0 font-mono text-[11px] text-slate-300 truncate bg-slate-900/70 px-2 py-1 rounded">
                      {profile.currentUrl}
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-slate-300 shrink-0">
                      {profile.httpStatus ? `HTTP ${profile.httpStatus}` : '…'}
                    </span>
                  </div>

                  {/* Viewport Preview Canvas */}
                  <div className="relative h-48 bg-slate-100 overflow-hidden border-b border-slate-200">
                    {profile.screenshotDataUrl ? (
                      <img
                        src={profile.screenshotDataUrl}
                        alt={`Live browser viewport ${profile.deviceName}`}
                        className="w-full h-full object-cover object-top"
                      />
                    ) : profile.previewHtml ? (
                      <iframe
                        title={`Viewport ${profile.deviceName}`}
                        srcDoc={profile.previewHtml}
                        sandbox=""
                        className="w-[200%] h-[200%] origin-top-left scale-50 pointer-events-none bg-white"
                      />
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-xs text-slate-500 p-4 text-center">
                        {profile.status === 'running' ? (
                          <>
                            <Loader2 className="h-5 w-5 animate-spin text-blue-600 mb-2" />
                            <span>{profile.activePhase}</span>
                          </>
                        ) : profile.error ? (
                          <>
                            <AlertCircle className="h-5 w-5 text-red-600 mb-2" />
                            <span className="text-red-700">{profile.error}</span>
                          </>
                        ) : (
                          <span>
                            {profile.status === 'completed'
                              ? 'Completed & auto-cleaned (0 trace left)'
                              : 'Awaiting page render'}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Animated Virtual Click Marker */}
                    {profile.clickCoordinates && profile.status === 'running' && (
                      <div
                        style={{
                          left: `${profile.clickCoordinates.xPct}%`,
                          top: `${profile.clickCoordinates.yPct}%`,
                        }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 flex items-center gap-1.5"
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600/90 text-white shadow-sm ring-4 ring-blue-500/30">
                          <MousePointerClick className="h-3.5 w-3.5" />
                        </span>
                        {profile.clickTargetText && (
                          <span className="bg-slate-900/90 text-white text-[10px] font-medium px-2 py-0.5 rounded whitespace-nowrap max-w-[140px] truncate">
                            {profile.clickTargetText}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Clean Unboxed Metadata Footer */}
                  <div className="p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        {profile.status === 'running' && (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                            <span className="text-blue-700">Running</span>
                          </>
                        )}
                        {profile.status === 'completed' && (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            <span className="text-emerald-700">Completed</span>
                          </>
                        )}
                        {profile.status === 'error' && (
                          <>
                            <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                            <span className="text-red-700">Error</span>
                          </>
                        )}
                      </div>
                      <span className="font-mono text-xs tabular-nums text-slate-500">
                        {profile.latencyMs !== null ? `${profile.latencyMs} ms` : '—'}
                      </span>
                    </div>

                    <div className="text-xs text-slate-600 truncate">
                      {profile.activePhase}
                    </div>

                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5 truncate font-mono tabular-nums">
                      <span>{profile.userAgentLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span>{profile.clickedUrls.length} clicks</span>
                      <span aria-hidden="true">·</span>
                      <span>{profile.cookiesCapturedCount} cookies</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Focused Profile Live Inspector */}
          {activeSelected && (
            <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden sticky top-20">
              <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-sm font-semibold text-slate-900 truncate">
                    {activeSelected.deviceName}
                  </h2>
                  <p className="text-xs text-slate-500 font-mono truncate">
                    {activeSelected.viewportWidth}x{activeSelected.viewportHeight} ·{' '}
                    {activeSelected.proxyLabel}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onInspectDevice(activeSelected.deviceId)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Fingerprint className="h-3.5 w-3.5" />
                  <span>Fingerprint &amp; Session</span>
                </button>
              </div>

              <div className="p-4 space-y-5 max-h-[calc(100vh-12rem)] overflow-y-auto">
                {/* Step Timeline */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-900 mb-2.5">
                    Execution Timeline
                  </h3>
                  <div className="space-y-2.5">
                    {activeSelected.steps.map((step) => (
                      <div
                        key={step.id}
                        className="flex items-start justify-between gap-3 text-xs pb-2.5 border-b border-slate-100 last:border-b-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <div
                            className={`font-medium ${
                              step.phase === 'error' ? 'text-red-700' : 'text-slate-800'
                            }`}
                          >
                            {step.message}
                          </div>
                          {step.detail && (
                            <div className="font-mono text-[11px] text-slate-500 truncate mt-0.5">
                              {step.detail}
                            </div>
                          )}
                        </div>
                        <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(step.timestamp).toLocaleTimeString([], {
                            hour12: false,
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Discovered & Clicked Elements */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-slate-900">
                      Discovered Click Targets ({activeSelected.discoveredLinks.length})
                    </h3>
                    <span className="text-xs font-mono text-slate-500 tabular-nums">
                      {activeSelected.clickedUrls.length} clicked
                    </span>
                  </div>
                  {activeSelected.discoveredLinks.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No clickable links or CTAs indexed yet.
                    </p>
                  ) : (
                    <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
                      {activeSelected.discoveredLinks.map((link, idx) => (
                        <div
                          key={`${link.href}_${idx}`}
                          className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-slate-800 truncate">
                              {link.text}
                            </div>
                            <div className="font-mono text-[11px] text-slate-400 truncate">
                              {link.selector}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {link.clicked ? (
                              <span className="text-[11px] font-medium text-emerald-700 flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                Clicked
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400">Indexed</span>
                            )}
                            <a
                              href={link.href}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-400 hover:text-slate-700"
                              aria-label="Open link in new tab"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
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
      )}
    </div>
  );
}
