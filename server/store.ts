import fs from 'node:fs';
import path from 'node:path';
import type {
  AutomationRunSummary,
  DeviceProfile,
  ProxyEntry,
  RunningProfileState,
  UserAgentEntry,
  WorkspaceState,
} from '../src/types/automation.ts';

const DATA_DIR = process.env.PROFILEGRID_DATA_DIR
  ? path.resolve(process.env.PROFILEGRID_DATA_DIR)
  : path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'studio-store.json');

const initialState: WorkspaceState = {
  userAgents: [],
  proxies: [],
  devices: [],
  runs: [],
  runningProfiles: {},
  activeRunId: null,
};

let state: WorkspaceState = structuredClone(initialState);

function loadStore(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<WorkspaceState>;
      state = {
        userAgents: Array.isArray(parsed.userAgents) ? parsed.userAgents : [],
        proxies: Array.isArray(parsed.proxies) ? parsed.proxies : [],
        devices: Array.isArray(parsed.devices) ? parsed.devices : [],
        runs: Array.isArray(parsed.runs) ? parsed.runs : [],
        runningProfiles:
          parsed.runningProfiles && typeof parsed.runningProfiles === 'object'
            ? parsed.runningProfiles
            : {},
        activeRunId: null,
      };
      // Reset any stale 'running' flags after server restart
      state.devices = state.devices.map((d) =>
        d.status === 'running' ? { ...d, status: 'ready' } : d
      );
      for (const key of Object.keys(state.runningProfiles)) {
        if (state.runningProfiles[key].status === 'running') {
          state.runningProfiles[key].status = 'completed';
        }
      }
    }
  } catch (err) {
    console.error('Failed to load store, starting fresh:', err);
    state = structuredClone(initialState);
  }
}

loadStore();

let saveTimer: NodeJS.Timeout | null = null;
export function persistStore(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist store:', err);
    }
  }, 150);
}

export function getState(): WorkspaceState {
  return state;
}

export function setUserAgents(list: UserAgentEntry[]): void {
  state.userAgents = list;
  persistStore();
}

export function setProxies(list: ProxyEntry[]): void {
  state.proxies = list;
  persistStore();
}

export function setDevices(list: DeviceProfile[]): void {
  state.devices = list;
  persistStore();
}

export function setRuns(list: AutomationRunSummary[]): void {
  state.runs = list;
  persistStore();
}

export function upsertRunningProfile(profile: RunningProfileState): void {
  state.runningProfiles[profile.deviceId] = profile;
  persistStore();
  broadcastEvent('profile_update', profile);
}

export function setActiveRunId(runId: string | null): void {
  state.activeRunId = runId;
}

// SSE Listeners
type SseClient = {
  id: string;
  write: (chunk: string) => void;
};

const sseClients = new Map<string, SseClient>();

export function registerSseClient(id: string, write: (chunk: string) => void): void {
  sseClients.set(id, { id, write });
}

export function unregisterSseClient(id: string): void {
  sseClients.delete(id);
}

export function broadcastEvent(event: string, payload: unknown): void {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients.values()) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client.id);
    }
  }
}

export function cleanDeviceSession(
  device: DeviceProfile,
  preserveStatus = false
): void {
  if (!preserveStatus) {
    device.status = 'ready';
    device.lastRunAt = null;
  }
  device.session = {
    cookies: [],
    localStorage: [],
    sessionStorage: [],
    history: [],
    lastActiveOrigin: null,
  };
}

let workspaceEpoch = 0;

export function getWorkspaceEpoch(): number {
  return workspaceEpoch;
}

export function cleanWorkspace(scope: 'sessions' | 'runs' | 'all'): WorkspaceState {
  workspaceEpoch += 1;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  if (scope === 'all') {
    state = structuredClone(initialState);
    try {
      if (fs.existsSync(STORE_FILE)) {
        fs.unlinkSync(STORE_FILE);
      }
    } catch (err) {
      console.error('Failed to remove store file:', err);
    }
  } else if (scope === 'runs') {
    state.runs = [];
    state.runningProfiles = {};
    state.activeRunId = null;
    state.devices = state.devices.map((d) => ({
      ...d,
      status: d.status === 'running' ? 'ready' : d.status,
    }));
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist cleaned runs:', err);
    }
  } else {
    // 'sessions': wipe all cookies, storage, history, previews, and run logs while preserving UAs, proxies, and devices
    state.runs = [];
    state.runningProfiles = {};
    state.activeRunId = null;
    for (const dev of state.devices) {
      cleanDeviceSession(dev);
      dev.totalRuns = 0;
      dev.totalClicks = 0;
    }
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist cleaned sessions:', err);
    }
  }

  broadcastEvent('workspace_cleaned', { scope, state });
  return state;
}

