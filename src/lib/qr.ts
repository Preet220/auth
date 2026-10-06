import QRCode from 'qrcode';

export async function generateQrDataUrl(text: string, size: number = 400): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function generateCheckpointCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segmentLength = 4;
  const segments: string[] = [];
  for (let s = 0; s < 3; s++) {
    let seg = '';
    for (let i = 0; i < segmentLength; i++) {
      seg += chars[Math.floor(Math.random() * chars.length)];
    }
    segments.push(seg);
  }
  return `CP-${segments.join('-')}`;
}

/**
 * Open a print window with a grid of QR codes and their labels.
 * Each entry has a dataUrl (QR image) and a label (display name).
 */
export function printQrSheet(
  entries: { dataUrl: string; label: string; value: string }[],
  title: string,
) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;

  const cards = entries
    .map(
      (e) => `
      <div style="break-inside:avoid; display:flex; flex-direction:column; align-items:center; border:1px solid #e2e8f0; border-radius:8px; padding:16px; margin:8px;">
        <img src="${e.dataUrl}" style="width:180px; height:180px;" />
        <p style="margin:8px 0 4px; font-size:14px; font-weight:600; color:#0f172a; text-align:center; word-break:break-word; max-width:200px;">${e.label}</p>
        <p style="margin:0; font-size:11px; font-family:monospace; color:#64748b;">${e.value}</p>
      </div>`,
    )
    .join('');

  win.document.write(`<!DOCTYPE html>
<html>
<head>
<title>${title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, sans-serif; padding: 24px; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; color: #0f172a; }
  p.subtitle { font-size: 13px; color: #64748b; margin-bottom: 20px; }
  .grid { display: flex; flex-wrap: wrap; gap: 0; }
  .grid > div { width: 33.33%; }
  @media print {
    body { padding: 12px; }
    .no-print { display: none; }
  }
  .no-print { margin-bottom: 16px; }
  .no-print button { padding: 8px 20px; background: #3366ff; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()">Print this sheet</button>
  </div>
  <h1>${title}</h1>
  <p class="subtitle">${entries.length} QR code${entries.length !== 1 ? 's' : ''} — generated ${new Date().toLocaleDateString()}</p>
  <div class="grid">${cards}</div>
</body>
</html>`);
  win.document.close();
}

/**
 * Download multiple QR data URLs as individual PNG files sequentially.
 * Browsers throttle concurrent downloads, so we add a small delay between each.
 */
export async function downloadMultipleQrs(
  entries: { dataUrl: string; filename: string }[],
  onProgress?: (current: number, total: number) => void,
) {
  for (let i = 0; i < entries.length; i++) {
    downloadDataUrl(entries[i].dataUrl, entries[i].filename);
    if (onProgress) onProgress(i + 1, entries.length);
    // Small delay to avoid browser download throttling
    await new Promise((r) => setTimeout(r, 300));
  }
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
