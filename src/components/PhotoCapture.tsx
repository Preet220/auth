import { useEffect, useRef, useState } from 'react';
import { X, Camera, Check, RotateCcw, Loader as Loader2, CameraOff } from 'lucide-react';

interface Props {
  onCapture: (photoDataUrl: string) => void;
  onClose: () => void;
  title?: string;
}

export function PhotoCapture({ onCapture, onClose, title = 'Capture Photo' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<'starting' | 'live' | 'captured' | 'error'>('starting');
  const [photoUrl, setPhotoUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let mounted = true;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
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
        setStatus('live');
      } catch {
        if (mounted) {
          setStatus('error');
          setErrorMsg('Could not access camera. Please check permissions.');
        }
      }
    };

    startCamera();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const capture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) return;

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    const quality = 0.7;
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    setPhotoUrl(dataUrl);
    setStatus('captured');
    stopCamera();
  };

  const retake = async () => {
    setPhotoUrl('');
    setStatus('starting');
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
      setStatus('live');
    } catch {
      setStatus('error');
      setErrorMsg('Could not access camera.');
    }
  };

  const confirm = () => {
    stopCamera();
    onCapture(photoUrl);
  };

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={handleClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary-600" />
            <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
          </div>
          <button onClick={handleClose} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          {status === 'error' ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <CameraOff className="h-12 w-12 text-error-500" />
              <p className="max-w-xs text-sm text-error-500">{errorMsg}</p>
              <button onClick={handleClose} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]">
                Close
              </button>
            </div>
          ) : status === 'captured' ? (
            <div className="space-y-3">
              <img src={photoUrl} alt="Captured" className="w-full rounded-xl border border-[var(--border)]" style={{ maxHeight: '400px', objectFit: 'contain' }} />
              <div className="flex gap-3">
                <button onClick={retake} className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--border)] py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]">
                  <RotateCcw className="h-4 w-4" /> Retake
                </button>
                <button onClick={confirm} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent-600 py-2.5 text-sm font-semibold text-white hover:bg-accent-700">
                  <Check className="h-4 w-4" /> Use photo
                </button>
              </div>
            </div>
          ) : (
            <div className="relative">
              <video ref={videoRef} className="w-full rounded-xl border border-[var(--border)] bg-black" style={{ aspectRatio: '4 / 3', objectFit: 'cover' }} playsInline muted />
              <canvas ref={canvasRef} className="hidden" />
              {status === 'starting' && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60">
                  <div className="flex flex-col items-center gap-2 text-white">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <span className="text-sm">Starting camera...</span>
                  </div>
                </div>
              )}
              {status === 'live' && (
                <button onClick={capture} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-3 text-sm font-semibold text-white hover:bg-primary-700">
                  <Camera className="h-5 w-5" /> Take photo
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
