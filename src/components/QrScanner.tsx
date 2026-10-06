import { useEffect, useRef, useState, useCallback } from 'react';
import { X, ScanLine, Loader as Loader2, Camera, CameraOff, AlertTriangle, RefreshCw, Upload } from 'lucide-react';
import { decodeQrFromVideo, decodeQrFromCanvas } from '@/lib/qrDecode';

interface Props {
  onScan: (value: string) => void;
  onClose: () => void;
  title?: string;
  subtitle?: string;
}

const SCAN_TIMEOUT_MS = 30_000;
const SCAN_INTERVAL_MS = 300;

type CameraError = 'permission' | 'notfound' | 'notsupported' | 'unknown';

export function QrScanner({ onScan, onClose, title = 'Scan QR Code', subtitle = 'Point your camera at a QR code' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stoppedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'error' | 'done' | 'timeout'>('starting');
  const [errorType, setErrorType] = useState<CameraError>('unknown');
  const [errorMsg, setErrorMsg] = useState('');
  const lastScanRef = useRef<{ value: string; time: number } | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const stopScanner = useCallback(() => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startTimeout = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (!stoppedRef.current) {
        setStatus('timeout');
        stopScanner();
      }
    }, SCAN_TIMEOUT_MS);
  }, [stopScanner]);

  const handleResult = useCallback((result: string) => {
    const now = Date.now();
    if (lastScanRef.current && lastScanRef.current.value === result && now - lastScanRef.current.time < 800) {
      return false;
    }
    lastScanRef.current = { value: result, time: now };
    setStatus('done');
    playBeep();
    if (navigator.vibrate) navigator.vibrate(100);
    stopScanner();
    onScanRef.current(result);
    return true;
  }, [stopScanner]);

  const processFrame = useCallback(() => {
    if (stoppedRef.current || !videoRef.current) return;
    const video = videoRef.current;
    if (video.readyState < 2 || !video.videoWidth) return;
    const result = decodeQrFromVideo(video);
    if (result) handleResult(result);
  }, [handleResult]);

  const classifyError = (err: unknown): { type: CameraError; message: string } => {
    const e = err as { name?: string; message?: string };
    const name = e?.name ?? '';
    const msg = e?.message ?? '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return { type: 'permission', message: 'Camera permission was denied. Please allow camera access in your browser settings and try again.' };
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      return { type: 'notfound', message: 'No suitable camera was found on this device. You can upload a QR code image instead.' };
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return { type: 'permission', message: 'The camera is already in use by another application. Close it and try again, or upload a QR code image.' };
    }
    if (name === 'NotSupportedError' || name === 'TypeError' || msg.includes('mediaDevices')) {
      return { type: 'notsupported', message: 'This browser does not support camera access. Try using Chrome, Firefox, or Safari, or upload a QR code image.' };
    }
    if (name === 'AbortError') {
      return { type: 'unknown', message: 'Camera startup was interrupted. Please try again.' };
    }
    return { type: 'unknown', message: `Could not start camera${msg ? ': ' + msg : ''}. Please check permissions or try uploading a QR code image.` };
  };

  const startCamera = useCallback(async () => {
    stoppedRef.current = false;
    setStatus('starting');
    setErrorMsg('');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const { type, message } = classifyError(new TypeError('mediaDevices is not supported'));
      setErrorType(type);
      setErrorMsg(message);
      setStatus('error');
      return;
    }

    const constraints: MediaStreamConstraints[] = [
      // 1. Ideal: rear-facing camera (mobile)
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false },
      // 2. Any rear-facing camera with relaxed resolution
      { video: { facingMode: { exact: 'environment' } }, audio: false },
      // 3. Any front camera (desktop laptops)
      { video: { facingMode: { ideal: 'user' } }, audio: false },
      // 4. Any camera at all — last resort
      { video: true, audio: false },
    ];

    let stream: MediaStream | null = null;
    let lastErr: unknown = null;

    for (const c of constraints) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(c);
        break;
      } catch (err) {
        lastErr = err;
        // If permission denied, no point trying other constraints
        const name = (err as { name?: string }).name;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          lastErr = err;
          break;
        }
      }
    }

    if (!stream) {
      const { type, message } = classifyError(lastErr);
      setErrorType(type);
      setErrorMsg(message);
      setStatus('error');
      return;
    }

    if (stoppedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Some browsers need a user gesture; the play() call may reject
      // but the video will often start once the user interacts
    }

    if (stoppedRef.current) return;
    setStatus('scanning');
    startTimeout();
    intervalRef.current = setInterval(processFrame, SCAN_INTERVAL_MS);
  }, [processFrame, startTimeout]);

  const restartScan = useCallback(() => {
    stopScanner();
    startCamera();
  }, [startCamera, stopScanner]);

  useEffect(() => {
    startCamera();
    return () => { stopScanner(); };
  }, [startCamera, stopScanner]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const result = decodeQrFromCanvas(canvas);
      if (result) {
        handleResult(result);
      } else {
        setErrorType('unknown');
        setErrorMsg('No QR code could be decoded from that image. Try a clearer or larger image.');
        setStatus('error');
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setErrorType('unknown');
      setErrorMsg('Could not load that image file. Please try a different image.');
      setStatus('error');
    };
    img.src = url;
  }, [handleResult]);

  const playBeep = () => {
    try {
      const ctx = new AudioContext();
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
  };

  const showError = status === 'error';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={showError ? onClose : undefined} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary-600" />
            <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
          </div>
          <button
            onClick={() => { stopScanner(); onClose(); }}
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          <p className="mb-3 text-center text-sm text-[var(--text-muted)]">{subtitle}</p>

          {showError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CameraOff className="h-12 w-12 text-error-500" />
              <p className="max-w-xs text-sm text-error-500">{errorMsg}</p>
              {errorType === 'notsupported' && (
                <p className="max-w-xs text-xs text-[var(--text-muted)]">
                  Camera access requires a secure connection (HTTPS) or localhost. If you're on HTTP, that may be the cause.
                </p>
              )}
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  onClick={restartScan}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
                >
                  <RefreshCw className="h-4 w-4" /> Retry camera
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]"
                >
                  <Upload className="h-4 w-4" /> Upload image
                </button>
                <button
                  onClick={onClose}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]"
                >
                  Close
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          ) : status === 'timeout' ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning-500/10">
                <AlertTriangle className="h-7 w-7 text-warning-500" />
              </div>
              <p className="max-w-xs text-sm font-medium text-[var(--text)]">No QR code detected</p>
              <p className="max-w-xs text-xs text-[var(--text-muted)]">
                The scanner couldn't read a QR code. Make sure the code is well-lit, in focus, and fills most of the camera view.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  onClick={restartScan}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
                >
                  <RefreshCw className="h-4 w-4" /> Try again
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]"
                >
                  <Upload className="h-4 w-4" /> Upload image
                </button>
                <button
                  onClick={onClose}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]"
                >
                  Close
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          ) : (
            <div className="relative mx-auto w-full max-w-xs">
              <video
                ref={videoRef}
                className="overflow-hidden rounded-xl border-2 border-primary-500/50 bg-black object-cover"
                style={{ aspectRatio: '1 / 1', width: '100%' }}
                playsInline
                muted
                autoPlay
              />

              {status === 'starting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <div className="flex flex-col items-center gap-2 text-white">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <span className="text-sm">Starting camera...</span>
                  </div>
                </div>
              )}

              {status === 'scanning' && (
                <>
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute left-1/2 top-1/2 h-[80%] w-[80%] -translate-x-1/2 -translate-y-1/2 border-2 border-white/70 rounded-lg" />
                    <div className="absolute left-1/2 top-1/2 h-0.5 w-[80%] -translate-x-1/2 -translate-y-1/2 bg-primary-500 shadow-[0_0_10px_2px_rgba(59,130,246,0.7)]" style={{ animation: 'scanline 1.5s linear infinite' }} />
                  </div>
                  <div className="mt-2 flex items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
                    <Camera className="h-3.5 w-3.5" /> Scanning...
                  </div>
                  <div className="mt-1 text-center">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1 text-xs text-[var(--text-subtle)] hover:text-[var(--text-muted)]"
                    >
                      <Upload className="h-3 w-3" /> Or upload an image
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </>
              )}

              {status === 'done' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <div className="flex flex-col items-center gap-2 text-white">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-500">
                      <ScanLine className="h-6 w-6 text-white" />
                    </div>
                    <span className="text-sm">QR detected!</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes scanline {
          0% { transform: translate(-50%, -80%); }
          50% { transform: translate(-50%, -20%); }
          100% { transform: translate(-50%, -80%); }
        }
      `}</style>
    </div>
  );
}
