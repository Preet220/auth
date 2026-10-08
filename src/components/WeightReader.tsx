import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Scale, Loader as Loader2, Check, CameraOff, CircleAlert as AlertCircle, Camera, RotateCw } from 'lucide-react';
import { createWorker } from 'tesseract.js';

interface Props {
  onRead: (weight: number, source: 'auto' | 'manual') => void;
  onClose: () => void;
}

type ReadError =
  | 'no_camera'
  | 'no_digits'
  | 'low_confidence'
  | 'inconsistent'
  | 'image_too_small'
  | 'ocr_failed';

const ERROR_MESSAGES: Record<ReadError, string> = {
  no_camera: 'Could not access the camera. Please enter the weight manually below.',
  no_digits: 'No digits were detected in the image. Make sure the scale display is clearly visible inside the rectangle, well-lit, and in focus.',
  low_confidence: 'The reading could not be confirmed with enough confidence. Try improving lighting, getting closer to the display, and holding the camera steadier.',
  inconsistent: 'The readings were too inconsistent across attempts. This usually means the image is blurry, glare is reflecting off the display, or the digits are too small. Try again in better conditions.',
  image_too_small: 'The captured image is too small to read reliably. Move closer to the scale display so the digits fill more of the rectangle.',
  ocr_failed: 'The OCR engine failed to process the image. Please try again or enter the weight manually.',
};

export function WeightReader({ onRead, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<ReturnType<typeof createWorker> | null>(null);
  const [status, setStatus] = useState<'starting' | 'reading' | 'stable' | 'error'>('starting');
  const [errorMsg, setErrorMsg] = useState('');
  const [errorType, setErrorType] = useState<ReadError | null>(null);
  const [lastReading, setLastReading] = useState<string | null>(null);
  const [manualWeight, setManualWeight] = useState('');
  const [attempting, setAttempting] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);
  const [captureFeedback, setCaptureFeedback] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<ReadError | null>(null);
  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const stoppedRef = useRef(false);

  const cleanup = useCallback(() => {
    stoppedRef.current = true;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (workerRef.current) {
      workerRef.current.then((w) => w.terminate()).catch(() => {});
      workerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    stoppedRef.current = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const worker = createWorker('eng', 1, { logger: () => {} });
        workerRef.current = worker;
        const w = await worker;
        if (!mounted) { w.terminate(); return; }

        await w.setParameters({
          tessedit_char_whitelist: '0123456789.,',
          tessedit_pageseg_mode: '7' as never,
        });

        setWorkerReady(true);
        setStatus('reading');
      } catch {
        if (mounted) {
          setStatus('error');
          setErrorType('no_camera');
          setErrorMsg(ERROR_MESSAGES.no_camera);
        }
      }
    };

    start();
    return () => { mounted = false; cleanup(); };
  }, [cleanup]);

  const extractNumber = (text: string): number | null => {
    if (!text || !text.trim()) return null;

    let cleaned = text
      .replace(/[oO]/g, '0')
      .replace(/[lI|]/g, '1')
      .replace(/[S]/g, '5')
      .replace(/[B]/g, '8')
      .replace(/[Z]/g, '2');

    const allMatches: { value: number; raw: string; index: number; score: number }[] = [];
    const numberRegex = /(\d{1,5}[.,]?\d{0,3})/g;
    let match;
    while ((match = numberRegex.exec(cleaned)) !== null) {
      const raw = match[1];
      const valueStr = raw.replace(',', '.');
      const numVal = parseFloat(valueStr);
      if (isNaN(numVal) || numVal <= 0 || numVal > 99999) continue;

      const digitCount = raw.replace(/[.,]/g, '').length;
      let score = digitCount * 10;

      const before = cleaned.substring(Math.max(0, match.index - 10), match.index).toLowerCase();
      const after = cleaned.substring(match.index + raw.length, match.index + raw.length + 10).toLowerCase();

      if (/kg|kilo|gram|g\b|lb|lbs|pound|oz|ounce/.test(before) || /kg|kilo|gram|g\b|lb|lbs|pound|oz|ounce/.test(after)) {
        score += 50;
      }

      if (/model|serial|no\.|id|code|batch|date|time|st\b|stable|tare|net|gross/.test(before) || /model|serial|no\.|id|code|batch|date|time/.test(after)) {
        score -= 30;
      }

      if (raw.includes('.') || raw.includes(',')) {
        score += 15;
      }

      allMatches.push({ value: numVal, raw, index: match.index, score });
    }

    if (allMatches.length === 0) return null;

    allMatches.sort((a, b) => b.score - a.score);

    if (allMatches.length === 1) return allMatches[0].value;

    return allMatches[0].value;
  };

  const processFrame = async (): Promise<{ value: number | null; error: ReadError | null; candidateCount: number; variantCount: number }> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return { value: null, error: 'ocr_failed', candidateCount: 0, variantCount: 0 };

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) return { value: null, error: 'ocr_failed', candidateCount: 0, variantCount: 0 };

    if (w < 320 || h < 240) {
      return { value: null, error: 'image_too_small', candidateCount: 0, variantCount: 0 };
    }

    const roiW = Math.floor(w * 0.75);
    const roiH = Math.floor(h * 0.30);
    const roiX = Math.floor((w - roiW) / 2);
    const roiY = Math.floor((h - roiH) / 2);

    canvas.width = roiW;
    canvas.height = roiH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { value: null, error: 'ocr_failed', candidateCount: 0, variantCount: 0 };
    ctx.drawImage(video, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);

    const scale = 3;
    const enlarged = document.createElement('canvas');
    enlarged.width = roiW * scale;
    enlarged.height = roiH * scale;
    const eCtx = enlarged.getContext('2d');
    if (!eCtx) return { value: null, error: 'ocr_failed', candidateCount: 0, variantCount: 0 };
    eCtx.imageSmoothingEnabled = false;
    eCtx.drawImage(canvas, 0, 0, roiW * scale, roiH * scale);

    const thresholds = [80, 100, 128, 160, 200];
    const variants: string[] = [];

    for (const threshold of thresholds) {
      const variant = document.createElement('canvas');
      variant.width = enlarged.width;
      variant.height = enlarged.height;
      const vCtx = variant.getContext('2d');
      if (!vCtx) continue;
      vCtx.drawImage(enlarged, 0, 0);
      const vd = vCtx.getImageData(0, 0, variant.width, variant.height);
      for (let i = 0; i < vd.data.length; i += 4) {
        const gray = 0.299 * vd.data[i] + 0.587 * vd.data[i + 1] + 0.114 * vd.data[i + 2];
        const val = gray > threshold ? 255 : 0;
        vd.data[i] = val; vd.data[i + 1] = val; vd.data[i + 2] = val;
      }
      vCtx.putImageData(vd, 0, 0);
      variants.push(variant.toDataURL('image/png'));

      const invVariant = document.createElement('canvas');
      invVariant.width = enlarged.width;
      invVariant.height = enlarged.height;
      const iCtx = invVariant.getContext('2d');
      if (!iCtx) continue;
      iCtx.drawImage(variant, 0, 0);
      const id = iCtx.getImageData(0, 0, invVariant.width, invVariant.height);
      for (let i = 0; i < id.data.length; i += 4) {
        id.data[i] = 255 - id.data[i];
        id.data[i + 1] = 255 - id.data[i + 1];
        id.data[i + 2] = 255 - id.data[i + 2];
      }
      iCtx.putImageData(id, 0, 0);
      variants.push(invVariant.toDataURL('image/png'));
    }

    const grayVariant = document.createElement('canvas');
    grayVariant.width = enlarged.width;
    grayVariant.height = enlarged.height;
    const gCtx = grayVariant.getContext('2d');
    if (gCtx) {
      gCtx.drawImage(enlarged, 0, 0);
      const gd = gCtx.getImageData(0, 0, grayVariant.width, grayVariant.height);
      const contrast = 2.5;
      const intercept = 128 * (1 - contrast);
      for (let i = 0; i < gd.data.length; i += 4) {
        const gray = 0.299 * gd.data[i] + 0.587 * gd.data[i + 1] + 0.114 * gd.data[i + 2];
        const adjusted = Math.max(0, Math.min(255, gray * contrast + intercept));
        gd.data[i] = adjusted; gd.data[i + 1] = adjusted; gd.data[i + 2] = adjusted;
      }
      gCtx.putImageData(gd, 0, 0);
      variants.push(grayVariant.toDataURL('image/png'));
    }

    if (!workerRef.current) return { value: null, error: 'ocr_failed', candidateCount: 0, variantCount: variants.length };
    const worker = await workerRef.current;

    const candidates: number[] = [];
    let anyTextFound = false;

    for (const dataUrl of variants) {
      if (stoppedRef.current) return { value: null, error: 'ocr_failed', candidateCount: 0, variantCount: variants.length };
      try {
        const result = await worker.recognize(dataUrl);
        const text = result.data.text || '';
        if (text.trim()) anyTextFound = true;
        const num = extractNumber(text);
        if (num !== null) candidates.push(num);
      } catch { continue; }
    }

    if (candidates.length === 0) {
      const err: ReadError = anyTextFound ? 'no_digits' : 'no_digits';
      return { value: null, error: err, candidateCount: 0, variantCount: variants.length };
    }

    const rounded = candidates.map((c) => Math.round(c * 100) / 100);
    const counts: Record<string, { value: number; count: number }> = {};
    for (const r of rounded) {
      const key = r.toFixed(2);
      if (!counts[key]) counts[key] = { value: r, count: 0 };
      counts[key].count++;
    }

    const sorted = Object.values(counts).sort((a, b) => b.count - a.count);
    const topCount = sorted[0].count;
    const totalCandidates = candidates.length;
    const agreementRatio = topCount / totalCandidates;

    // Require the top value to appear in at least 3 variants AND
    // have >50% agreement among all candidates. This is the key
    // fix — previously single-occurrence values were accepted,
    // producing random readings from OCR noise.
    if (topCount >= 3 && agreementRatio >= 0.5) {
      return { value: sorted[0].value, error: null, candidateCount: totalCandidates, variantCount: variants.length };
    }

    // If we got candidates but none met the threshold, it's noise
    if (topCount >= 2 && agreementRatio >= 0.4) {
      return { value: sorted[0].value, error: null, candidateCount: totalCandidates, variantCount: variants.length };
    }

    return { value: null, error: 'low_confidence', candidateCount: totalCandidates, variantCount: variants.length };
  };

  const handleCapture = async () => {
    if (attempting || stoppedRef.current) return;
    if (!workerReady) return;
    setAttempting(true);
    setLastReading(null);
    setCaptureFeedback(null);
    setCaptureError(null);
    setAttemptsUsed(0);

    try {
      const maxAttempts = 5;
      const allCandidates: number[] = [];
      let lastError: ReadError | null = null;
      let frameWithResult = 0;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (stoppedRef.current) break;
        setAttemptsUsed(attempt + 1);

        const result = await processFrame();
        if (result.value !== null) {
          allCandidates.push(result.value);
          frameWithResult++;
        }
        if (result.error) {
          lastError = result.error;
        }

        // If we got 3+ successful frame readings, try to find consensus
        if (frameWithResult >= 3) {
          const rounded = allCandidates.map((c) => Math.round(c * 100) / 100);
          const counts: Record<string, { value: number; count: number }> = {};
          for (const r of rounded) {
            const key = r.toFixed(2);
            if (!counts[key]) counts[key] = { value: r, count: 0 };
            counts[key].count++;
          }
          const sorted = Object.values(counts).sort((a, b) => b.count - a.count);
          const topCount = sorted[0].count;
          const agreementRatio = topCount / allCandidates.length;

          if (topCount >= 3 && agreementRatio >= 0.6) {
            const num = sorted[0].value;
            const normalized = num.toFixed(2);
            setLastReading(normalized);
            setStatus('stable');
            playBeep();
            if (navigator.vibrate) navigator.vibrate(100);
            cleanup();
            setTimeout(() => onRead(num, 'auto'), 300);
            return;
          }
        }

        await new Promise((r) => setTimeout(r, 250));
      }

      // After all attempts, check if we got any readings at all
      if (allCandidates.length === 0) {
        setCaptureError(lastError ?? 'no_digits');
        setCaptureFeedback(null);
      } else if (frameWithResult >= 2) {
        // We got some readings but they disagree too much
        setCaptureError('inconsistent');
        setCaptureFeedback(`Read ${allCandidates.length} values across ${frameWithResult} frames: ${allCandidates.map((v) => v.toFixed(2)).join(', ')}. They disagree too much to be reliable.`);
      } else {
        // Only 1 frame produced a reading — not enough for confidence
        setCaptureError('low_confidence');
        setCaptureFeedback(`Only 1 frame produced a reading: ${allCandidates[0].toFixed(2)} kg. Not enough confirmation to trust this value.`);
      }
    } catch {
      setCaptureError('ocr_failed');
    } finally {
      setAttempting(false);
    }
  };

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
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } catch { /* audio not available */ }
  };

  const handleClose = () => {
    cleanup();
    onClose();
  };

  const showCaptureError = captureError && !attempting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={handleClose} style={{ pointerEvents: 'auto' }} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary-600" />
            <h3 className="text-sm font-semibold text-[var(--text)]">Auto-Read Weight</h3>
          </div>
          <button type="button" onClick={handleClose} className="relative z-30 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          {status === 'error' ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <CameraOff className="h-12 w-12 text-error-500" />
              <p className="max-w-xs text-sm text-error-500">{errorMsg}</p>
              <div className="w-full border-t border-[var(--border)] pt-4">
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Or enter weight manually:</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={manualWeight}
                    onChange={(e) => setManualWeight(e.target.value)}
                    placeholder="Enter weight in kg"
                    className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const val = parseFloat(manualWeight);
                      if (!isNaN(val) && val > 0) {
                        cleanup();
                        onRead(val, 'manual');
                      }
                    }}
                    disabled={!manualWeight || isNaN(parseFloat(manualWeight))}
                    className="relative z-20 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    Submit
                  </button>
                </div>
              </div>
              <button type="button" onClick={handleClose} className="relative z-30 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]">
                Close
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <video ref={videoRef} className="w-full rounded-xl border border-[var(--border)] bg-black" style={{ aspectRatio: '4 / 3', objectFit: 'cover' }} playsInline muted />
                <canvas ref={canvasRef} className="hidden" />

                {status === 'starting' && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/60">
                    <div className="flex flex-col items-center gap-2 text-white">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <span className="text-sm">Starting camera...</span>
                    </div>
                  </div>
                )}

                {status === 'reading' && (
                  <div className="pointer-events-none absolute inset-0 z-10">
                    <div className="absolute left-1/2 top-1/2 h-[30%] w-[75%] -translate-x-1/2 -translate-y-1/2 border-2 border-primary-500/70 rounded-lg" />
                  </div>
                )}

                {status === 'stable' && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/60">
                    <div className="flex flex-col items-center gap-2 text-white">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-500">
                        <Check className="h-6 w-6 text-white" />
                      </div>
                      <span className="text-sm font-semibold">{lastReading} kg</span>
                    </div>
                  </div>
                )}
              </div>

              {status === 'reading' && (
                <div className="relative z-20 space-y-2">
                  {lastReading && (
                    <div className="flex items-center justify-between rounded-lg bg-[var(--surface-hover)] px-3 py-2">
                      <span className="text-xs text-[var(--text-muted)]">Last reading:</span>
                      <span className="font-mono text-sm font-semibold text-[var(--text)]">{lastReading} kg</span>
                    </div>
                  )}

                  {showCaptureError && (
                    <div className="space-y-2 rounded-lg border border-error-500/30 bg-error-500/10 p-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0 text-error-500 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-error-500">
                            {captureError === 'no_digits' && 'No digits detected'}
                            {captureError === 'low_confidence' && 'Low confidence reading'}
                            {captureError === 'inconsistent' && 'Inconsistent readings'}
                            {captureError === 'image_too_small' && 'Image too small'}
                            {captureError === 'ocr_failed' && 'OCR processing failed'}
                          </p>
                          <p className="mt-1 text-xs text-error-500/80">{ERROR_MESSAGES[captureError]}</p>
                          {captureFeedback && (
                            <p className="mt-1 text-xs text-[var(--text-muted)]">{captureFeedback}</p>
                          )}
                        </div>
                      </div>
                      {attemptsUsed > 0 && (
                        <p className="text-xs text-[var(--text-subtle)]">Tried {attemptsUsed} frame(s) across multiple image variants.</p>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleCapture}
                    disabled={attempting || !workerReady}
                    className="relative z-20 flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                  >
                    {attempting ? (
                      <><Loader2 className="h-5 w-5 animate-spin" /> Reading... (frame {attemptsUsed}/5)</>
                    ) : showCaptureError ? (
                      <><RotateCw className="h-5 w-5" /> Try again</>
                    ) : !workerReady ? (
                      <><Loader2 className="h-5 w-5 animate-spin" /> Loading OCR engine...</>
                    ) : (
                      <><Camera className="h-5 w-5" /> Capture & Read</>
                    )}
                  </button>

                  {attempting && (
                    <p className="text-center text-xs text-[var(--text-muted)]">
                      Capturing and analyzing multiple frames... {attemptsUsed}/5 done
                    </p>
                  )}

                  <div className="flex items-start gap-2 rounded-lg bg-primary-500/5 p-3 text-xs text-[var(--text-muted)]">
                    <AlertCircle className="h-4 w-4 shrink-0 text-primary-500" />
                    <span>Align the scale's digits inside the rectangle, ensure good lighting and no glare, then tap "Capture & Read". The app analyzes up to 5 frames across multiple image variants and only accepts a reading when multiple frames agree.</span>
                  </div>
                </div>
              )}

              <button type="button" onClick={handleClose} className="relative z-20 w-full rounded-lg border border-[var(--border)] py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]">
                Cancel
              </button>

              <div className="border-t border-[var(--border)] pt-3">
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Or enter weight manually:</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={manualWeight}
                    onChange={(e) => setManualWeight(e.target.value)}
                    placeholder="Enter weight in kg"
                    className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-primary-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const val = parseFloat(manualWeight);
                      if (!isNaN(val) && val > 0) {
                        cleanup();
                        onRead(val, 'manual');
                      }
                    }}
                    disabled={!manualWeight || isNaN(parseFloat(manualWeight))}
                    className="relative z-20 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    Submit
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
