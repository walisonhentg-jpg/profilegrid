import { useEffect, useState } from 'react';
import { Check, Download, Eraser, Loader2, Menu, Play, Sparkles, Square, Trash2 } from 'lucide-react';
import {
  checkExeAvailable,
  downloadDesktopExe,
  downloadDesktopZip,
  type DesktopStatus,
} from '../lib/downloadDesktop.ts';
import type { NavTab } from './Sidebar.tsx';

interface TopHeaderProps {
  activeTab: NavTab;
  isRunning: boolean;
  hasDevices: boolean;
  onOpenMobileMenu: () => void;
  onQuickLaunch: () => void;
  onStopRun: () => void;
  onLoadSamplePack: () => void;
  onCleanWorkspace: (scope: 'sessions' | 'runs' | 'all') => Promise<void>;
  loadingSample: boolean;
}

const TAB_TITLES: Record<NavTab, string> = {
  running: 'Running Profiles',
  devices: 'Device Profiles',
  'user-agents': 'User-Agent Pool',
  proxies: 'Proxy Checker',
  automation: 'Automation Runner',
  'fingerprint-sessions': 'Fingerprint & Sessions',
};

export function TopHeader({
  activeTab,
  isRunning,
  hasDevices,
  onOpenMobileMenu,
  onQuickLaunch,
  onStopRun,
  onLoadSamplePack,
  onCleanWorkspace,
  loadingSample,
}: TopHeaderProps) {
  const [exeStatus, setExeStatus] = useState<DesktopStatus>({ exeAvailable: false });
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [exeProgress, setExeProgress] = useState<number | null>(null);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const [cleanMenuOpen, setCleanMenuOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanedDone, setCleanedDone] = useState(false);

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

  async function handleZipDownload() {
    setDownloadingZip(true);
    setDownloadErr(null);
    try {
      await downloadDesktopZip();
    } catch (err) {
      setDownloadErr(err instanceof Error ? err.message : 'ZIP download failed');
    } finally {
      setDownloadingZip(false);
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

  async function runClean(scope: 'sessions' | 'runs' | 'all') {
    setCleaning(true);
    setDownloadErr(null);
    setCleanMenuOpen(false);
    try {
      await onCleanWorkspace(scope);
      setCleanedDone(true);
      setTimeout(() => setCleanedDone(false), 2500);
    } catch (err) {
      setDownloadErr(err instanceof Error ? err.message : 'Clean failed');
    } finally {
      setCleaning(false);
    }
  }

  return (
    <header className="h-14 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 -ml-1 text-slate-600 hover:text-slate-900 rounded-md"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-slate-400 whitespace-nowrap shrink-0">Workspace</span>
          <span className="text-slate-300" aria-hidden="true">/</span>
          <h1 className="font-display font-semibold text-slate-900 truncate">
            {TAB_TITLES[activeTab]}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {downloadErr && (
          <span className="hidden md:inline text-xs text-red-600 max-w-[200px] truncate" title={downloadErr}>
            {downloadErr}
          </span>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setCleanMenuOpen((v) => !v)}
            disabled={cleaning}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {cleaning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : cleanedDone ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <Eraser className="h-3.5 w-3.5 text-slate-600" />
            )}
            <span>
              {cleaning ? 'Cleaning…' : cleanedDone ? 'Cleaned!' : 'Clean Data'}
            </span>
          </button>

          {cleanMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setCleanMenuOpen(false)}
              />
              <div className="absolute right-0 mt-1.5 w-72 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 z-50">
                <button
                  type="button"
                  onClick={() => void runClean('sessions')}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <div className="text-xs font-medium text-slate-900 flex items-center gap-1.5">
                    <Eraser className="h-3.5 w-3.5 text-blue-600" />
                    <span>Clean Sessions, Cookies &amp; Runs</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Clears cookies, storage, previews &amp; run history. Keeps UAs, proxies &amp; devices.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => void runClean('all')}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-red-50 transition-colors mt-0.5"
                >
                  <div className="text-xs font-medium text-red-700 flex items-center gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Wipe Everything (Full Reset)</span>
                  </div>
                  <div className="text-[11px] text-red-600/80 mt-0.5">
                    Deletes ALL UAs, proxies, devices, cookies, history &amp; stored files.
                  </div>
                </button>
              </div>
            </>
          )}
        </div>

        {!hasDevices && (
          <button
            type="button"
            onClick={onLoadSamplePack}
            disabled={loadingSample}
            className="hidden sm:inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5 text-blue-600" />
            <span>{loadingSample ? 'Provisioning…' : 'Load Starter Devices'}</span>
          </button>
        )}

        {exeStatus.exeAvailable ? (
          <button
            type="button"
            onClick={handleExeDownload}
            disabled={exeProgress !== null}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            {exeProgress !== null ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span>
              {exeProgress !== null ? `Downloading ${exeProgress}%` : 'Download .EXE'}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleZipDownload}
            disabled={downloadingZip}
            className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {downloadingZip ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span>{downloadingZip ? 'Preparing…' : 'Download App (.zip)'}</span>
          </button>
        )}

        {isRunning ? (
          <button
            type="button"
            onClick={onStopRun}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            <span>Stop Active Run</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onQuickLaunch}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>Launch URL Automation</span>
          </button>
        )}
      </div>
    </header>
  );
}
