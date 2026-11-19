import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { generateFingerprint } from '../src/lib/fingerprint.ts';
import type {
  DeviceProfile,
  ProxyEntry,
  ProxyProtocol,
  UserAgentEntry,
} from '../src/types/automation.ts';
import { broadcastEvent, getState, getWorkspaceEpoch, persistStore } from './store.ts';

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

const COUNTRY_LANG: Record<string, string> = {
  US: 'en-US',
  GB: 'en-GB',
  CA: 'en-CA',
  DE: 'de-DE',
  FR: 'fr-FR',
  NL: 'nl-NL',
  SG: 'en-SG',
  JP: 'ja-JP',
  IN: 'en-IN',
  BD: 'bn-BD',
  AU: 'en-AU',
  BR: 'pt-BR',
};

function isValidPort(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n <= 65535;
}

function normalizeProtocol(protoRaw: string): ProxyProtocol {
  const p = protoRaw.toLowerCase();
  if (p === 'https') return 'https';
  if (p === 'socks4') return 'socks4';
  if (p === 'socks5' || p === 'socks5h' || p === 'socks') return 'socks5';
  return 'http';
}

export function parseProxyInput(rawText: string): {
  entries: ProxyEntry[];
  skippedLines: string[];
} {
  const entries: ProxyEntry[] = [];
  const skippedLines: string[] = [];

  // Split by newlines, commas, or semicolons, then handle space-separated proxy tokens on a line
  const rawChunks = rawText.split(/[\r\n,;]+/);
  for (const chunk of rawChunks) {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Remove optional numbered list prefix like "1. " or "1) " or "- "
    const withoutPrefix = trimmed.replace(/^(?:\d+[.)]\s+|[-*]\s+)/, '').trim();
    // If multiple whitespace-separated proxy tokens exist on one line (and not tab-columns of a single proxy)
    const tokens = withoutPrefix.includes('\t')
      ? [withoutPrefix.replace(/\t+/g, ':')]
      : withoutPrefix.split(/\s+/).filter(Boolean);

    for (const token of tokens) {
      const parsed = parseProxyLine(token);
      if (parsed) {
        entries.push(parsed);
      } else {
        skippedLines.push(token);
      }
    }
  }

  return { entries, skippedLines };
}

export function parseProxyLine(line: string): ProxyEntry | null {
  const raw = line.trim().replace(/\/+$/, '');
  if (!raw || raw.startsWith('#')) return null;

  if (raw.toLowerCase() === 'direct://local' || raw.toLowerCase() === 'direct') {
    return {
      id: uid('px'),
      raw: 'direct://local',
      protocol: 'direct',
      host: 'local-exit',
      port: 0,
      status: 'unchecked',
      latencyMs: null,
      exitIp: null,
      country: null,
      countryCode: null,
      region: null,
      city: null,
      isp: null,
      timezone: null,
      language: null,
      lat: null,
      lon: null,
      error: null,
      checkedAt: null,
    };
  }

  let protocol: ProxyProtocol = 'http';
  let host = '';
  let port = 8080;
  let username: string | undefined;
  let password: string | undefined;

  let body = raw;
  const protoMatch = body.match(/^(https?|socks4|socks5h?|socks):\/\//i);
  if (protoMatch) {
    protocol = normalizeProtocol(protoMatch[1]);
    body = body.slice(protoMatch[0].length);
  }

  try {
    if (body.includes('@')) {
      // Split on LAST '@' so passwords containing '@' still work
      const atIdx = body.lastIndexOf('@');
      const left = body.slice(0, atIdx);
      const right = body.slice(atIdx + 1);
      const leftParts = left.split(':');
      const rightParts = right.split(':');

      // Format A: user:pass@host:port
      if (rightParts.length >= 2 && isValidPort(Number(rightParts[rightParts.length - 1]))) {
        port = Number(rightParts[rightParts.length - 1]);
        host = rightParts.slice(0, -1).join(':').replace(/^\[|\]$/g, '');
        if (leftParts.length >= 2) {
          username = decodeURIComponent(leftParts[0]);
          password = decodeURIComponent(leftParts.slice(1).join(':'));
        } else if (left) {
          username = decodeURIComponent(left);
        }
      }
      // Format B: host:port@user:pass
      else if (leftParts.length === 2 && isValidPort(Number(leftParts[1]))) {
        host = leftParts[0];
        port = Number(leftParts[1]);
        username = decodeURIComponent(rightParts[0] || '');
        password = decodeURIComponent(rightParts.slice(1).join(':'));
      } else {
        return null;
      }
    } else {
      const parts = body.split(':');
      if (parts.length === 2) {
        // host:port
        host = parts[0];
        port = Number(parts[1]);
      } else if (parts.length === 4) {
        const p1 = Number(parts[1]);
        const p3 = Number(parts[3]);
        if (isValidPort(p1) && !isValidPort(p3)) {
          // host:port:user:pass
          host = parts[0];
          port = p1;
          username = parts[2];
          password = parts[3];
        } else if (isValidPort(p3) && !isValidPort(p1)) {
          // user:pass:host:port
          username = parts[0];
          password = parts[1];
          host = parts[2];
          port = p3;
        } else if (isValidPort(p1)) {
          // Ambiguous numeric passwords — prefer standard host:port:user:pass
          host = parts[0];
          port = p1;
          username = parts[2];
          password = parts[3];
        } else {
          return null;
        }
      } else if (parts.length > 4 && isValidPort(Number(parts[1]))) {
        // host:port:user:pass:with:colons
        host = parts[0];
        port = Number(parts[1]);
        username = parts[2];
        password = parts.slice(3).join(':');
      } else {
        return null;
      }
    }
  } catch {
    return null;
  }

  if (!host || !isValidPort(port)) {
    return null;
  }

  return {
    id: uid('px'),
    raw,
    protocol,
    host,
    port,
    username,
    password,
    status: 'unchecked',
    latencyMs: null,
    exitIp: null,
    country: null,
    countryCode: null,
    region: null,
    city: null,
    isp: null,
    timezone: null,
    language: null,
    lat: null,
    lon: null,
    error: null,
    checkedAt: null,
  };
}

export function buildProxyAgent(proxy: ProxyEntry | null) {
  if (!proxy || proxy.protocol === 'direct') return undefined;
  const auth =
    proxy.username && proxy.password
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
      : '';
  const scheme =
    proxy.protocol === 'socks5'
      ? 'socks5h'
      : proxy.protocol === 'socks4'
        ? 'socks4a'
        : proxy.protocol;
  const url = `${scheme}://${auth}${proxy.host}:${proxy.port}`;
  if (proxy.protocol === 'socks4' || proxy.protocol === 'socks5') {
    return new SocksProxyAgent(url, { timeout: 9000 });
  }
  return new HttpsProxyAgent(url, { timeout: 9000 });
}

interface GeoPayload {
  query?: string;
  ip?: string;
  country?: string;
  countryCode?: string;
  country_code?: string;
  regionName?: string;
  region?: string;
  city?: string;
  isp?: string;
  connection?: { isp?: string };
  timezone?: string | { id?: string };
  lat?: number;
  latitude?: number;
  lon?: number;
  longitude?: number;
}

function httpGetJson(url: string, agent?: unknown, timeoutMs = 6000): Promise<GeoPayload> {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const mod = isHttps ? https : http;
    const req = mod.get(
      url,
      {
        agent: agent as http.Agent | undefined,
        timeout: timeoutMs,
        headers: { 'User-Agent': 'ProfileGrid-ProxyVerifier/1.0' },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as GeoPayload);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('ETIMEDOUT'));
    });
    req.on('error', reject);
  });
}

async function resolveGeoIp(ip?: string, agent?: unknown): Promise<GeoPayload | null> {
  // When checking through a proxy agent, require real HTTPS CONNECT tunneling (Chrome needs CONNECT for https:// URLs)
  if (agent && !ip) {
    try {
      const httpsGeo = await httpGetJson('https://ipwho.is/', agent, 7500);
      if (httpsGeo && (httpsGeo.country || httpsGeo.ip)) return httpsGeo;
    } catch {
      // Fallback second HTTPS endpoint before declaring HTTPS tunnel failed
    }

    const ipRes = await httpGetJson('https://api.ipify.org?format=json', agent, 7500);
    if (ipRes?.ip) {
      const directGeo = await resolveGeoIp(ipRes.ip);
      return directGeo
        ? { ...directGeo, query: ipRes.ip, ip: ipRes.ip }
        : { ip: ipRes.ip, query: ipRes.ip };
    }
    throw new Error('HTTPS CONNECT tunnel returned invalid response');
  }

  try {
    const target = ip
      ? `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,timezone,isp,query,lat,lon`
      : `http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,timezone,isp,query,lat,lon`;
    const res = await httpGetJson(target, agent, 5500);
    if (res && (res.country || res.query)) return res;
  } catch {
    // Fallback to ipwho.is
    try {
      const target = ip ? `https://ipwho.is/${encodeURIComponent(ip)}` : `https://ipwho.is/`;
      const res = await httpGetJson(target, agent, 6000);
      if (res && (res.country || res.ip)) return res;
    } catch {
      return null;
    }
  }
  return null;
}

export async function verifySingleProxy(proxy: ProxyEntry): Promise<ProxyEntry> {
  const startEpoch = getWorkspaceEpoch();
  const start = Date.now();
  proxy.status = 'checking';
  proxy.error = null;
  broadcastEvent('proxy_update', proxy);

  try {
    if (proxy.protocol === 'direct') {
      const geo = await resolveGeoIp();
      const latencyMs = Date.now() - start;
      const countryCode = geo?.countryCode || geo?.country_code || 'US';
      Object.assign(proxy, {
        status: 'online',
        latencyMs,
        exitIp: geo?.query || geo?.ip || 'Local Host',
        country: geo?.country || 'United States',
        countryCode,
        region: geo?.regionName || geo?.region || null,
        city: geo?.city || null,
        isp: geo?.isp || geo?.connection?.isp || 'Direct Host Network',
        timezone:
          typeof geo?.timezone === 'string'
            ? geo.timezone
            : geo?.timezone?.id || 'UTC',
        language: COUNTRY_LANG[countryCode] || 'en-US',
        lat: geo?.lat ?? geo?.latitude ?? 37.7749,
        lon: geo?.lon ?? geo?.longitude ?? -122.4194,
        error: null,
        checkedAt: new Date().toISOString(),
      });
      persistStore();
      broadcastEvent('proxy_update', proxy);
      return proxy;
    }

    // 1. Test real HTTPS CONNECT tunnel (if raw proxy had no scheme and http fails, auto-try socks5)
    let geo: GeoPayload | null = null;
    let firstErr: unknown = null;
    const hasExplicitScheme = /^(https?|socks4|socks5h?|socks):\/\//i.test(proxy.raw);

    try {
      geo = await resolveGeoIp(undefined, buildProxyAgent(proxy));
    } catch (err) {
      firstErr = err;
      if (!hasExplicitScheme && proxy.protocol === 'http') {
        const socksCandidate: ProxyEntry = { ...proxy, protocol: 'socks5' };
        try {
          const socksGeo = await resolveGeoIp(undefined, buildProxyAgent(socksCandidate));
          if (socksGeo && (socksGeo.query || socksGeo.ip)) {
            proxy.protocol = 'socks5';
            geo = socksGeo;
          }
        } catch {
          // Keep original error
        }
      }
    }

    const latencyMs = Date.now() - start;
    if (geo && (geo.query || geo.ip)) {
      const countryCode = geo.countryCode || geo.country_code || 'US';
      Object.assign(proxy, {
        status: 'online',
        latencyMs,
        exitIp: geo.query || geo.ip || proxy.host,
        country: geo.country || 'Unknown',
        countryCode,
        region: geo.regionName || geo.region || null,
        city: geo.city || null,
        isp: geo.isp || geo.connection?.isp || null,
        timezone:
          typeof geo.timezone === 'string'
            ? geo.timezone
            : geo.timezone?.id || 'UTC',
        language: COUNTRY_LANG[countryCode] || 'en-US',
        lat: geo.lat ?? geo.latitude ?? null,
        lon: geo.lon ?? geo.longitude ?? null,
        error: null,
        checkedAt: new Date().toISOString(),
      });
      if (getWorkspaceEpoch() !== startEpoch) return proxy;
      // Refresh any existing device bound to this proxy so timezone/locale/geo/name match the verified exit IP
      const store = getState();
      for (const dev of store.devices) {
        if (dev.proxyId === proxy.id) {
          syncDeviceProxyMetadata(dev, proxy);
          broadcastEvent('device_updated', dev);
        }
      }
      persistStore();
      broadcastEvent('proxy_update', proxy);
      return proxy;
    }

    const reason = firstErr instanceof Error ? firstErr.message : 'HTTPS tunnel failed';
    throw new Error(
      `HTTPS CONNECT failed (${reason}) — verify http/socks5 protocol, credentials, or replace proxy`
    );
  } catch (err) {
    if (getWorkspaceEpoch() !== startEpoch) return proxy;
    Object.assign(proxy, {
      status: 'offline',
      latencyMs: null,
      error: err instanceof Error ? err.message : 'Connection failed',
      checkedAt: new Date().toISOString(),
    });
    const store = getState();
    for (const dev of store.devices) {
      if (dev.proxyId === proxy.id) {
        dev.proxy = proxy;
        broadcastEvent('device_updated', dev);
      }
    }
    persistStore();
    broadcastEvent('proxy_update', proxy);
    return proxy;
  }
}

export function syncDeviceProxyMetadata(
  device: DeviceProfile,
  proxy: ProxyEntry | null
): void {
  device.proxyId = proxy?.id ?? null;
  device.proxy = proxy;
  device.fingerprint = generateFingerprint(
    device.userAgent,
    proxy,
    device.fingerprint.seed
  );
  const countryTag = proxy?.countryCode || (proxy ? 'NET' : 'DIRECT');
  const cityTag = proxy?.city ? ` ${proxy.city}` : '';
  const numMatch = device.name.match(/^Device\s+\d+/i);
  const prefix = numMatch ? numMatch[0] : 'Device';
  device.name = `${prefix} · ${device.userAgent.os} (${countryTag}${cityTag})`;
}

export function upgradeDirectOrBrokenDevices(
  candidateProxyIds?: string[]
): DeviceProfile[] {
  const store = getState();
  const realProxies = store.proxies.filter((p) => p.protocol !== 'direct');
  if (realProxies.length === 0) {
    return [];
  }

  const proxyById = new Map(store.proxies.map((p) => [p.id, p]));
  const upgraded: DeviceProfile[] = [];
  const usedProxyIds = new Set<string>();

  // 1. Keep devices already validly bound to a non-offline real proxy and sync latest geo
  for (const dev of store.devices) {
    const bound = dev.proxyId ? proxyById.get(dev.proxyId) : undefined;
    if (bound && bound.protocol !== 'direct' && bound.status !== 'offline') {
      usedProxyIds.add(bound.id);
      if (
        dev.proxy !== bound ||
        (bound.timezone && dev.fingerprint.timezone !== bound.timezone) ||
        (bound.countryCode && !dev.name.includes(`(${bound.countryCode}`))
      ) {
        syncDeviceProxyMetadata(dev, bound);
        broadcastEvent('device_updated', dev);
      }
    }
  }

  // 2. Collect unused usable real proxies (prefer candidateProxyIds & online proxies first)
  const candidateSet =
    candidateProxyIds && candidateProxyIds.length > 0
      ? new Set(candidateProxyIds)
      : null;

  const availableRealProxies = realProxies
    .filter((p) => p.status !== 'offline' && !usedProxyIds.has(p.id))
    .sort((a, b) => {
      const aCand = candidateSet?.has(a.id) ? 1 : 0;
      const bCand = candidateSet?.has(b.id) ? 1 : 0;
      if (aCand !== bCand) return bCand - aCand;
      const aOnline = a.status === 'online' ? 1 : 0;
      const bOnline = b.status === 'online' ? 1 : 0;
      return bOnline - aOnline;
    });

  let changed = false;
  const remainingDevices: DeviceProfile[] = [];

  for (const dev of store.devices) {
    const bound = dev.proxyId ? proxyById.get(dev.proxyId) : undefined;
    const needsUpgrade =
      !bound || bound.protocol === 'direct' || bound.status === 'offline';

    if (!needsUpgrade) {
      remainingDevices.push(dev);
      continue;
    }

    const nextProxy = availableRealProxies.shift();
    if (nextProxy) {
      usedProxyIds.add(nextProxy.id);
      syncDeviceProxyMetadata(dev, nextProxy);
      upgraded.push(dev);
      remainingDevices.push(dev);
      broadcastEvent('device_updated', dev);
      changed = true;
    } else if (!bound || bound.protocol === 'direct') {
      // Remove leftover starter/direct device when real proxies are imported so it never leaks local IP
      delete store.runningProfiles[dev.id];
      changed = true;
    } else {
      // Keep offline proxy attached (will require check/failover rather than falling back to local IP)
      dev.proxy = bound;
      remainingDevices.push(dev);
    }
  }

  if (changed) {
    store.devices = remainingDevices;
    persistStore();
    broadcastEvent('devices_provisioned', upgraded);
    broadcastEvent('devices_synced', store.devices);
  }

  return upgraded;
}

function buildDeviceRecord(
  ua: UserAgentEntry,
  proxy: ProxyEntry | null,
  deviceNumber: number
): DeviceProfile {
  const fingerprint = generateFingerprint(ua, proxy);
  const countryTag = proxy?.countryCode || (proxy ? 'NET' : 'DIRECT');
  const cityTag = proxy?.city ? ` ${proxy.city}` : '';
  const name = `Device ${String(deviceNumber).padStart(2, '0')} · ${ua.os} (${countryTag}${cityTag})`;

  return {
    id: uid('dev'),
    name,
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
}

export function provisionDevicesFromProxies(
  proxyIds?: string[]
): DeviceProfile[] {
  const store = getState();

  // First upgrade any direct/broken/deleted-proxy devices to imported proxies
  const upgraded = upgradeDirectOrBrokenDevices(proxyIds);

  // Never inject extra preset User-Agents — strictly use only what the user provided
  if (store.userAgents.length === 0) {
    return upgraded;
  }

  const hasRealProxies = store.proxies.some((p) => p.protocol !== 'direct');
  const existingProxyIds = new Set(
    store.devices.map((d) => d.proxyId).filter(Boolean)
  );
  const existingUaIds = new Set(store.devices.map((d) => d.userAgentId));

  const unusedUAs = store.userAgents.filter((u) => !existingUaIds.has(u.id));
  const unusedOnlineProxies = store.proxies.filter((p) => {
    if (p.status !== 'online') return false;
    if (hasRealProxies && p.protocol === 'direct') return false;
    if (existingProxyIds.has(p.id)) return false;
    if (proxyIds && proxyIds.length > 0 && !proxyIds.includes(p.id)) return false;
    return true;
  });

  // Strict 1-to-1 unique pairing: zero duplicate UAs, zero duplicate Proxies, zero extra devices
  const pairCount = Math.min(unusedUAs.length, unusedOnlineProxies.length);
  const created: DeviceProfile[] = [];

  for (let i = 0; i < pairCount; i++) {
    const ua = unusedUAs[i];
    const proxy = unusedOnlineProxies[i];
    existingUaIds.add(ua.id);
    existingProxyIds.add(proxy.id);
    created.push(
      buildDeviceRecord(ua, proxy, store.devices.length + created.length + 1)
    );
  }

  if (created.length > 0) {
    store.devices.unshift(...created);
    persistStore();
    broadcastEvent('devices_provisioned', created);
  }

  return [...upgraded, ...created];
}

export function provisionAllDevicesForce(): DeviceProfile[] {
  const store = getState();

  // First upgrade any direct/broken/deleted-proxy devices to real imported proxies
  const upgraded = upgradeDirectOrBrokenDevices();

  // Strictly require user-supplied User-Agents — never invent extra devices
  if (store.userAgents.length === 0) {
    return upgraded;
  }

  const existingUaIds = new Set(store.devices.map((d) => d.userAgentId));
  const existingProxyIds = new Set(store.devices.map((d) => d.proxyId).filter(Boolean));
  const unusedUAs = store.userAgents.filter((u) => !existingUaIds.has(u.id));
  if (unusedUAs.length === 0) {
    return upgraded;
  }

  const created: DeviceProfile[] = [];
  const realProxies = store.proxies.filter((p) => p.protocol !== 'direct');

  if (store.proxies.length === 0) {
    // Only User-Agents provided (0 proxies): build 1 direct device per unique UA
    for (const ua of unusedUAs) {
      existingUaIds.add(ua.id);
      created.push(
        buildDeviceRecord(ua, null, store.devices.length + created.length + 1)
      );
    }
  } else {
    const pool = realProxies.length > 0 ? realProxies : store.proxies;
    // Both UAs and Proxies provided: pair strictly 1-to-1 without repeating any UA or Proxy
    const onlineUnused = pool.filter(
      (p) => p.status === 'online' && !existingProxyIds.has(p.id)
    );
    const uncheckedUnused = pool.filter(
      (p) => (p.status === 'unchecked' || p.status === 'checking') && !existingProxyIds.has(p.id)
    );
    const usableProxies = [...onlineUnused, ...uncheckedUnused];

    const pairCount = Math.min(unusedUAs.length, usableProxies.length);
    for (let i = 0; i < pairCount; i++) {
      const ua = unusedUAs[i];
      const proxy = usableProxies[i];
      existingUaIds.add(ua.id);
      existingProxyIds.add(proxy.id);
      created.push(
        buildDeviceRecord(ua, proxy, store.devices.length + created.length + 1)
      );
    }
  }

  if (created.length > 0) {
    store.devices.unshift(...created);
    persistStore();
    broadcastEvent('devices_provisioned', created);
  }

  return [...upgraded, ...created];
}
