import { useCallback, useEffect, useMemo, useState } from 'react';
import { AutomationRunnerView } from './components/AutomationRunnerView.tsx';
import { DeviceProfilesView } from './components/DeviceProfilesView.tsx';
import { FingerprintSessionView } from './components/FingerprintSessionView.tsx';
import { ProxyCheckerView } from './components/ProxyCheckerView.tsx';
import { RunningProfilesView } from './components/RunningProfilesView.tsx';
import { Sidebar, type NavTab } from './components/Sidebar.tsx';
import { TopHeader } from './components/TopHeader.tsx';
import { UserAgentPoolView } from './components/UserAgentPoolView.tsx';
import { api } from './lib/api.ts';
import type {
  AutomationConfig,
  AutomationRunSummary,
  DeviceProfile,
  ProxyEntry,
  RunningProfileState,
  WorkspaceState,
} from './types/automation.ts';

const EMPTY_STATE: WorkspaceState = {
  userAgents: [],
  proxies: [],
  devices: [],
  runs: [],
  runningProfiles: {},
  activeRunId: null,
};

export default function App() {
  const [state, setState] = useState<WorkspaceState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<NavTab>('running');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);

  const refreshState = useCallback(async () => {
    try {
      const data = await api.getState();
      setState(data);
    } catch (err) {
      console.error('Failed to load workspace state:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  // Real-time SSE updates for live Running Profiles, Proxy Verification, and Runs
  useEffect(() => {
    const es = new EventSource('/api/automation/stream');

    es.addEventListener('profile_update', (ev) => {
      const profile = JSON.parse((ev as MessageEvent).data) as RunningProfileState;
      setState((prev) => ({
        ...prev,
        runningProfiles: {
          ...prev.runningProfiles,
          [profile.deviceId]: profile,
        },
      }));
    });

    es.addEventListener('proxy_update', (ev) => {
      const proxy = JSON.parse((ev as MessageEvent).data) as ProxyEntry;
      setState((prev) => ({
        ...prev,
        proxies: prev.proxies.map((p) => (p.id === proxy.id ? proxy : p)),
      }));
    });

    es.addEventListener('devices_provisioned', (ev) => {
      const created = JSON.parse((ev as MessageEvent).data) as DeviceProfile[];
      setState((prev) => {
        const existingIds = new Set(prev.devices.map((d) => d.id));
        const uniqueNew = created.filter((d) => !existingIds.has(d.id));
        return {
          ...prev,
          devices: [...uniqueNew, ...prev.devices],
        };
      });
    });

    es.addEventListener('device_updated', (ev) => {
      const updated = JSON.parse((ev as MessageEvent).data) as DeviceProfile;
      setState((prev) => ({
        ...prev,
        devices: prev.devices.map((d) => (d.id === updated.id ? updated : d)),
      }));
    });

    es.addEventListener('devices_synced', (ev) => {
      const synced = JSON.parse((ev as MessageEvent).data) as DeviceProfile[];
      if (Array.isArray(synced)) {
        setState((prev) => ({
          ...prev,
          devices: synced,
        }));
      }
    });

    es.addEventListener('run_summary', (ev) => {
      const summary = JSON.parse((ev as MessageEvent).data) as AutomationRunSummary;
      setState((prev) => {
        const exists = prev.runs.some((r) => r.id === summary.id);
        return {
          ...prev,
          activeRunId: summary.status === 'running' ? summary.id : null,
          runs: exists
            ? prev.runs.map((r) => (r.id === summary.id ? summary : r))
            : [summary, ...prev.runs],
        };
      });
    });

    es.addEventListener('workspace_cleaned', (ev) => {
      const payload = JSON.parse((ev as MessageEvent).data) as { state: WorkspaceState };
      if (payload?.state) {
        setState(payload.state);
      }
    });

    return () => {
      es.close();
    };
  }, []);

  const isRunningCampaign = useMemo(() => {
    const hasRunningRun = state.runs.some((r) => r.status === 'running');
    const hasRunningProfile = Object.values(state.runningProfiles).some(
      (p) => p.status === 'running'
    );
    return hasRunningRun || hasRunningProfile;
  }, [state.runs, state.runningProfiles]);

  const counts = useMemo(
    () => ({
      running: Object.values(state.runningProfiles).filter((p) => p.status === 'running')
        .length,
      devices: state.devices.length,
      userAgents: state.userAgents.length,
      proxiesOnline: state.proxies.filter((p) => p.status === 'online').length,
      proxiesTotal: state.proxies.length,
      runs: state.runs.length,
    }),
    [state]
  );

  async function handleQuickRunUrl(url: string) {
    const config: AutomationConfig = {
      targetUrl: url,
      clickMode: 'human_journey',
      clickSelector: 'a, button, input[type="submit"]',
      maxClicksPerDevice: 3,
      dwellTimeMs: 45000,
      minDwellSec: 30,
      maxDwellSec: 120,
      scrollDepthPct: 75,
      concurrency: 3,
      staggerDelayMs: 800,
      followRedirects: true,
      saveCookies: true,
      humanLike: true,
      followNewPages: true,
      proxyFailover: true,
      autoCleanAfterRun: true,
      disableDeviceOnComplete: true,
      rotateMacOnStart: true,
      executionEngine: 'auto',
      signUpConfig: {
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
      },
      deviceIds: state.devices.filter((d) => d.status !== 'off').map((d) => d.id),
    };
    await api.startAutomation(config);
  }

  async function handleCleanWorkspace(scope: 'sessions' | 'runs' | 'all') {
    const res = await api.cleanWorkspace(scope);
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // Ignore storage restriction errors
    }
    if (scope === 'all') {
      setSelectedDeviceId(null);
    }
    setState(res.state);
  }

  async function handleLoadSamplePack() {
    setLoadingSample(true);
    try {
      const res = await api.loadSamplePack();
      setState(res.state);
      setActiveTab('devices');
    } finally {
      setLoadingSample(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        counts={counts}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopHeader
          activeTab={activeTab}
          isRunning={isRunningCampaign}
          hasDevices={state.devices.length > 0}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onQuickLaunch={() => setActiveTab('automation')}
          onStopRun={() => void api.stopAutomation()}
          onLoadSamplePack={() => void handleLoadSamplePack()}
          onCleanWorkspace={handleCleanWorkspace}
          loadingSample={loadingSample}
        />

        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          {loading ? (
            <div className="space-y-4">
              <div className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
              <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
            </div>
          ) : (
            <>
              {activeTab === 'running' && (
                <RunningProfilesView
                  runningProfiles={state.runningProfiles}
                  devices={state.devices}
                  isRunningCampaign={isRunningCampaign}
                  onOpenAutomation={() => setActiveTab('automation')}
                  onInspectDevice={(devId) => {
                    setSelectedDeviceId(devId);
                    setActiveTab('fingerprint-sessions');
                  }}
                  onQuickRunUrl={handleQuickRunUrl}
                  onCleanRuns={() => handleCleanWorkspace('sessions')}
                />
              )}

              {activeTab === 'user-agents' && (
                <UserAgentPoolView
                  userAgents={state.userAgents}
                  onImport={async (rawText) => {
                    const res = await api.importUserAgents(rawText);
                    setState((prev) => ({
                      ...prev,
                      userAgents: res.userAgents,
                      devices: res.devices,
                    }));
                    return { addedCount: res.addedCount };
                  }}
                  onDelete={async (id) => {
                    const res = await api.deleteUserAgent(id);
                    setState((prev) => ({ ...prev, userAgents: res.userAgents }));
                  }}
                  onClearAll={async () => {
                    const res = await api.clearUserAgents();
                    setState((prev) => ({ ...prev, userAgents: res.userAgents }));
                  }}
                />
              )}

              {activeTab === 'proxies' && (
                <ProxyCheckerView
                  proxies={state.proxies}
                  onImportProxies={async (
                    rawText,
                    autoCheck,
                    autoProvision,
                    allowDuplicates,
                    repeatCount
                  ) => {
                    const res = await api.importProxies(
                      rawText,
                      autoCheck,
                      autoProvision,
                      allowDuplicates,
                      repeatCount
                    );
                    setState((prev) => ({
                      ...prev,
                      proxies: res.proxies,
                      devices: res.devices ?? prev.devices,
                    }));
                    return {
                      addedCount: res.addedCount,
                      skippedCount: res.skippedCount,
                      skippedSample: res.skippedSample,
                    };
                  }}
                  onCheckProxies={async (proxyIds, autoProvision) => {
                    const res = await api.checkProxies(proxyIds, autoProvision);
                    setState((prev) => ({
                      ...prev,
                      proxies: res.proxies,
                      devices: res.devices,
                    }));
                    return {
                      checkedCount: res.checkedCount,
                      provisionedCount: res.provisionedCount,
                    };
                  }}
                  onProvisionDevices={async () => {
                    const res = await api.provisionDevices();
                    setState((prev) => ({ ...prev, devices: res.devices }));
                    return { createdCount: res.createdCount };
                  }}
                  onDeleteProxy={async (id) => {
                    const res = await api.deleteProxy(id);
                    setState((prev) => ({
                      ...prev,
                      proxies: res.proxies,
                      devices: res.devices ?? prev.devices,
                    }));
                  }}
                  onClearProxies={async () => {
                    const res = await api.clearProxies();
                    setState((prev) => ({
                      ...prev,
                      proxies: res.proxies,
                      devices: res.devices ?? prev.devices,
                    }));
                  }}
                />
              )}

              {activeTab === 'devices' && (
                <DeviceProfilesView
                  devices={state.devices}
                  userAgents={state.userAgents}
                  proxies={state.proxies}
                  onProvisionFromProxies={async () => {
                    const res = await api.provisionDevices();
                    setState((prev) => ({ ...prev, devices: res.devices }));
                    return { createdCount: res.createdCount };
                  }}
                  onCreateCustomDevice={async (payload) => {
                    const res = await api.createDevice(payload);
                    setState((prev) => ({ ...prev, devices: res.devices }));
                  }}
                  onDeleteDevice={async (id) => {
                    const res = await api.deleteDevice(id);
                    setState((prev) => {
                      const nextRunning = { ...prev.runningProfiles };
                      delete nextRunning[id];
                      return {
                        ...prev,
                        devices: res.devices,
                        runningProfiles: nextRunning,
                      };
                    });
                  }}
                  onClearDevices={async () => {
                    const res = await api.clearDevices();
                    setState((prev) => ({
                      ...prev,
                      devices: res.devices,
                      runningProfiles: {},
                    }));
                  }}
                  onInspectFingerprintSession={(devId) => {
                    setSelectedDeviceId(devId);
                    setActiveTab('fingerprint-sessions');
                  }}
                  onToggleDeviceStatus={async (devId, nextStatus) => {
                    const res = await api.updateDevice(devId, { status: nextStatus });
                    setState((prev) => ({ ...prev, devices: res.devices }));
                  }}
                  onResetDevicesStatus={async () => {
                    const res = await api.resetDevicesStatus();
                    setState((prev) => ({ ...prev, devices: res.devices }));
                  }}
                />
              )}

              {activeTab === 'automation' && (
                <AutomationRunnerView
                  devices={state.devices}
                  userAgentsCount={state.userAgents.length}
                  onlineProxiesCount={counts.proxiesOnline}
                  runs={state.runs}
                  isRunning={isRunningCampaign}
                  onStartRun={async (config) => {
                    await api.startAutomation(config);
                  }}
                  onStopRun={async () => {
                    await api.stopAutomation();
                  }}
                  onProvisionAllDevices={async () => {
                    const res = await api.provisionDevices();
                    setState((prev) => ({ ...prev, devices: res.devices }));
                  }}
                  onToggleDeviceStatus={async (devId, nextStatus) => {
                    const res = await api.updateDevice(devId, { status: nextStatus });
                    setState((prev) => ({ ...prev, devices: res.devices }));
                  }}
                  onResetDevicesStatus={async () => {
                    const res = await api.resetDevicesStatus();
                    setState((prev) => ({ ...prev, devices: res.devices }));
                  }}
                  onDevicesUpdated={(updatedDevices) => {
                    setState((prev) => ({ ...prev, devices: updatedDevices }));
                  }}
                  onCleanWorkspace={handleCleanWorkspace}
                  onViewRunningProfiles={() => setActiveTab('running')}
                />
              )}

              {activeTab === 'fingerprint-sessions' && (
                <FingerprintSessionView
                  devices={state.devices}
                  selectedDeviceId={selectedDeviceId}
                  onSelectDevice={setSelectedDeviceId}
                  onUpdateDevice={async (id, payload) => {
                    const res = await api.updateDevice(id, payload);
                    setState((prev) => ({ ...prev, devices: res.devices }));
                  }}
                  onRegenerateFingerprint={async (id) => {
                    const res = await api.regenerateFingerprint(id);
                    setState((prev) => ({
                      ...prev,
                      devices: prev.devices.map((d) =>
                        d.id === res.device.id ? res.device : d
                      ),
                    }));
                  }}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
