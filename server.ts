import 'dotenv/config';
import express from 'express';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { generateFingerprint } from './src/lib/fingerprint.ts';
import { parseUserAgent, PRESET_USER_AGENTS } from './src/lib/uaParser.ts';
import {
  startAutomationCampaign,
  stopActiveAutomation,
} from './server/automationEngine.ts';
import { detectLocalBrowser } from './server/browserEngine.ts';
import {
  getActiveNetworkMacInfo,
  rotateWindowsAdapterMac,
} from './server/macService.ts';
import {
  parseProxyInput,
  parseProxyLine,
  provisionAllDevicesForce,
  provisionDevicesFromProxies,
  syncDeviceProxyMetadata,
  upgradeDirectOrBrokenDevices,
  verifySingleProxy,
} from './server/proxyService.ts';
import { collectProjectFiles, createZipBuffer } from './server/zipBuilder.ts';
import {
  broadcastEvent,
  cleanWorkspace,
  getState,
  persistStore,
  registerSseClient,
  setDevices,
  setProxies,
  setUserAgents,
  unregisterSseClient,
} from './server/store.ts';
import type {
  AutomationConfig,
  DeviceProfile,
  ProxyEntry,
} from './src/types/automation.ts';

const BASE_DIR = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Workspace State
  app.get('/api/state', (_req, res) => {
    res.json(getState());
  });

  // SSE Stream for live Running Profiles & Proxy verification
  app.get('/api/automation/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const clientId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    registerSseClient(clientId, (chunk) => res.write(chunk));

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        res.write(`: heartbeat\n\n`);
      } catch {
        clearInterval(keepAlive);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unregisterSseClient(clientId);
    });
  });

  // User-Agents Import
  app.post('/api/user-agents/import', (req, res) => {
    const { rawText, list, autoProvision = true } = req.body as {
      rawText?: string;
      list?: string[];
      autoProvision?: boolean;
    };
    const lines = Array.isArray(list)
      ? list
      : typeof rawText === 'string'
        ? rawText.split(/\r?\n/)
        : [];

    const store = getState();
    const existingRaw = new Set(store.userAgents.map((u) => u.raw));
    const added = [];

    for (const line of lines) {
      const cleaned = line.trim();
      if (!cleaned || cleaned.startsWith('#') || existingRaw.has(cleaned)) continue;
      existingRaw.add(cleaned);
      added.push(parseUserAgent(cleaned));
    }

    if (added.length > 0) {
      setUserAgents([...added, ...store.userAgents]);
      const cur = getState();
      if (autoProvision && (cur.proxies.length === 0 || cur.proxies.some((p) => p.status !== 'offline'))) {
        provisionAllDevicesForce();
      }
    }
    res.json({
      addedCount: added.length,
      added,
      userAgents: getState().userAgents,
      devices: getState().devices,
    });
  });

  app.delete('/api/user-agents/:id', (req, res) => {
    const store = getState();
    setUserAgents(store.userAgents.filter((u) => u.id !== req.params.id));
    res.json({ userAgents: getState().userAgents });
  });

  app.delete('/api/user-agents', (_req, res) => {
    setUserAgents([]);
    res.json({ userAgents: [] });
  });

  // Proxies Import
  app.post('/api/proxies/import', async (req, res) => {
    const {
      rawText,
      autoCheck = true,
      autoProvision = true,
      allowDuplicates = true,
      repeatCount = 1,
    } = req.body as {
      rawText?: string;
      autoCheck?: boolean;
      autoProvision?: boolean;
      allowDuplicates?: boolean;
      repeatCount?: number;
    };

    const { entries: parsedEntries, skippedLines } = parseProxyInput(
      typeof rawText === 'string' ? rawText : ''
    );
    const store = getState();
    const existingRaw = new Set(store.proxies.map((p) => p.raw));
    const added: ProxyEntry[] = [];
    const multiplier = Math.max(1, Math.min(Number(repeatCount) || 1, 100));

    for (const baseEntry of parsedEntries) {
      if (!allowDuplicates && baseEntry.protocol !== 'direct' && existingRaw.has(baseEntry.raw)) {
        continue;
      }
      existingRaw.add(baseEntry.raw);
      for (let m = 0; m < multiplier; m++) {
        const cloned =
          m === 0
            ? baseEntry
            : parseProxyLine(baseEntry.raw) ?? {
                ...baseEntry,
                id: `${baseEntry.id}_${m}`,
              };
        added.push(cloned);
      }
    }

    if (added.length > 0) {
      const hasNewRealProxies = added.some((p) => p.protocol !== 'direct');
      const baseExisting = hasNewRealProxies
        ? store.proxies.filter((p) => p.protocol !== 'direct')
        : store.proxies;
      setProxies([...added, ...baseExisting]);

      // Immediately bind/upgrade direct or broken devices to imported proxies so campaigns never leak local IP
      const addedIds = added.map((p) => p.id);
      upgradeDirectOrBrokenDevices(addedIds);
      if (autoProvision && getState().userAgents.length > 0) {
        provisionAllDevicesForce();
      }
      broadcastEvent('devices_synced', getState().devices);
    }

    res.json({
      addedCount: added.length,
      skippedCount: skippedLines.length,
      skippedSample: skippedLines.slice(0, 3),
      added,
      proxies: getState().proxies,
      devices: getState().devices,
    });

    if (autoCheck && added.length > 0) {
      void (async () => {
        const batchSize = 10;
        for (let i = 0; i < added.length; i += batchSize) {
          await Promise.all(added.slice(i, i + batchSize).map((p) => verifySingleProxy(p)));
        }
        upgradeDirectOrBrokenDevices(added.map((p) => p.id));
        if (autoProvision) {
          provisionDevicesFromProxies(added.map((p) => p.id));
        }
        broadcastEvent('devices_synced', getState().devices);
      })();
    }
  });

  // Check Proxies
  app.post('/api/proxies/check', async (req, res) => {
    const { proxyIds, autoProvision = true } = req.body as {
      proxyIds?: string[];
      autoProvision?: boolean;
    };
    const store = getState();
    const targets =
      Array.isArray(proxyIds) && proxyIds.length > 0
        ? store.proxies.filter((p) => proxyIds.includes(p.id))
        : store.proxies.filter((p) => p.status === 'unchecked' || p.status === 'offline');

    const batchSize = 10;
    for (let i = 0; i < targets.length; i += batchSize) {
      await Promise.all(targets.slice(i, i + batchSize).map((p) => verifySingleProxy(p)));
    }

    let provisioned: DeviceProfile[] = [];
    if (autoProvision) {
      provisioned = provisionDevicesFromProxies(targets.map((p) => p.id));
    } else {
      upgradeDirectOrBrokenDevices(targets.map((p) => p.id));
    }
    broadcastEvent('devices_synced', getState().devices);

    res.json({
      checkedCount: targets.length,
      provisionedCount: provisioned.length,
      proxies: getState().proxies,
      devices: getState().devices,
    });
  });

  app.delete('/api/proxies/:id', (req, res) => {
    const store = getState();
    setProxies(store.proxies.filter((p) => p.id !== req.params.id));
    for (const dev of getState().devices) {
      if (dev.proxyId === req.params.id) {
        syncDeviceProxyMetadata(dev, null);
      }
    }
    upgradeDirectOrBrokenDevices();
    persistStore();
    broadcastEvent('devices_synced', getState().devices);
    res.json({ proxies: getState().proxies, devices: getState().devices });
  });

  app.delete('/api/proxies', (_req, res) => {
    setProxies([]);
    for (const dev of getState().devices) {
      if (dev.proxyId !== null || dev.proxy !== null) {
        syncDeviceProxyMetadata(dev, null);
      }
    }
    persistStore();
    broadcastEvent('devices_synced', getState().devices);
    res.json({ proxies: [], devices: getState().devices });
  });

  // Auto-provision Devices from online proxies + UA pool
  app.post('/api/devices/provision', (req, res) => {
    const { proxyIds, forceAll = true } = (req.body || {}) as {
      proxyIds?: string[];
      forceAll?: boolean;
    };
    const created =
      proxyIds && proxyIds.length > 0
        ? provisionDevicesFromProxies(proxyIds)
        : forceAll
          ? provisionAllDevicesForce()
          : provisionDevicesFromProxies();
    res.json({
      createdCount: created.length,
      created,
      devices: getState().devices,
    });
  });

  // Manual Device Create
  app.post('/api/devices', (req, res) => {
    const { name, userAgentId, proxyId } = req.body as {
      name?: string;
      userAgentId?: string;
      proxyId?: string | null;
    };
    const store = getState();
    const ua =
      store.userAgents.find((u) => u.id === userAgentId) ??
      store.userAgents[0] ??
      parseUserAgent(PRESET_USER_AGENTS[0]);
    const proxy = proxyId
      ? store.proxies.find((p) => p.id === proxyId) ?? null
      : null;

    if (!store.userAgents.some((u) => u.id === ua.id)) {
      setUserAgents([ua, ...store.userAgents]);
    }

    const fingerprint = generateFingerprint(ua, proxy);
    const num = store.devices.length + 1;
    const device: DeviceProfile = {
      id: `dev_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`,
      name:
        name?.trim() ||
        `Device ${String(num).padStart(2, '0')} · ${ua.os} (${proxy?.countryCode ?? 'DIRECT'})`,
      status: 'ready',
      userAgentId: ua.id,
      userAgent: ua,
      proxyId: proxy?.id ?? null,
      proxy,
      fingerprint,
      session: {
        cookies: [],
        localStorage: [],
        sessionStorage: [],
        history: [],
        lastActiveOrigin: null,
      },
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      totalRuns: 0,
      totalClicks: 0,
    };

    setDevices([device, ...store.devices]);
    res.json({ device, devices: getState().devices });
  });

  // Update Device (Name, Fingerprint, Session Cookies/Storage)
  app.patch('/api/devices/:id', (req, res) => {
    const store = getState();
    const device = store.devices.find((d) => d.id === req.params.id);
    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    const { name, status, fingerprint, session, userAgentId, proxyId } =
      req.body as Partial<DeviceProfile>;
    if (typeof name === 'string' && name.trim()) device.name = name.trim();
    if (status === 'ready' || status === 'off' || status === 'completed') {
      device.status = status;
    }
    if (userAgentId) {
      const foundUa = store.userAgents.find((u) => u.id === userAgentId);
      if (foundUa) {
        device.userAgentId = foundUa.id;
        device.userAgent = foundUa;
        device.fingerprint = generateFingerprint(foundUa, device.proxy);
      }
    }
    if (proxyId !== undefined) {
      const foundProxy = proxyId ? store.proxies.find((p) => p.id === proxyId) ?? null : null;
      device.proxyId = foundProxy?.id ?? null;
      device.proxy = foundProxy;
      device.fingerprint = generateFingerprint(device.userAgent, foundProxy, device.fingerprint.seed);
    }
    if (fingerprint) {
      device.fingerprint = { ...device.fingerprint, ...fingerprint };
    }
    if (session) {
      device.session = { ...device.session, ...session };
    }

    persistStore();
    broadcastEvent('device_updated', device);
    res.json({ device, devices: store.devices });
  });

  // Reset all OFF/completed/error devices back to Ready (ON)
  app.post('/api/devices/reset-status', (_req, res) => {
    const store = getState();
    let count = 0;
    for (const dev of store.devices) {
      if (dev.status !== 'ready' && dev.status !== 'running') {
        dev.status = 'ready';
        count++;
        broadcastEvent('device_updated', dev);
      }
    }
    persistStore();
    res.json({ resetCount: count, devices: store.devices });
  });

  // Regenerate Fingerprint
  app.post('/api/devices/:id/regenerate-fingerprint', (req, res) => {
    const store = getState();
    const device = store.devices.find((d) => d.id === req.params.id);
    if (!device) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    device.fingerprint = generateFingerprint(device.userAgent, device.proxy);
    persistStore();
    broadcastEvent('device_updated', device);
    res.json({ device });
  });

  app.delete('/api/devices/:id', (req, res) => {
    const store = getState();
    setDevices(store.devices.filter((d) => d.id !== req.params.id));
    delete store.runningProfiles[req.params.id];
    persistStore();
    res.json({ devices: getState().devices });
  });

  app.delete('/api/devices', (_req, res) => {
    const store = getState();
    setDevices([]);
    store.runningProfiles = {};
    persistStore();
    res.json({ devices: [] });
  });

  // Automation Run & Stop
  app.post('/api/automation/run', async (req, res) => {
    const config = req.body as AutomationConfig;
    if (!config?.targetUrl) {
      res.status(400).json({ error: 'targetUrl is required' });
      return;
    }
    config.targetUrl = config.targetUrl.trim().replace(/^(https?:\/\/)+(https?:\/\/)/i, '$2');
    try {
      new URL(config.targetUrl);
    } catch {
      res.status(400).json({ error: 'Invalid targetUrl. Include https:// or http://' });
      return;
    }

    const store = getState();
    upgradeDirectOrBrokenDevices();

    if (store.devices.length === 0 && (store.userAgents.length > 0 || store.proxies.length > 0)) {
      provisionAllDevicesForce();
    }

    if (getState().devices.length === 0) {
      const current = getState();
      if (current.userAgents.length === 0 && current.proxies.length > 0) {
        res.status(400).json({
          error:
            'Add your User-Agents in User-Agent Pool first (ProfileGrid creates exact 1-to-1 unique devices from your User-Agents + Proxies, with zero extra presets).',
        });
        return;
      }
      res.status(400).json({
        error:
          "No device profiles available. First import your User-Agents & Proxies or click 'Load Starter Devices' at the top.",
      });
      return;
    }

    const latestStore = getState();
    const hasRealProxies = latestStore.proxies.some((p) => p.protocol !== 'direct');
    const requestedIds =
      Array.isArray(config.deviceIds) && config.deviceIds.length > 0
        ? config.deviceIds
        : latestStore.devices.map((d) => d.id);

    const activeRequestedDevices = latestStore.devices.filter(
      (d) => requestedIds.includes(d.id) && d.status !== 'off'
    );
    if (activeRequestedDevices.length === 0) {
      res.status(400).json({
        error:
          "All targeted devices have already completed and turned OFF. Click 'Turn On All OFF Devices' (or toggle individual devices ON) before running again.",
      });
      return;
    }

    if (hasRealProxies) {
      const proxiedIds = activeRequestedDevices
        .filter((d) => d.proxy && d.proxy.protocol !== 'direct')
        .map((d) => d.id);
      if (proxiedIds.length === 0) {
        res.status(400).json({
          error:
            "None of the active selected devices are bound to an imported proxy. Click 'Check All Proxies' and 'Build All Real Devices' so clicks never run from your local IP.",
        });
        return;
      }
      config.deviceIds = proxiedIds;
    } else {
      config.deviceIds = activeRequestedDevices.map((d) => d.id);
    }

    const summary = await startAutomationCampaign(config);
    res.json({ summary });
  });

  app.post('/api/automation/stop', (_req, res) => {
    stopActiveAutomation();
    res.json({ ok: true });
  });

  app.get('/api/automation/browser-status', (req, res) => {
    const customPath =
      typeof req.query.customPath === 'string' ? req.query.customPath : undefined;
    res.json({
      ...detectLocalBrowser(customPath),
      platform: process.platform,
    });
  });

  // Real System & Device MAC Inspection / Rotation
  app.get('/api/system/mac-status', async (_req, res) => {
    const status = await getActiveNetworkMacInfo();
    res.json(status);
  });

  app.post('/api/system/mac-rotate', async (_req, res) => {
    const rotation = await rotateWindowsAdapterMac();
    const store = getState();
    for (const dev of store.devices) {
      const freshMac = generateFingerprint(dev.userAgent, dev.proxy).macAddress;
      if (freshMac) {
        dev.fingerprint.macAddress = freshMac;
        dev.fingerprint.consistencyNotes = [
          ...dev.fingerprint.consistencyNotes.filter((n) => !n.startsWith('Device MAC (')),
          `Device MAC (${freshMac}) rotated`,
        ];
        broadcastEvent('device_updated', dev);
      }
    }
    persistStore();
    const status = await getActiveNetworkMacInfo();
    res.json({ rotation, status, devices: store.devices });
  });

  // Validate Gmail / email list syntax + DNS MX records
  app.post('/api/emails/validate', async (req, res) => {
    const { rawText } = (req.body || {}) as { rawText?: string };
    const tokens = (typeof rawText === 'string' ? rawText : '')
      .split(/[\r\n,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const seen = new Set<string>();
    const unique: string[] = [];
    for (const token of tokens) {
      if (!seen.has(token)) {
        seen.add(token);
        unique.push(token);
      }
    }

    const syntaxValid: string[] = [];
    const invalidEmails: string[] = [];

    for (const email of unique) {
      const atIdx = email.indexOf('@');
      if (atIdx <= 0 || atIdx !== email.lastIndexOf('@')) {
        invalidEmails.push(email);
        continue;
      }
      const local = email.slice(0, atIdx);
      const domain = email.slice(atIdx + 1);
      if (domain === 'gmail.com' || domain === 'googlemail.com') {
        const baseLocal = local.split('+')[0];
        const okGmail =
          baseLocal.length >= 6 &&
          baseLocal.length <= 30 &&
          /^[a-z0-9](?:\.?[a-z0-9])*$/.test(baseLocal) &&
          (!local.includes('+') || /^[a-z0-9._+-]+$/.test(local));
        if (okGmail) syntaxValid.push(email);
        else invalidEmails.push(email);
      } else {
        const okEmail =
          local.length >= 1 &&
          local.length <= 64 &&
          /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) &&
          /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain);
        if (okEmail) syntaxValid.push(email);
        else invalidEmails.push(email);
      }
    }

    const domains = Array.from(new Set(syntaxValid.map((e) => e.split('@')[1])));
    const mxValidSet = new Set<string>();
    let mxChecked = false;

    await Promise.all(
      domains.slice(0, 12).map(async (domain) => {
        try {
          const mx = await Promise.race([
            dns.resolveMx(domain),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('DNS timeout')), 3000)
            ),
          ]);
          mxChecked = true;
          if (Array.isArray(mx) && mx.length > 0) {
            mxValidSet.add(domain);
          }
        } catch {
          // Offline or blocked DNS: rely on strict syntax for gmail.com fallback
        }
      })
    );

    const validEmails: string[] = [];
    for (const email of syntaxValid) {
      const domain = email.split('@')[1];
      if (!mxChecked || mxValidSet.has(domain)) {
        validEmails.push(email);
      } else {
        invalidEmails.push(email);
      }
    }

    res.json({
      validEmails,
      invalidEmails,
      mxVerifiedDomains: Array.from(mxValidSet),
      mxChecked,
      totalParsed: unique.length,
    });
  });

  // Clean sessions, run logs, or entire workspace
  app.post('/api/workspace/clean', (req, res) => {
    const { scope = 'sessions' } = (req.body || {}) as {
      scope?: 'sessions' | 'runs' | 'all';
    };
    stopActiveAutomation();
    const cleaned = cleanWorkspace(scope);
    res.json({ ok: true, scope, state: cleaned });
  });

  // Quick-Start QA Sample Pack (Real UA Presets + Verified Direct Node -> Auto Devices)
  app.post('/api/sample-pack', async (_req, res) => {
    const store = getState();
    const existingRaw = new Set(store.userAgents.map((u) => u.raw));
    const addedUas = PRESET_USER_AGENTS.slice(0, 6)
      .filter((raw) => !existingRaw.has(raw))
      .map((raw) => parseUserAgent(raw));
    if (addedUas.length > 0) {
      setUserAgents([...addedUas, ...store.userAgents]);
    }

    const directNodes = [parseProxyLine('direct://local'), parseProxyLine('direct://local')]
      .filter((p): p is ProxyEntry => p !== null);

    setProxies([...directNodes, ...getState().proxies]);
    await Promise.all(directNodes.map((p) => verifySingleProxy(p)));

    const createdDevices = provisionDevicesFromProxies(directNodes.map((p) => p.id));
    res.json({
      state: getState(),
      createdDevices,
    });
  });

  // 1-Click Desktop App Bundle Download (.zip)
  app.get('/api/desktop/download', (_req, res) => {
    try {
      const files = collectProjectFiles(BASE_DIR);
      const zipBuffer = createZipBuffer(files);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="ProfileGrid-Windows-Desktop.zip"'
      );
      res.setHeader('Content-Length', String(zipBuffer.length));
      res.send(zipBuffer);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to package desktop archive',
      });
    }
  });

  const EXE_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB chunks (safely under 32 MB proxy limits)

  // Check if compiled Windows .exe exists
  app.get('/api/desktop/status', (_req, res) => {
    const exePath = path.resolve(BASE_DIR, 'dist-desktop', 'ProfileGrid-Portable.exe');
    if (fs.existsSync(exePath)) {
      const stat = fs.statSync(exePath);
      res.json({
        exeAvailable: true,
        exeSizeMb: Math.round((stat.size / (1024 * 1024)) * 10) / 10,
        exeBytes: stat.size,
        chunkSize: EXE_CHUNK_SIZE,
        chunkCount: Math.ceil(stat.size / EXE_CHUNK_SIZE),
      });
    } else {
      res.json({ exeAvailable: false });
    }
  });

  // Chunked Windows .EXE download for Cloud Run / proxy compatibility
  app.get('/api/desktop/exe-chunk/:index', (req, res) => {
    const exePath = path.resolve(BASE_DIR, 'dist-desktop', 'ProfileGrid-Portable.exe');
    if (!fs.existsSync(exePath)) {
      res.status(404).json({ error: 'Windows .exe is not built yet' });
      return;
    }

    const index = Number.parseInt(req.params.index, 10);
    const stat = fs.statSync(exePath);
    const chunkCount = Math.ceil(stat.size / EXE_CHUNK_SIZE);
    if (!Number.isInteger(index) || index < 0 || index >= chunkCount) {
      res.status(400).json({ error: 'Invalid chunk index' });
      return;
    }

    const offset = index * EXE_CHUNK_SIZE;
    const length = Math.min(EXE_CHUNK_SIZE, stat.size - offset);
    const buf = Buffer.allocUnsafe(length);
    const fd = fs.openSync(exePath, 'r');
    try {
      const bytesRead = fs.readSync(fd, buf, 0, length, offset);
      const slice = bytesRead === length ? buf : buf.subarray(0, bytesRead);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', String(slice.length));
      res.send(slice);
    } finally {
      fs.closeSync(fd);
    }
  });

  // Direct Windows .EXE download (uses chunked HTML reassembly for browsers behind 32MB Cloud Run limit)
  app.get('/api/desktop/download-exe', (req, res) => {
    const exePath = path.resolve(BASE_DIR, 'dist-desktop', 'ProfileGrid-Portable.exe');
    if (!fs.existsSync(exePath)) {
      res.status(404).json({ error: 'Windows .exe is not built yet' });
      return;
    }

    const acceptsHtml = (req.headers.accept || '').includes('text/html');
    if (acceptsHtml) {
      const stat = fs.statSync(exePath);
      const chunkCount = Math.ceil(stat.size / EXE_CHUNK_SIZE);
      const sizeMb = (stat.size / (1024 * 1024)).toFixed(1);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Downloading ProfileGrid.exe...</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;max-width:420px;width:90%;box-shadow:0 4px 20px rgba(15,23,42,.06)}
    h1{font-size:18px;margin:0 0 8px}
    p{font-size:13px;color:#475569;margin:0 0 18px}
    .bar{height:10px;background:#e2e8f0;border-radius:99px;overflow:hidden;margin-bottom:10px}
    .fill{height:100%;width:0;background:#2563eb;transition:width .15s}
    .status{font-size:12px;font-family:monospace;color:#334155}
    button{margin-top:16px;padding:9px 14px;border:0;border-radius:8px;background:#0f172a;color:#fff;font-size:12px;font-weight:600;cursor:pointer}
  </style>
</head>
<body>
  <div class="card">
    <h1>ProfileGrid.exe (${sizeMb} MB)</h1>
    <p>Downloading portable Windows desktop app in verified chunks...</p>
    <div class="bar"><div class="fill" id="fill"></div></div>
    <div class="status" id="status">Starting download (0/${chunkCount})...</div>
    <button id="retry" style="display:none" onclick="start()">Download ProfileGrid.exe Again</button>
  </div>
  <script>
    async function start() {
      const total = ${chunkCount};
      const fill = document.getElementById('fill');
      const status = document.getElementById('status');
      const retry = document.getElementById('retry');
      retry.style.display = 'none';
      const parts = [];
      try {
        for (let i = 0; i < total; i++) {
          status.textContent = 'Downloading chunk ' + (i + 1) + ' / ' + total + '...';
          const r = await fetch('/api/desktop/exe-chunk/' + i);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          parts.push(await r.arrayBuffer());
          fill.style.width = Math.round(((i + 1) / total) * 100) + '%';
        }
        status.textContent = 'Saving ProfileGrid.exe...';
        const blob = new Blob(parts, { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ProfileGrid.exe';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        status.textContent = 'Download complete! Check your Downloads folder for ProfileGrid.exe.';
        retry.style.display = 'inline-block';
      } catch (e) {
        status.textContent = 'Error: ' + (e && e.message ? e.message : 'Download failed');
        retry.style.display = 'inline-block';
      }
    }
    start();
  </script>
</body>
</html>`);
      return;
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="ProfileGrid.exe"');
    fs.createReadStream(exePath).pipe(res);
  });

  // Vite or Static Frontend
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = process.env.PROFILEGRID_DIST_DIR
      ? path.resolve(process.env.PROFILEGRID_DIST_DIR)
      : path.resolve(BASE_DIR, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  app.listen(PORT, HOST, () => {
    console.log(`ProfileGrid server listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
