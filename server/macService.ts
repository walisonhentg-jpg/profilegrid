import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface SystemMacStatus {
  platform: NodeJS.Platform;
  canRotateOsMac: boolean;
  isAdmin: boolean;
  adapterName: string | null;
  interfaceDescription?: string | null;
  ipv4?: string | null;
  currentMac: string | null;
  reason?: string;
}

export interface MacRotationResult {
  changed: boolean;
  isAdmin: boolean;
  adapterName: string | null;
  previousMac: string | null;
  newMac: string | null;
  message: string;
}

export function generateWindowsCompatibleMac(): { formatted: string; hex12: string } {
  const buf = crypto.randomBytes(6);
  // Windows Intel/Realtek/Qualcomm Wi-Fi & Ethernet drivers require locally-administered unicast MAC:
  // bit 0 (multicast) = 0, bit 1 (locally administered) = 1 -> 2nd hex nibble is 2, 6, A, or E
  buf[0] = (buf[0] & 0xfc) | 0x02;
  const bytes = Array.from(buf).map((b) => b.toString(16).toUpperCase().padStart(2, '0'));
  return {
    formatted: bytes.join(':'),
    hex12: bytes.join(''),
  };
}

function normalizeMacDisplay(raw?: string | null): string | null {
  if (!raw) return null;
  const hex = raw.replace(/[^a-f0-9]/gi, '').toUpperCase();
  if (hex.length !== 12) return raw.trim() || null;
  return hex.match(/.{2}/g)?.join(':') ?? raw.trim();
}

function readNodeActiveNicMac(): {
  adapterName: string | null;
  ipv4: string | null;
  currentMac: string | null;
} {
  const ifaces = os.networkInterfaces();
  const names = Object.keys(ifaces).sort((a, b) => {
    const aScore = /wi-?fi|wlan|eth|en\d|local area|broadband|cellular|rndis/i.test(a) ? 0 : 1;
    const bScore = /wi-?fi|wlan|eth|en\d|local area|broadband|cellular|rndis/i.test(b) ? 0 : 1;
    return aScore - bScore;
  });

  for (const name of names) {
    if (
      /loopback|vethernet|vmware|virtualbox|vbox|hyper-v|bluetooth|teredo|isatap|tailscale|wireguard|tun|tap/i.test(
        name
      )
    ) {
      continue;
    }
    const entries = ifaces[name] || [];
    const ipv4Entry = entries.find((e) => !e.internal && e.family === 'IPv4');
    const anyEntry = ipv4Entry ?? entries.find((e) => !e.internal);
    if (anyEntry && anyEntry.mac && anyEntry.mac !== '00:00:00:00:00:00') {
      return {
        adapterName: name,
        ipv4: ipv4Entry?.address ?? null,
        currentMac: normalizeMacDisplay(anyEntry.mac),
      };
    }
  }
  return { adapterName: null, ipv4: null, currentMac: null };
}

async function isWindowsAdmin(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    await execFileAsync('net', ['session'], { timeout: 3000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function runEncodedPowerShell(script: string, timeoutMs = 20000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout: timeoutMs, windowsHide: true }
  );
  return stdout.trim();
}

async function waitForInternetRecovery(maxWaitMs = 12000): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = net.createConnection({ host: '1.1.1.1', port: 443, timeout: 1500 });
      sock.once('connect', () => {
        sock.destroy();
        resolve(true);
      });
      sock.once('timeout', () => {
        sock.destroy();
        resolve(false);
      });
      sock.once('error', () => {
        sock.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 450));
  }
  return false;
}

export async function getActiveNetworkMacInfo(): Promise<SystemMacStatus> {
  const nodeNic = readNodeActiveNicMac();

  if (process.platform !== 'win32') {
    return {
      platform: process.platform,
      canRotateOsMac: false,
      isAdmin: false,
      adapterName: nodeNic.adapterName,
      interfaceDescription: null,
      ipv4: nodeNic.ipv4,
      currentMac: nodeNic.currentMac,
      reason:
        'Internet NIC MAC change runs inside ProfileGrid.exe on Windows PC; profile virtual MACs rotate on every platform.',
    };
  }

  const admin = await isWindowsAdmin();
  try {
    const psOut = await runEncodedPowerShell(
      `
      $routes = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric, InterfaceMetric
      $ad = $null
      foreach ($r in $routes) {
        $cand = Get-NetAdapter -InterfaceIndex $r.InterfaceIndex -ErrorAction SilentlyContinue
        if ($cand -and $cand.Status -eq 'Up' -and $cand.Name -notmatch 'Loopback|vEthernet|VMware|VirtualBox|WireGuard|Tailscale|Bluetooth') {
          $ad = $cand
          break
        }
      }
      if (-not $ad) {
        $ad = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -and -not $_.Virtual -and $_.Name -notmatch 'Bluetooth|Loopback' } | Select-Object -First 1
      }
      if ($ad) {
        $ipObj = Get-NetIPAddress -InterfaceIndex $ad.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1
        @{ name = $ad.Name; desc = $ad.InterfaceDescription; mac = $ad.MacAddress; ipv4 = $ipObj.IPAddress; status = [string]$ad.Status } | ConvertTo-Json -Compress
      }
      `,
      6000
    );
    if (psOut) {
      const parsed = JSON.parse(psOut) as {
        name?: string;
        desc?: string;
        mac?: string;
        ipv4?: string;
      };
      return {
        platform: process.platform,
        canRotateOsMac: true,
        isAdmin: admin,
        adapterName: parsed.name || nodeNic.adapterName,
        interfaceDescription: parsed.desc || null,
        ipv4: parsed.ipv4 || nodeNic.ipv4,
        currentMac: normalizeMacDisplay(parsed.mac) || nodeNic.currentMac,
        reason: admin
          ? undefined
          : 'Will prompt Windows permission (UAC) once to update Internet NIC MAC, or open ProfileGrid.exe as Administrator.',
      };
    }
  } catch {
    // Fall back to Node interface inspection
  }

  return {
    platform: process.platform,
    canRotateOsMac: true,
    isAdmin: admin,
    adapterName: nodeNic.adapterName,
    interfaceDescription: null,
    ipv4: nodeNic.ipv4,
    currentMac: nodeNic.currentMac,
    reason: admin
      ? undefined
      : 'Will prompt Windows permission (UAC) once to update Internet NIC MAC, or open ProfileGrid.exe as Administrator.',
  };
}

export async function rotateWindowsAdapterMac(targetMac?: string): Promise<MacRotationResult> {
  const before = await getActiveNetworkMacInfo();
  const nextMac = targetMac
    ? {
        formatted: normalizeMacDisplay(targetMac) || generateWindowsCompatibleMac().formatted,
        hex12: targetMac.replace(/[^a-f0-9]/gi, '').toUpperCase().slice(0, 12),
      }
    : generateWindowsCompatibleMac();

  if (process.platform !== 'win32') {
    return {
      changed: false,
      isAdmin: false,
      adapterName: before.adapterName,
      previousMac: before.currentMac,
      newMac: null,
      message:
        'Cloud Linux server cannot modify your PC internet adapter MAC; run ProfileGrid.exe on Windows PC for real Internet NIC MAC rotation.',
    };
  }

  const outFile = path.join(
    os.tmpdir(),
    `pg_mac_rot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.json`
  );
  const scriptFile = path.join(
    os.tmpdir(),
    `pg_mac_rot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.ps1`
  );

  const psBody = `
$ErrorActionPreference = 'Stop'
try {
  $routes = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric, InterfaceMetric
  $ad = $null
  foreach ($r in $routes) {
    $cand = Get-NetAdapter -InterfaceIndex $r.InterfaceIndex -ErrorAction SilentlyContinue
    if ($cand -and $cand.Status -eq 'Up' -and $cand.Name -notmatch 'Loopback|vEthernet|VMware|VirtualBox|WireGuard|Tailscale|Bluetooth') {
      $ad = $cand
      break
    }
  }
  if (-not $ad) {
    $ad = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -and -not $_.Virtual -and $_.Name -notmatch 'Bluetooth|Loopback' } | Select-Object -First 1
  }
  if (-not $ad) {
    throw 'No active physical internet adapter (Wi-Fi/Ethernet) found'
  }
  $prevMac = $ad.MacAddress
  $guid = $ad.InterfaceGuid
  $classPath = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e972-e325-11ce-bfc1-08002be10318}'
  $regKey = Get-ChildItem $classPath -ErrorAction SilentlyContinue | Where-Object {
    try { (Get-ItemProperty $_.PSPath -Name NetCfgInstanceId -ErrorAction Stop).NetCfgInstanceId -eq $guid } catch { $false }
  } | Select-Object -First 1
  if (-not $regKey) {
    throw ('Adapter registry key not found for ' + $ad.Name)
  }
  Set-ItemProperty -Path $regKey.PSPath -Name 'NetworkAddress' -Value '${nextMac.hex12}' -Type String
  Restart-NetAdapter -Name $ad.Name -Confirm:$false
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 450
    $cur = Get-NetAdapter -Name $ad.Name -ErrorAction SilentlyContinue
    $ipReady = Get-NetIPAddress -InterfaceIndex $ad.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred' }
    $gwReady = Get-NetRoute -InterfaceIndex $ad.InterfaceIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue
  } while ((-not $cur -or $cur.Status -ne 'Up' -or -not $ipReady -or -not $gwReady) -and (Get-Date) -lt $deadline)
  Start-Sleep -Milliseconds 500
  $after = Get-NetAdapter -Name $ad.Name
  @{ ok = $true; name = $after.Name; prevMac = $prevMac; newMac = $after.MacAddress; status = [string]$after.Status } | ConvertTo-Json -Compress | Out-File -FilePath '${outFile.replace(/'/g, "''")}' -Encoding UTF8
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress | Out-File -FilePath '${outFile.replace(/'/g, "''")}' -Encoding UTF8
}
`;

  try {
    fs.writeFileSync(scriptFile, psBody, 'utf8');

    if (before.isAdmin) {
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile],
        { timeout: 30000, windowsHide: true }
      );
    } else {
      // Trigger clean Windows UAC elevation for this adapter MAC update only
      const launcherCmd = `Start-Process powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','${scriptFile.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden`;
      await runEncodedPowerShell(launcherCmd, 40000);
    }

    if (!fs.existsSync(outFile)) {
      return {
        changed: false,
        isAdmin: before.isAdmin,
        adapterName: before.adapterName,
        previousMac: before.currentMac,
        newMac: null,
        message:
          'Windows UAC permission was cancelled — keeping current Internet NIC MAC (profile virtual MAC still rotated).',
      };
    }

    const rawJson = fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '').trim();
    const parsed = JSON.parse(rawJson) as {
      ok?: boolean;
      name?: string;
      prevMac?: string;
      newMac?: string;
      error?: string;
    };

    if (!parsed.ok) {
      return {
        changed: false,
        isAdmin: before.isAdmin,
        adapterName: before.adapterName,
        previousMac: before.currentMac,
        newMac: null,
        message: `Internet MAC update skipped (${parsed.error || 'driver restriction'}); profile MAC rotated`,
      };
    }

    // Confirm internet link actually passes traffic before letting proxies start
    await waitForInternetRecovery(10000);

    const prevDisplay = normalizeMacDisplay(parsed.prevMac) || before.currentMac;
    const newDisplay = normalizeMacDisplay(parsed.newMac) || nextMac.formatted;
    const changed = Boolean(prevDisplay && newDisplay && prevDisplay !== newDisplay);

    return {
      changed,
      isAdmin: true,
      adapterName: parsed.name || before.adapterName,
      previousMac: prevDisplay,
      newMac: newDisplay,
      message: changed
        ? `Real Internet NIC MAC changed (${parsed.name}): ${prevDisplay} -> ${newDisplay}`
        : `Adapter ${parsed.name || 'NIC'} kept ${newDisplay} (hardware/driver lock); profile MAC rotated`,
    };
  } catch (err) {
    return {
      changed: false,
      isAdmin: before.isAdmin,
      adapterName: before.adapterName,
      previousMac: before.currentMac,
      newMac: null,
      message: `Internet MAC update skipped (${err instanceof Error ? err.message : 'permission cancelled'}); profile MAC rotated`,
    };
  } finally {
    try {
      if (fs.existsSync(scriptFile)) fs.unlinkSync(scriptFile);
      if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}
