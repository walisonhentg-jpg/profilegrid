import { useEffect, useState } from 'react';
import {
  Activity,
  Download,
  Fingerprint,
  Globe,
  Laptop,
  Loader2,
  Play,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import {
  checkExeAvailable,
  downloadDesktopExe,
  downloadDesktopZip,
  type DesktopStatus,
} from '../lib/downloadDesktop.ts';

export type NavTab =
  | 'running'
  | 'devices'
  | 'user-agents'
  | 'proxies'
  | 'automation'
  | 'fingerprint-sessions';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  counts: {
    running: number;
    devices: number;
    userAgents: number;
    proxiesOnline: number;
    proxiesTotal: number;
    runs: number;
  };
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  activeTab,
  onSelectTab,
  counts,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const [exeStatus, setExeStatus] = useState<DesktopStatus>({ exeAvailable: false });
  const [downloading, setDownloading] = useState(false);
  const [exeProgress, setExeProgress] = useState<number | null>(null);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function poll() {
      const status = await checkExeAvailable();
      if (!active) return;
      setExeStatus(status);
      if (!status.exeAvailable) {
        setTimeout(poll, 8000);
      }
    }
    void poll();
    return () => {
      active = false;
    };
  }, []);

  async function handleDownload() {
    setDownloading(true);
    setDownloadErr(null);
    try {
      await downloadDesktopZip();
    } catch (err) {
      setDownloadErr(err instanceof Error ? err.message : 'ZIP download failed');
    } finally {
      setDownloading(false);
    }
  }

  async function handleExeDownload() {
    setExeProgress(0);
    setDownloadErr(null);
    try {
      await downloadDesktopExe((pct) => setExeProgress(pct));
    } catch (err) {
      setDownloadErr(err instanceof Error ? err.message : 'EXE download failed');
    } finally {
      setExeProgress(null);
    }
  }

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: typeof Activity;
    countLabel?: string;
  }> = [
    {
      id: 'running',
      label: 'Running Profiles',
      icon: Activity,
      countLabel: counts.running > 0 ? `${counts.running} live` : undefined,
    },
    {
      id: 'automation',
      label: 'Automation Runner',
      icon: Play,
      countLabel: counts.runs > 0 ? String(counts.runs) : undefined,
    },
    {
      id: 'devices',
      label: 'Device Profiles',
      icon: Laptop,
      countLabel: String(counts.devices),
    },
    {
      id: 'user-agents',
      label: 'User-Agent Pool',
      icon: Terminal,
      countLabel: String(counts.userAgents),
    },
    {
      id: 'proxies',
      label: 'Proxy Checker',
      icon: Globe,
      countLabel:
        counts.proxiesTotal > 0
          ? `${counts.proxiesOnline}/${counts.proxiesTotal}`
          : '0',
    },
    {
      id: 'fingerprint-sessions',
      label: 'Fingerprint & Sessions',
      icon: Fingerprint,
    },
  ];

  const content = (
    <div className="flex h-full flex-col bg-white border-r border-slate-200 overflow-y-auto">
      <div className="flex h-14 items-center justify-between px-5 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white shrink-0">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            ProfileGrid
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900 rounded-md"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-3 space-y-1" aria-label="Workspace navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectTab(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-blue-400' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </span>
              {item.countLabel !== undefined && (
                <span
                  className={`font-mono text-xs tabular-nums shrink-0 ${
                    active ? 'text-slate-300' : 'text-slate-400'
                  }`}
                >
                  {item.countLabel}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 shrink-0 space-y-2">
        {exeStatus.exeAvailable ? (
          <button
            type="button"
            onClick={handleExeDownload}
            disabled={exeProgress !== null}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            {exeProgress !== null ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span>
              {exeProgress !== null
                ? `Downloading .EXE (${exeProgress}%)…`
                : 'Download Windows .EXE'}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span>{downloading ? 'Preparing ZIP…' : 'Download App (.zip)'}</span>
          </button>
        )}
        {downloadErr ? (
          <p className="text-[11px] text-red-600 text-center">{downloadErr}</p>
        ) : (
          <p className="text-[11px] text-slate-500 text-center">
            {exeStatus.exeAvailable
              ? `Windows x64 Portable (${exeStatus.exeSizeMb ?? ''} MB)`
              : 'PC 1-click Run & .exe builder'}
          </p>
        )}

        <div className="mt-3 pt-3 border-t border-slate-200">
          <div className="text-xs font-medium text-slate-500 mb-1.5">Pipeline Sequence</div>
          <ol className="space-y-1 text-xs text-slate-600">
            <li className="flex items-center justify-between">
              <span>1. Import User-Agents</span>
              <span className="font-mono tabular-nums text-slate-500">{counts.userAgents}</span>
            </li>
            <li className="flex items-center justify-between">
              <span>2. Verify Proxies</span>
              <span className="font-mono tabular-nums text-slate-500">{counts.proxiesOnline} ok</span>
            </li>
            <li className="flex items-center justify-between">
              <span>3. Build Devices</span>
              <span className="font-mono tabular-nums text-slate-500">{counts.devices}</span>
            </li>
            <li className="flex items-center justify-between">
              <span>4. Run &amp; Inspect</span>
              <span className="font-mono tabular-nums text-slate-500">{counts.runs} runs</span>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-64 shrink-0 h-screen sticky top-0">{content}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-900/40" onClick={onCloseMobile} />
          <aside className="relative w-64 max-w-[85vw] h-full z-10">{content}</aside>
        </div>
      )}
    </>
  );
}
