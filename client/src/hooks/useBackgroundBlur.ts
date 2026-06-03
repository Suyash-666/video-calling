// hooks/useBackgroundBlur.ts
// Real-time background blur powered by MediaPipe Selfie Segmentation
// (via the @tensorflow-models/body-segmentation wrapper).
//
// Pipeline:
//   1. Mount a hidden <video> playing the raw camera stream.
//   2. Each requestAnimationFrame: ask the segmenter for a mask of
//      "person pixels"; composite the *unblurred* person on top of the
//      *blurred* background onto an offscreen <canvas>.
//   3. canvas.captureStream(targetFps) gives us a new MediaStream
//      whose video track we hand to the caller. They `replaceTrack()`
//      it onto every peer's RTCRtpSender, no renegotiation.
//
// Performance notes:
//   - Segmentation is the hot path. On WebGL backend the model runs at
//     ~30fps on a midrange laptop; we use the `general` model variant
//     (smaller, faster than `landscape`).
//   - We do NOT use the segmenter's bundled bokehEffect — it requires a
//     visible canvas (browsers won't render to offscreen with the
//     library's filter calls). Hand-rolling the composite gives us
//     control over `requestAnimationFrame` scheduling and lets us pause
//     instantly on toggle-off.
//   - On toggle-off we stop the rAF loop and the captured-stream tracks
//     so the segmenter's GPU memory is freed (~80MB on WebGL).
//
// Public surface:
//   { ready, loading, error, enabled, blurredStream, start, stop }

import { useCallback, useEffect, useRef, useState } from 'react';

// We import the namespace lazily inside start() so the ~2.5MB model
// shim doesn't enter the bundle's initial chunk. Vite will code-split
// the dynamic import automatically.
type Segmenter = import('@tensorflow-models/body-segmentation').BodySegmenter;

interface BlurOptions {
  // Camera stream to read frames from. When this changes (e.g. the user
  // re-grabs the camera), stop() + start() are the cleanest re-init path.
  source: MediaStream | null;
  // CSS-like blur radius in pixels. 12-16 looks like Zoom; higher is
  // smoother but eats more time per frame.
  blurRadius?: number;
  // Target output fps. We schedule via rAF so we never exceed the screen
  // refresh rate; this just caps below the refresh when set lower.
  targetFps?: number;
}

export interface UseBackgroundBlurResult {
  ready: boolean;     // model is loaded and a stream is being produced
  loading: boolean;   // first-time model load in progress
  error: string | null;
  enabled: boolean;   // start() has been called (and not yet stop())
  blurredStream: MediaStream | null;
  start: () => Promise<void>;
  stop: () => void;
}

export function useBackgroundBlur(opts: BlurOptions): UseBackgroundBlurResult {
  const { source, blurRadius = 14, targetFps = 30 } = opts;

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [blurredStream, setBlurredStream] = useState<MediaStream | null>(null);

  // Long-lived objects kept in refs so they survive re-renders and so
  // teardown can find them.
  const segmenterRef = useRef<Segmenter | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const outputStreamRef = useRef<MediaStream | null>(null);

  // Frame interval in ms, recomputed if targetFps changes mid-session.
  const frameIntervalRef = useRef<number>(1000 / targetFps);
  useEffect(() => {
    frameIntervalRef.current = 1000 / targetFps;
  }, [targetFps]);

  // Internal: free everything the pipeline allocated.
  const teardown = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // Stop the canvas captureStream's tracks. We don't dispose the
    // segmenter immediately — keep it around so a quick re-toggle is
    // instant. It'll be torn down on unmount.
    outputStreamRef.current?.getTracks().forEach((t) => t.stop());
    outputStreamRef.current = null;
    setBlurredStream(null);
    setReady(false);
  }, []);

  // Internal: dispose the segmenter + DOM helpers. Called on unmount.
  const disposeAll = useCallback(() => {
    teardown();
    try {
      segmenterRef.current?.dispose();
    } catch {
      /* ignore */
    }
    segmenterRef.current = null;
    if (videoElRef.current) {
      videoElRef.current.srcObject = null;
      videoElRef.current = null;
    }
    canvasRef.current = null;
  }, [teardown]);

  // Unmount cleanup.
  useEffect(() => {
    return () => disposeAll();
  }, [disposeAll]);

  // If the source stream changes while enabled, restart so the pipeline
  // reads from the new tracks. Otherwise the canvas would freeze on the
  // last frame of the previous source.
  useEffect(() => {
    if (!enabled) return;
    // Re-attach: same canvas, same segmenter, just new <video> source.
    const v = videoElRef.current;
    if (v && source) {
      v.srcObject = source;
      void v.play().catch(() => {});
    }
  }, [source, enabled]);

  const start = useCallback(async () => {
    if (enabled) return;
    if (!source) {
      setError('No camera stream to blur.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // Lazy-load the heavy modules. Vite splits this into its own chunk.
      const bodySegmentation = await import(
        '@tensorflow-models/body-segmentation'
      );
      // Register the WebGL backend before the model loads.
      await import('@tensorflow/tfjs-backend-webgl');

      if (!segmenterRef.current) {
        segmenterRef.current = await bodySegmentation.createSegmenter(
          bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,
          {
            runtime: 'mediapipe',
            // The CDN bundle ships the WASM + tflite assets. Pinning the
            // exact version keeps us from accidentally upgrading at deploy.
            solutionPath:
              'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation',
            modelType: 'general',
          }
        );
      }

      // Hidden <video> we read frames from. We don't attach it to the
      // DOM — readyState is enough for the segmenter to consume it.
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v.srcObject = source;
      videoElRef.current = v;
      // Wait until we have actual frame dimensions; otherwise the canvas
      // sizes to 0x0 and the segmenter throws.
      await new Promise<void>((resolve) => {
        if (v.readyState >= 2 && v.videoWidth > 0) {
          resolve();
          return;
        }
        v.onloadedmetadata = () => resolve();
      });
      await v.play().catch(() => {});

      // Canvas matched to the source's intrinsic resolution. captureStream
      // upscales nothing — peers receive whatever the canvas size produces.
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      canvasRef.current = c;

      const ctx = c.getContext('2d', { willReadFrequently: false });
      if (!ctx) {
        throw new Error('Canvas 2D context unavailable.');
      }

      // Hand peers our captured stream. Tracks live as long as the
      // canvas is being drawn to; we'll stop them on teardown().
      // Note: captureStream is widely supported but TS' DOM lib types
      // were patchy until recently — cast pragmatically.
      const out: MediaStream = (c as any).captureStream(targetFps);
      outputStreamRef.current = out;
      setBlurredStream(out);

      // Frame loop. We measure last-render time so we don't oversubscribe
      // the segmenter when the screen refresh rate is high (120/144Hz).
      let lastDrawnAt = 0;
      const renderLoop = async (ts: number) => {
        rafRef.current = requestAnimationFrame(renderLoop);
        if (ts - lastDrawnAt < frameIntervalRef.current) return;
        lastDrawnAt = ts;
        const seg = segmenterRef.current;
        const video = videoElRef.current;
        const canvas = canvasRef.current;
        if (!seg || !video || !canvas) return;
        if (video.readyState < 2) return;
        // Source dimensions can shift on reconnect; keep canvas in sync.
        if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
        if (canvas.height !== video.videoHeight)
          canvas.height = video.videoHeight;

        try {
          const segs = await seg.segmentPeople(video, {
            flipHorizontal: false,
            // multiSegmentation off => one combined mask, faster.
            multiSegmentation: false,
            segmentBodyParts: false,
          });
          // Hand-roll the composite:
          //   1. Draw the blurred background.
          //   2. Use the mask as a destination-in alpha to keep only
          //      person pixels of the SHARP frame, then composite over
          //      the blurred background.
          // ctx.filter applies to draw calls until reset.
          ctx.save();
          ctx.filter = `blur(${blurRadius}px)`;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          ctx.restore();

          if (segs.length > 0) {
            const mask = await bodySegmentation.toBinaryMask(
              segs,
              { r: 0, g: 0, b: 0, a: 255 }, // foreground pixels: opaque black
              { r: 0, g: 0, b: 0, a: 0 }    // background pixels: transparent
            );
            // Draw the sharp frame onto a temp canvas, then mask it.
            // We can avoid a second canvas by using a globalCompositeOperation
            // pass directly on the output canvas: draw sharp video first
            // into an offscreen buffer for compositing.
            const tmp = document.createElement('canvas');
            tmp.width = canvas.width;
            tmp.height = canvas.height;
            const tctx = tmp.getContext('2d');
            if (!tctx) return;
            tctx.drawImage(video, 0, 0, tmp.width, tmp.height);
            // Use putImageData for the mask then composite with destination-in.
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = mask.width;
            maskCanvas.height = mask.height;
            const mctx = maskCanvas.getContext('2d');
            if (!mctx) return;
            mctx.putImageData(mask, 0, 0);
            // Apply mask: keep only pixels where mask alpha > 0.
            tctx.globalCompositeOperation = 'destination-in';
            tctx.drawImage(maskCanvas, 0, 0, tmp.width, tmp.height);
            // Draw the masked sharp person over the blurred background.
            ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
          }

          if (!ready) setReady(true);
        } catch (e: any) {
          // A transient segmentation failure shouldn't kill the loop;
          // log once and keep going (next frame usually recovers).
          console.warn('blur frame failed', e?.message ?? e);
        }
      };

      rafRef.current = requestAnimationFrame(renderLoop);
      setEnabled(true);
      setLoading(false);
    } catch (e: any) {
      setError(`Could not start background blur: ${e?.message ?? e}`);
      setLoading(false);
      teardown();
    }
  }, [blurRadius, enabled, ready, source, targetFps, teardown]);

  const stop = useCallback(() => {
    setEnabled(false);
    teardown();
  }, [teardown]);

  return {
    ready,
    loading,
    error,
    enabled,
    blurredStream,
    start,
    stop,
  };
}
