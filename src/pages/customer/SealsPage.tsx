import { useEffect, useState, useCallback, useRef } from 'react';
import {
  ShieldCheck, Upload, Camera, ListOrdered, Plus, Loader2,
  Search, X, Check, AlertCircle, Vibrate, Trash2, Package, Download,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/qr';
import { useAuth } from '@/lib/auth';
import * as XLSX from 'xlsx';
import { QrScanner } from '@/components/QrScanner';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface SealRecord {
  id: string;
  seal_serial: string;
  origin: string | null;
  batch_number: string | null;
  manufacturing_specs: Record<string, unknown> | null;
  created_at: string;
}

type IntakeTab = 'vendor' | 'camera' | 'sequence';

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function SealsPage() {
  const { appUser } = useAuth();
  const [seals, setSeals] = useState<SealRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<IntakeTab>('vendor');

  // Vendor upload
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ added: number; duplicates: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sequence range
  const [firstSeal, setFirstSeal] = useState('');
  const [lastSeal, setLastSeal] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [generating, setGenerating] = useState(false);

  // Camera scan
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [scannedSeals, setScannedSeals] = useState<string[]>([]);
  const [manualEntry, setManualEntry] = useState('');
  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [lastBeep, setLastBeep] = useState(0);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Action feedback
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  /* -------------------- Data fetching -------------------- */

  const fetchSeals = useCallback(async () => {
    const { data } = await supabase
      .from('seals')
      .select('*')
      .order('created_at', { ascending: false });
    setSeals(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSeals();
  }, [fetchSeals]);

  /* -------------------- Derived -------------------- */

  const filtered = seals.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.seal_serial.toLowerCase().includes(q) ||
      (s.batch_number ?? '').toLowerCase().includes(q) ||
      (s.origin ?? '').toLowerCase().includes(q)
    );
  });

  /* -------------------- Helpers -------------------- */

  const clearFeedback = () => {
    setErrorMsg('');
    setSuccessMsg('');
    setUploadResult(null);
  };

  const downloadSealTemplate = () => {
    const csv = 'seal_serial,batch_number,manufacturer,material,color,size\nSL-10001,BATCH-2024-001,AcmeSeal Co,Steel,Red,Standard\nSL-10002,BATCH-2024-001,AcmeSeal Co,Steel,Red,Standard\nSL-10003,BATCH-2024-002,AcmeSeal Co,Brass,Silver,Large\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'seal-vendor-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const beep = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch { /* audio not available */ }
    if (navigator.vibrate) navigator.vibrate(100);
  }, []);

  // Check duplicates across ALL existing seals (not just current batch)
  const checkDuplicates = async (serials: string[]): Promise<string[]> => {
    if (serials.length === 0) return [];
    // Query in chunks to avoid URL length limits
    const results: string[] = [];
    const chunkSize = 200;
    for (let i = 0; i < serials.length; i += chunkSize) {
      const chunk = serials.slice(i, i + chunkSize);
      const { data } = await supabase
        .from('seals')
        .select('seal_serial')
        .in('seal_serial', chunk);
      results.push(...(data ?? []).map((r) => r.seal_serial));
    }
    return results;
  };

  const insertSeals = async (
    rows: { seal_serial: string; origin: string; batch_number: string | null; manufacturing_specs?: Record<string, unknown> | null }[]
  ): Promise<number> => {
    if (rows.length === 0) return 0;
    let inserted = 0;
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('seals')
        .insert(chunk)
        .select('id');
      if (error) {
        // If it's a unique constraint violation, try inserting one-by-one to skip dups
        if (error.code === '23505') {
          for (const row of chunk) {
            const { data: singleData, error: singleErr } = await supabase
              .from('seals')
              .insert([row])
              .select('id');
            if (!singleErr && singleData) inserted++;
          }
          continue;
        }
        throw error;
      }
      inserted += data?.length ?? 0;
    }
    return inserted;
  };

  /* -------------------- Vendor upload (CSV + Excel) -------------------- */

  const parseCsv = (text: string): { serial: string; batch?: string; specs?: Record<string, string> }[] => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const results: { serial: string; batch?: string; specs?: Record<string, string> }[] = [];

    // Detect delimiter
    const firstLine = lines[0] || '';
    const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';

    // Check if first line is a header
    const firstCells = firstLine.split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ''));
    const hasHeader = firstCells.some((c) =>
      c.toLowerCase().match(/seal|serial|batch|manufactur/)
    );

    const dataLines = hasHeader ? lines.slice(1) : lines;
    const headerCells = hasHeader ? firstCells : [];

    // Find column indices from header
    let serialIdx = 0;
    let batchIdx = -1;
    let specsStartIdx = -1;
    if (hasHeader) {
      serialIdx = headerCells.findIndex((c) => c.toLowerCase().match(/seal|serial/));
      if (serialIdx === -1) serialIdx = 0;
      batchIdx = headerCells.findIndex((c) => c.toLowerCase().match(/batch/));
      specsStartIdx = headerCells.findIndex((c) => c.toLowerCase().match(/manufactur|spec|material|color|size|type/));
    }

    for (const line of dataLines) {
      const cells = line.split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ''));
      const serial = cells[serialIdx];
      if (!serial) continue;

      const batch = batchIdx >= 0 ? cells[batchIdx] : undefined;

      let specs: Record<string, string> | undefined;
      if (hasHeader && specsStartIdx >= 0) {
        specs = {};
        for (let j = specsStartIdx; j < headerCells.length; j++) {
          if (cells[j] && headerCells[j]) {
            specs[headerCells[j]] = cells[j];
          }
        }
        if (Object.keys(specs).length === 0) specs = undefined;
      }

      results.push({ serial, batch: batch || undefined, specs });
    }
    return results;
  };

  const parseExcel = async (file: File): Promise<{ serial: string; batch?: string; specs?: Record<string, string> }[]> => {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const results: { serial: string; batch?: string; specs?: Record<string, string> }[] = [];
    for (const row of rows) {
      const keys = Object.keys(row);
      const serialKey = keys.find((k) => k.toLowerCase().match(/seal|serial/)) ?? keys[0];
      const batchKey = keys.find((k) => k.toLowerCase().match(/batch/));

      const serial = String(row[serialKey] ?? '').trim();
      if (!serial) continue;

      const batch = batchKey ? String(row[batchKey] ?? '').trim() : undefined;

      const specs: Record<string, string> = {};
      for (const key of keys) {
        if (key === serialKey || key === batchKey) continue;
        const val = String(row[key] ?? '').trim();
        if (val) specs[key] = val;
      }

      results.push({ serial, batch: batch || undefined, specs: Object.keys(specs).length > 0 ? specs : undefined });
    }
    return results;
  };

  const handleUpload = async () => {
    if (!file) return;
    clearFeedback();
    setUploading(true);

    try {
      let parsed: { serial: string; batch?: string; specs?: Record<string, string> }[] = [];

      const isExcel = file.name.match(/\.xlsx?$/i);
      if (isExcel) {
        parsed = await parseExcel(file);
      } else {
        const text = await file.text();
        parsed = parseCsv(text);
      }

      // Dedupe within the file
      const seen = new Set<string>();
      const deduped = parsed.filter((p) => {
        if (seen.has(p.serial)) return false;
        seen.add(p.serial);
        return true;
      });

      const serials = deduped.map((p) => p.serial);

      if (serials.length === 0) {
        setErrorMsg('No valid seal serials found in the file.');
        setUploading(false);
        return;
      }

      // Check duplicates across ALL existing seals
      const duplicates = await checkDuplicates(serials);
      const newEntries = deduped.filter((p) => !duplicates.includes(p.serial));

      const rows = newEntries.map((p) => ({
        seal_serial: p.serial,
        origin: 'vendor_upload',
        batch_number: p.batch ?? (batchNumber.trim() || null),
        manufacturing_specs: p.specs ?? {},
      }));

      const added = await insertSeals(rows);
      setUploadResult({ added, duplicates: duplicates.length });

      if (added > 0) {
        await fetchSeals();
        await supabase.from('customer_activity_logs').insert({
          actor_id: appUser?.id ?? '',
          actor_email: appUser?.email ?? '',
          actor_role: appUser?.role ?? 'admin',
          action: 'seals_vendor_upload',
          details: { added, duplicates: duplicates.length, batch: batchNumber.trim() || null },
        });
      }
    } catch {
      setErrorMsg('Failed to process the file. Please ensure it is a valid CSV or Excel file.');
    } finally {
      setUploading(false);
    }
  };

  /* -------------------- Sequence range -------------------- */

  const generateSequence = (first: string, last: string): string[] => {
    const match = /^(.*?)(\d+)$/.exec(first);
    if (!match) return [];

    const prefix = match[1];
    const startNum = parseInt(match[2], 10);
    const startWidth = match[2].length;

    const lastMatch = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`).exec(last);
    if (!lastMatch) return [];

    const endNum = parseInt(lastMatch[1], 10);
    if (endNum < startNum) return [];

    const serials: string[] = [];
    for (let i = startNum; i <= endNum; i++) {
      serials.push(`${prefix}${i.toString().padStart(startWidth, '0')}`);
    }
    return serials;
  };

  const handleGenerateSequence = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (!firstSeal.trim() || !lastSeal.trim()) return;
    setGenerating(true);

    try {
      const serials = generateSequence(firstSeal.trim(), lastSeal.trim());

      if (serials.length === 0) {
        setErrorMsg(
          'Could not generate a sequence. Ensure both serials share the same text prefix and end with numbers (e.g. SL-0001 to SL-0010).'
        );
        setGenerating(false);
        return;
      }

      if (serials.length > 5000) {
        setErrorMsg('Sequence too large. Please limit ranges to 5,000 seals at a time.');
        setGenerating(false);
        return;
      }

      const duplicates = await checkDuplicates(serials);
      const newSerials = serials.filter((s) => !duplicates.includes(s));

      const rows = newSerials.map((serial) => ({
        seal_serial: serial,
        origin: 'sequence_range',
        batch_number: batchNumber.trim() || null,
      }));

      const added = await insertSeals(rows);

      if (added > 0) {
        setSuccessMsg(`Registered ${added} seal${added !== 1 ? 's' : ''}${duplicates.length > 0 ? ` (${duplicates.length} duplicate${duplicates.length !== 1 ? 's' : ''} skipped)` : ''}.`);
        await fetchSeals();
        await supabase.from('customer_activity_logs').insert({
          actor_id: appUser?.id ?? '',
          actor_email: appUser?.email ?? '',
          actor_role: appUser?.role ?? 'admin',
          action: 'seals_sequence_registered',
          details: { added, duplicates: duplicates.length, first: firstSeal.trim(), last: lastSeal.trim() },
        });
        setFirstSeal('');
        setLastSeal('');
      } else if (duplicates.length === serials.length) {
        setErrorMsg('All seals in this range already exist.');
      }
    } catch {
      setErrorMsg('Failed to register seals. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  /* -------------------- Camera batch scan -------------------- */

  const startCamera = async () => {
    setCameraStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      setErrorMsg('Could not access camera. You can still type serials manually below.');
    } finally {
      setCameraStarting(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => { stopCamera(); };
  }, []);

  const addScannedSeal = (serial: string) => {
    const trimmed = serial.trim();
    if (!trimmed) return;
    // Dedupe within current batch
    if (scannedSeals.includes(trimmed)) {
      // Different beep pattern for duplicate
      try {
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
        const ctx = audioCtxRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 220;
        osc.type = 'square';
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
      } catch { /* audio not available */ }
      return;
    }
    setScannedSeals((prev) => [...prev, trimmed]);
    setLastBeep(Date.now());
    beep();
  };

  // Simulate scanning a seal from camera (in production, this would use a barcode/QR library)
  const simulateCameraScan = () => {
    setShowQrScanner(true);
  };

  const removeScannedSeal = (serial: string) => {
    setScannedSeals((prev) => prev.filter((s) => s !== serial));
  };

  const submitBatchIntake = async () => {
    if (scannedSeals.length === 0) return;
    setSubmittingBatch(true);
    clearFeedback();

    try {
      const duplicates = await checkDuplicates(scannedSeals);
      const newSerials = scannedSeals.filter((s) => !duplicates.includes(s));

      const rows = newSerials.map((serial) => ({
        seal_serial: serial,
        origin: 'camera_scan',
        batch_number: batchNumber.trim() || null,
      }));

      const added = await insertSeals(rows);

      if (added > 0) {
        setSuccessMsg(`Batch intake complete: ${added} seal${added !== 1 ? 's' : ''} registered${duplicates.length > 0 ? ` (${duplicates.length} duplicate${duplicates.length !== 1 ? 's' : ''} filtered)` : ''}.`);
        await fetchSeals();
        await supabase.from('customer_activity_logs').insert({
          actor_id: appUser?.id ?? '',
          actor_email: appUser?.email ?? '',
          actor_role: appUser?.role ?? 'admin',
          action: 'seals_camera_batch',
          details: { added, duplicates: duplicates.length },
        });
        setScannedSeals([]);
      } else if (duplicates.length === scannedSeals.length) {
        setErrorMsg('All scanned seals already exist in the database.');
      }
    } catch {
      setErrorMsg('Failed to submit batch intake. Please try again.');
    } finally {
      setSubmittingBatch(false);
    }
  };

  /* -------------------- Render -------------------- */

  const inputClass =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Seals</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Register seals via vendor file, camera batch scan, or sequential range entry.
        </p>
      </div>

      {/* Intake tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
        <button
          onClick={() => { setActiveTab('vendor'); clearFeedback(); }}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === 'vendor'
              ? 'bg-primary-600 text-white'
              : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
          }`}
        >
          <Upload className="h-4 w-4" />
          Vendor upload
        </button>
        <button
          onClick={() => { setActiveTab('camera'); clearFeedback(); }}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === 'camera'
              ? 'bg-primary-600 text-white'
              : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
          }`}
        >
          <Camera className="h-4 w-4" />
          Camera scan
        </button>
        <button
          onClick={() => { setActiveTab('sequence'); clearFeedback(); }}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === 'sequence'
              ? 'bg-primary-600 text-white'
              : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
          }`}
        >
          <ListOrdered className="h-4 w-4" />
          Sequence range
        </button>
      </div>

      {/* Intake panel */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        {/* Vendor upload */}
        {activeTab === 'vendor' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-[var(--text)]">Vendor CSV / Excel upload</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Upload a CSV or Excel file from a supplier manifest. The first column should contain seal serial numbers. Optional columns for batch number and manufacturing specs are automatically detected from headers.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                Batch number <span className="text-[var(--text-subtle)]">(optional, applied to all seals if not in file)</span>
              </label>
              <input
                type="text"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="e.g. BATCH-2024-001"
                disabled={uploading}
                className={inputClass}
              />
            </div>

            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--surface-hover)] px-6 py-10 text-center transition-colors hover:border-primary-500/50"
            >
              <Upload className="h-8 w-8 text-[var(--text-subtle)]" />
              <p className="mt-3 text-sm font-medium text-[var(--text)]">
                {file ? file.name : 'Click to select a CSV or Excel file'}
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Accepts .csv, .xlsx, .xls</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  clearFeedback();
                }}
              />
            </div>

            <button
              onClick={downloadSealTemplate}
              className="flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              <Download className="h-4 w-4" /> Download CSV template
            </button>

            {uploadResult && (
              <div className="rounded-lg bg-accent-500/10 p-3 text-sm text-accent-700">
                <span className="font-medium">{uploadResult.added}</span> seal{uploadResult.added !== 1 ? 's' : ''} registered.
                {uploadResult.duplicates > 0 && (
                  <> <span className="font-medium">{uploadResult.duplicates}</span> duplicate{uploadResult.duplicates !== 1 ? 's' : ''} skipped.</>
                )}
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Import batch & register seals
                </>
              )}
            </button>
          </div>
        )}

        {/* Camera scan */}
        {activeTab === 'camera' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-[var(--text)]">Continuous camera batch scan</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                The camera stays active for consecutive scanning. Each scan produces a beep and vibration. Duplicates are automatically filtered out. When done, tap "Submit Batch Intake".
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                Batch number <span className="text-[var(--text-subtle)]">(optional)</span>
              </label>
              <input
                type="text"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="e.g. BATCH-2024-001"
                disabled={submittingBatch}
                className={inputClass}
              />
            </div>

            {/* Camera viewport */}
            <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-black">
              {cameraActive ? (
                <video
                  ref={videoRef}
                  className="h-64 w-full object-contain"
                  playsInline
                  muted
                />
              ) : (
                <div className="flex h-64 flex-col items-center justify-center text-center">
                  <Camera className="h-12 w-12 text-white/30" />
                  <p className="mt-3 text-sm text-white/50">Camera is off</p>
                </div>
              )}

              {/* Scanning overlay */}
              {cameraActive && (
                <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-primary-500/80 shadow-[0_0_10px_2px_rgba(59,130,246,0.5)]" />
              )}

              {/* Camera controls */}
              <div className="absolute right-2 top-2 flex gap-2">
                {cameraActive && (
                  <button
                    onClick={stopCamera}
                    className="rounded-lg bg-black/50 p-2 text-white hover:bg-black/70"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Camera buttons */}
            <div className="flex gap-2">
              {!cameraActive ? (
                <button
                  onClick={startCamera}
                  disabled={cameraStarting}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                >
                  {cameraStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  {cameraStarting ? 'Starting...' : 'Start camera'}
                </button>
              ) : (
                <button
                  onClick={simulateCameraScan}
                  className="flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-700"
                >
                  <Camera className="h-4 w-4" />
                  Scan QR
                </button>
              )}
            </div>

            {showQrScanner && (
              <QrScanner
                onScan={(value) => {
                  addScannedSeal(value);
                  setShowQrScanner(false);
                }}
                onClose={() => setShowQrScanner(false)}
                title="Scan Seal QR Code"
                subtitle="Point camera at the seal's QR code"
              />
            )}

            {/* Manual entry fallback */}
            <div className="flex gap-2">
              <input
                type="text"
                value={manualEntry}
                onChange={(e) => setManualEntry(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addScannedSeal(manualEntry);
                    setManualEntry('');
                  }
                }}
                placeholder="Or type a seal serial and press Enter..."
                disabled={submittingBatch}
                className={inputClass}
              />
              <button
                onClick={() => {
                  addScannedSeal(manualEntry);
                  setManualEntry('');
                }}
                disabled={!manualEntry.trim() || submittingBatch}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>

            {/* Scanned seals list */}
            {scannedSeals.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-[var(--text)]">
                    Scanned seals ({scannedSeals.length})
                  </p>
                  <button
                    onClick={() => setScannedSeals([])}
                    disabled={submittingBatch}
                    className="text-xs font-medium text-error-500 hover:text-error-600"
                  >
                    Clear all
                  </button>
                </div>
                <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-2">
                  {scannedSeals.map((serial, i) => (
                    <div key={serial} className="flex items-center gap-2 rounded-lg bg-[var(--surface)] px-3 py-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-500/15 text-xs font-semibold text-accent-600">
                        {i + 1}
                      </span>
                      <span className="flex-1 font-mono text-sm text-[var(--text)]">{serial}</span>
                      <Check className="h-3.5 w-3.5 text-accent-500" />
                      <button
                        onClick={() => removeScannedSeal(serial)}
                        disabled={submittingBatch}
                        className="text-error-500 hover:text-error-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={submitBatchIntake}
                  disabled={submittingBatch}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                >
                  {submittingBatch ? (
                    <><Loader2 className="h-5 w-5 animate-spin" /> Submitting...</>
                  ) : (
                    <><Package className="h-5 w-5" /> Submit Batch Intake ({scannedSeals.length} seals)</>
                  )}
                </button>
              </div>
            ) : (
              <div className="min-h-[80px] rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-hover)] p-4">
                <p className="text-center text-sm text-[var(--text-subtle)]">
                  No seals scanned yet. Start the camera or type serials manually.
                </p>
              </div>
            )}

            {/* Feedback indicator */}
            {lastBeep > 0 && Date.now() - lastBeep < 2000 && (
              <div className="flex items-center gap-2 text-xs text-accent-600">
                <Vibrate className="h-3.5 w-3.5" />
                Scan registered
              </div>
            )}
          </div>
        )}

        {/* Sequence range */}
        {activeTab === 'sequence' && (
          <form onSubmit={handleGenerateSequence} className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-[var(--text)]">Sequence range entry</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                For serialized security seals, scan or enter the first and last seal in a box. The app detects the numerical sequence pattern and generates all records in between.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                Batch number <span className="text-[var(--text-subtle)]">(optional)</span>
              </label>
              <input
                type="text"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="e.g. BATCH-2024-001"
                disabled={generating}
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                  First seal <span className="text-error-500">*</span>
                </label>
                <input
                  type="text"
                  value={firstSeal}
                  onChange={(e) => setFirstSeal(e.target.value)}
                  placeholder="e.g. SEAL-10001"
                  required
                  disabled={generating}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text)]">
                  Last seal <span className="text-error-500">*</span>
                </label>
                <input
                  type="text"
                  value={lastSeal}
                  onChange={(e) => setLastSeal(e.target.value)}
                  placeholder="e.g. SEAL-10500"
                  required
                  disabled={generating}
                  className={inputClass}
                />
              </div>
            </div>

            {firstSeal.trim() && lastSeal.trim() && (
              (() => {
                const preview = generateSequence(firstSeal.trim(), lastSeal.trim());
                if (preview.length > 0) {
                  return (
                    <div className="rounded-lg bg-primary-500/5 border border-primary-500/20 p-3">
                      <p className="text-xs text-[var(--text-muted)]">
                        This will generate <span className="font-medium text-[var(--text)]">{preview.length}</span> seal{preview.length !== 1 ? 's' : ''}.
                      </p>
                      <p className="mt-1 text-xs text-[var(--text-subtle)] font-mono">
                        {preview[0]} → {preview[preview.length - 1]}
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="flex items-center gap-2 text-xs text-warning-500">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Prefixes must match and both must end with numbers.
                  </div>
                );
              })()
            )}

            <button
              type="submit"
              disabled={generating || !firstSeal.trim() || !lastSeal.trim()}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Registering...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Register seals
                </>
              )}
            </button>
          </form>
        )}

        {/* Shared feedback */}
        {errorMsg && (
          <div className="mt-4 rounded-lg bg-error-500/10 p-3 text-sm text-error-500">
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="mt-4 rounded-lg bg-accent-500/10 p-3 text-sm text-accent-700">
            {successMsg}
          </div>
        )}
      </div>

      {/* Search */}
      {seals.length > 0 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by serial, batch, or origin..."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text-subtle)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
      )}

      {/* Seals list */}
      {loading ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-[var(--text-subtle)]" />
          <p className="mt-2">Loading seals...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center">
          <ShieldCheck className="mx-auto h-12 w-12 text-[var(--text-subtle)]" />
          <p className="mt-4 text-base font-medium text-[var(--text)]">
            {search ? 'No seals found' : 'No seals registered yet'}
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {search ? 'Try a different search term.' : 'Register seals using one of the methods above.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-hover)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-4 py-3 font-medium">Seal serial</th>
                  <th className="px-4 py-3 font-medium">Origin</th>
                  <th className="px-4 py-3 font-medium">Batch</th>
                  <th className="px-4 py-3 font-medium">Specs</th>
                  <th className="px-4 py-3 font-medium">Registered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((seal) => (
                  <tr key={seal.id} className="transition-colors hover:bg-[var(--surface-hover)]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-[var(--text)]">{seal.seal_serial}</span>
                        {seal.origin && seal.origin !== 'app_generated' && (
                          <span className="rounded-full bg-warning-500/10 px-2 py-0.5 text-xs font-medium text-warning-500">
                            Ext. registered
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      {seal.origin ? seal.origin.replace(/_/g, ' ') : '—'}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{seal.batch_number ?? '—'}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      {seal.manufacturing_specs && Object.keys(seal.manufacturing_specs).length > 0
                        ? `${Object.keys(seal.manufacturing_specs).length} field${Object.keys(seal.manufacturing_specs).length !== 1 ? 's' : ''}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{formatDateTime(seal.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
