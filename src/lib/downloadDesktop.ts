export interface DesktopStatus {
  exeAvailable: boolean;
  exeSizeMb?: number;
  exeBytes?: number;
  chunkSize?: number;
  chunkCount?: number;
}

export async function checkExeAvailable(): Promise<DesktopStatus> {
  try {
    const res = await fetch('/api/desktop/status');
    if (!res.ok) return { exeAvailable: false };
    return (await res.json()) as DesktopStatus;
  } catch {
    return { exeAvailable: false };
  }
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function downloadDesktopExe(
  onProgress?: (percent: number) => void
): Promise<void> {
  const status = await checkExeAvailable();
  if (!status.exeAvailable || !status.chunkCount) {
    throw new Error('Windows .EXE build is not ready yet');
  }

  const total = status.chunkCount;
  const parts: ArrayBuffer[] = [];
  onProgress?.(0);

  for (let i = 0; i < total; i++) {
    const res = await fetch(`/api/desktop/exe-chunk/${i}`);
    if (!res.ok) {
      throw new Error(`Chunk ${i + 1}/${total} failed (${res.status})`);
    }
    parts.push(await res.arrayBuffer());
    onProgress?.(Math.round(((i + 1) / total) * 100));
  }

  const blob = new Blob(parts, { type: 'application/octet-stream' });
  triggerBlobDownload(blob, 'ProfileGrid.exe');
}

export async function downloadDesktopZip(): Promise<void> {
  const res = await fetch('/api/desktop/download');
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const blob = await res.blob();
  triggerBlobDownload(blob, 'ProfileGrid-Windows-Desktop.zip');
}
