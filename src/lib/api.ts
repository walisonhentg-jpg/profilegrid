import type {
  AutomationConfig,
  AutomationRunSummary,
  DeviceProfile,
  ProxyEntry,
  UserAgentEntry,
  WorkspaceState,
} from '../types/automation.ts';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getState: () => request<WorkspaceState>('/api/state'),

  importUserAgents: (rawText: string, allowDuplicates = true) =>
    request<{
      addedCount: number;
      skippedDuplicates?: number;
      totalParsed?: number;
      userAgents: UserAgentEntry[];
      devices: DeviceProfile[];
    }>('/api/user-agents/import', {
      method: 'POST',
      body: JSON.stringify({ rawText, allowDuplicates }),
    }),

  deleteUserAgent: (id: string) =>
    request<{ userAgents: UserAgentEntry[] }>(`/api/user-agents/${id}`, {
      method: 'DELETE',
    }),

  clearUserAgents: () =>
    request<{ userAgents: UserAgentEntry[] }>('/api/user-agents', {
      method: 'DELETE',
    }),

  importProxies: (
    rawText: string,
    autoCheck = true,
    autoProvision = true,
    allowDuplicates = true,
    repeatCount = 1
  ) =>
    request<{
      addedCount: number;
      skippedCount: number;
      skippedSample: string[];
      proxies: ProxyEntry[];
      devices?: DeviceProfile[];
    }>('/api/proxies/import', {
      method: 'POST',
      body: JSON.stringify({
        rawText,
        autoCheck,
        autoProvision,
        allowDuplicates,
        repeatCount,
      }),
    }),

  checkProxies: (proxyIds?: string[], autoProvision = true) =>
    request<{
      checkedCount: number;
      provisionedCount: number;
      proxies: ProxyEntry[];
      devices: DeviceProfile[];
    }>('/api/proxies/check', {
      method: 'POST',
      body: JSON.stringify({ proxyIds, autoProvision }),
    }),

  deleteProxy: (id: string) =>
    request<{ proxies: ProxyEntry[]; devices?: DeviceProfile[] }>(`/api/proxies/${id}`, {
      method: 'DELETE',
    }),

  clearProxies: () =>
    request<{ proxies: ProxyEntry[]; devices?: DeviceProfile[] }>('/api/proxies', {
      method: 'DELETE',
    }),

  provisionDevices: (proxyIds?: string[]) =>
    request<{ createdCount: number; devices: DeviceProfile[] }>(
      '/api/devices/provision',
      { method: 'POST', body: JSON.stringify({ proxyIds }) }
    ),

  createDevice: (payload: { name?: string; userAgentId?: string; proxyId?: string | null }) =>
    request<{ device: DeviceProfile; devices: DeviceProfile[] }>('/api/devices', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateDevice: (id: string, payload: Partial<DeviceProfile>) =>
    request<{ device: DeviceProfile; devices: DeviceProfile[] }>(`/api/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  regenerateFingerprint: (id: string) =>
    request<{ device: DeviceProfile }>(`/api/devices/${id}/regenerate-fingerprint`, {
      method: 'POST',
    }),

  deleteDevice: (id: string) =>
    request<{ devices: DeviceProfile[] }>(`/api/devices/${id}`, { method: 'DELETE' }),

  clearDevices: () =>
    request<{ devices: DeviceProfile[] }>('/api/devices', { method: 'DELETE' }),

  resetDevicesStatus: () =>
    request<{ resetCount: number; devices: DeviceProfile[] }>('/api/devices/reset-status', {
      method: 'POST',
    }),

  startAutomation: (config: AutomationConfig) =>
    request<{ summary: AutomationRunSummary }>('/api/automation/run', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  stopAutomation: () => request<{ ok: boolean }>('/api/automation/stop', { method: 'POST' }),

  getBrowserStatus: (customPath?: string) =>
    request<{
      available: boolean;
      executablePath: string | null;
      name: string | null;
      platform?: string;
    }>(
      `/api/automation/browser-status${
        customPath?.trim()
          ? `?customPath=${encodeURIComponent(customPath.trim())}`
          : ''
      }`
    ),

  getMacStatus: () =>
    request<{
      platform: string;
      canRotateOsMac: boolean;
      isAdmin: boolean;
      adapterName: string | null;
      interfaceDescription?: string | null;
      ipv4?: string | null;
      currentMac: string | null;
      reason?: string;
    }>('/api/system/mac-status'),

  rotateMacAddress: () =>
    request<{
      rotation: {
        changed: boolean;
        isAdmin: boolean;
        adapterName: string | null;
        previousMac: string | null;
        newMac: string | null;
        message: string;
      };
      status: {
        platform: string;
        canRotateOsMac: boolean;
        isAdmin: boolean;
        adapterName: string | null;
        interfaceDescription?: string | null;
        ipv4?: string | null;
        currentMac: string | null;
        reason?: string;
      };
      devices: DeviceProfile[];
    }>('/api/system/mac-rotate', { method: 'POST' }),

  cleanWorkspace: (scope: 'sessions' | 'runs' | 'all' = 'sessions') =>
    request<{ ok: boolean; scope: string; state: WorkspaceState }>(
      '/api/workspace/clean',
      { method: 'POST', body: JSON.stringify({ scope }) }
    ),

  loadSamplePack: () =>
    request<{ state: WorkspaceState; createdDevices: DeviceProfile[] }>(
      '/api/sample-pack',
      { method: 'POST' }
    ),

  validateEmails: (rawText: string) =>
    request<{
      validEmails: string[];
      invalidEmails: string[];
      mxVerifiedDomains: string[];
      mxChecked: boolean;
      totalParsed: number;
    }>('/api/emails/validate', {
      method: 'POST',
      body: JSON.stringify({ rawText }),
    }),
};
