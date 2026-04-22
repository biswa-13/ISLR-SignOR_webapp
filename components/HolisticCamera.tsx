
import React, { useEffect, useRef, useState } from 'react';
import { HolisticResults, AppConfig, ViewportStatus, PredictionResult, SessionState } from '../types';
import { FeatureExtractor } from '../services/FeatureExtractor';

interface HolisticCameraProps {
  enabled: boolean;
  config: AppConfig;
  facingMode: 'user' | 'environment';
  isMirrored: boolean;
  prediction: PredictionResult | null;
  isAnalyzing: boolean;
  onViewportStatusChange: (status: ViewportStatus) => void;
  onResults: (results: HolisticResults, filteredPoints: number[]) => void;
  onSequenceComplete: (sequence: number[][], debugImages?: string[]) => void;
  onFpsUpdate: (fps: number) => void;
  onDebugFrames?: (frames: string[]) => void;
  onError: (error: string) => void;
}

const HolisticCamera: React.FC<HolisticCameraProps> = ({ 
  enabled, config, facingMode, isMirrored, prediction, isAnalyzing, 
  onViewportStatusChange, onResults, onSequenceComplete, onFpsUpdate, onDebugFrames, onError
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionState, setSessionState] = useState<SessionState>('IDLE');
  const sessionStateRef = useRef<SessionState>('IDLE');
  const sequenceBuffer = useRef<number[][]>([]);
  const frameImageBuffer = useRef<string[]>([]);
  const configRef = useRef<AppConfig>(config);
  const lastTimeRef = useRef<number>(performance.now());
  const framesRef = useRef<number>(0);
  const cameraInstanceRef = useRef<any>(null);
  const holisticInstanceRef = useRef<any>(null);
  const onSequenceCompleteRef = useRef(onSequenceComplete);
  const onResultsRef = useRef(onResults);
  const onViewportStatusChangeRef = useRef(onViewportStatusChange);

  useEffect(() => {
    onSequenceCompleteRef.current = onSequenceComplete;
  }, [onSequenceComplete]);

  useEffect(() => {
    onResultsRef.current = onResults;
  }, [onResults]);

  useEffect(() => {
    onViewportStatusChangeRef.current = onViewportStatusChange;
  }, [onViewportStatusChange]);

  const alignSequenceLength = (sequence: number[][], targetLen: number, images?: string[]): { sequence: number[][], images?: string[] } => {
    if (sequence.length === 0) return { sequence: [] };
    
    // Linear Resampling (Interpolation) to match VideoProcessor's uniform sampling
    const resampled: number[][] = [];
    const resampledImages: string[] = [];
    const n = sequence.length;
    
    for (let i = 0; i < targetLen; i++) {
      const idx = (i * (n - 1)) / (targetLen - 1);
      const low = Math.floor(idx);
      const high = Math.ceil(idx);
      const weight = idx - low;
      
      if (low === high) {
        resampled.push([...sequence[low]]);
        if (images) resampledImages.push(images[low]);
      } else {
        const frameLow = sequence[low];
        const frameHigh = sequence[high];
        const interpolatedFrame = frameLow.map((val, j) => val + weight * (frameHigh[j] - val));
        resampled.push(interpolatedFrame);
        // For images, we just take the closest one or the 'low' one to avoid complex image interpolation
        if (images) resampledImages.push(weight < 0.5 ? images[low] : images[high]);
      }
    }
    return { sequence: resampled, images: images ? resampledImages : undefined };
  };
  
  const checkHandActivity = (results: any): boolean => {
    // Presence check: are hands detected at all?
    const hasLH = !!(results.leftHandLandmarks && results.leftHandLandmarks.length > 0);
    const hasRH = !!(results.rightHandLandmarks && results.rightHandLandmarks.length > 0);
    
    if (!hasLH && !hasRH) return false;

    // Movement check: are hands moving or above a certain level?
    if (!results.poseLandmarks) return false;
    const lS = results.poseLandmarks[11], rS = results.poseLandmarks[12];
    if (!lS || !rS) return false;
    
    // Threshold: hands should be above the mid-torso
    const threshold = Math.min(lS.y, rS.y) + 0.25; 
    const activeLH = hasLH && results.leftHandLandmarks.some((p: any) => p.y < threshold);
    const activeRH = hasRH && results.rightHandLandmarks.some((p: any) => p.y < threshold);
    
    return !!(activeLH || activeRH);
  };

  const checkViewportLogic = (poseLandmarks: any[] | undefined): ViewportStatus => {
    if (!poseLandmarks || poseLandmarks.length === 0) return { state: 'NOT_DETECTED', instruction: 'Detecting User...' };
    const lS = poseLandmarks[11], rS = poseLandmarks[12];
    if (!lS || !rS) return { state: 'NOT_DETECTED', instruction: 'Show Full Shoulders' };

    const shoulderScale = Math.hypot(rS.x - lS.x, rS.y - lS.y);
    if (shoulderScale > 0.65) return { state: 'TOO_CLOSE', instruction: 'MOVE BACK' };
    if (shoulderScale < 0.08) return { state: 'TOO_FAR', instruction: 'MOVE CLOSER' };
    
    if (sessionStateRef.current === 'RECORDING') return { state: 'RECORDING', instruction: 'RECORDING...' };
    if (isAnalyzing) return { state: 'ANALYZING', instruction: 'ANALYZING...' };
    return { state: 'READY', instruction: 'READY TO SIGN' };
  };

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    if (!enabled) {
        cameraInstanceRef.current?.stop();
        holisticInstanceRef.current?.close();
        return;
    }

    const active = { current: true };
    const preRollBuffer: number[][] = [];
    const preRollImageBuffer: string[] = [];
    const POST_ROLL_FRAMES = 15;
    let postRollCounter = 0;
    
    const initHolistic = async () => {
      // Use global MediaPipe objects from window (loaded via script tags in index.html)
      // Sometimes these are wrapped in a module object depending on how they are loaded
      const resolveConstructor = (obj: any, name: string) => {
        if (typeof obj === 'function') return obj;
        if (obj && typeof obj[name] === 'function') return obj[name];
        if (obj && typeof obj.default === 'function') return obj.default;
        return null;
      };

      const MP_H_Raw = (window as any).Holistic;
      const MP_H = resolveConstructor(MP_H_Raw, 'Holistic');
      const MP_D = (window as any); // drawing_utils attaches to window
      const CameraClassRaw = (window as any).Camera;
      const CameraClass = resolveConstructor(CameraClassRaw, 'Camera');

      if (!active.current) return;

      if (!MP_H) {
        console.error("HolisticCamera: Holistic is not available on window!", { 
          MP_H_Raw,
          type: typeof MP_H_Raw,
          windowKeys: Object.keys(window).filter(k => k.includes('Holistic') || k.includes('Camera'))
        });
        throw new TypeError("Holistic is not available.");
      }

      const holistic = new MP_H({ 
        locateFile: (file: string) => `/lib/mediapipe/holistic/${file}` 
      });
      holisticInstanceRef.current = holistic;
      
      holistic.setOptions({ 
        modelComplexity: 1, 
        smoothLandmarks: false, // Match VideoProcessor.ts for consistency
        minDetectionConfidence: 0.5, 
        minTrackingConfidence: 0.5 
      });

    holistic.onResults((results: any) => {
      if (!active.current || !enabled) return;
      
      const currentConfig = configRef.current;
      const isDebug = currentConfig.app_settings.debug_mode;
      if (framesRef.current % 100 === 0) {
        console.log(`HolisticCamera: Loop active. DebugMode: ${isDebug}. SessionState: ${sessionStateRef.current}`);
      }

      const viewport = checkViewportLogic(results.poseLandmarks);
      onViewportStatusChangeRef.current(viewport);

      const { data } = FeatureExtractor.extract(results);
      const handsActive = checkHandActivity(results);

      // Capture frame image if debug mode is on
      let currentFrameImage = '';
      if (isDebug && canvasRef.current) {
        currentFrameImage = canvasRef.current.toDataURL('image/jpeg', 0.5);
      }

      if (sessionStateRef.current === 'IDLE') {
        preRollBuffer.push(data);
        if (isDebug) {
          preRollImageBuffer.push(currentFrameImage);
          if (preRollImageBuffer.length > 10) preRollImageBuffer.shift();
        }
        if (preRollBuffer.length > 10) preRollBuffer.shift();

        if (handsActive && viewport.state === 'READY') {
          console.log("HolisticCamera: Hand activity detected, starting recording.");
          sessionStateRef.current = 'RECORDING';
          setSessionState('RECORDING');
          if (onDebugFrames) onDebugFrames([]);
          sequenceBuffer.current = [...preRollBuffer, data];
          if (isDebug) {
            frameImageBuffer.current = [...preRollImageBuffer, currentFrameImage];
          }
          postRollCounter = 0;
        }
      } else if (sessionStateRef.current === 'RECORDING') {
        sequenceBuffer.current.push(data);
        if (isDebug) {
          frameImageBuffer.current.push(currentFrameImage);
          if (frameImageBuffer.current.length > 300) frameImageBuffer.current.shift();
        }
        if (sequenceBuffer.current.length > 300) sequenceBuffer.current.shift();

        if (!handsActive) {
          postRollCounter++;
          if (postRollCounter >= POST_ROLL_FRAMES) {
            const finalLen = sequenceBuffer.current.length;
            console.log(`HolisticCamera: Hand activity stopped. Raw sequence length: ${finalLen}`);
            if (finalLen > 15) {
              console.log(`HolisticCamera: Resampling ${finalLen} frames to 64.`);
              sessionStateRef.current = 'ANALYZING';
              setSessionState('ANALYZING');
              const { sequence: resampled, images: resampledImages } = alignSequenceLength(
                sequenceBuffer.current, 
                64, 
                isDebug ? frameImageBuffer.current : undefined
              );
                
                if (resampledImages && onDebugFrames) {
                  onDebugFrames(resampledImages);
                }
                
                onSequenceCompleteRef.current(resampled, resampledImages);
                setTimeout(() => { 
                    sessionStateRef.current = 'IDLE'; 
                    setSessionState('IDLE'); 
                    sequenceBuffer.current = []; 
                    frameImageBuffer.current = [];
                    preRollBuffer.length = 0;
                    preRollImageBuffer.length = 0;
                }, config.inference_logic.prediction_cooldown_ms);
              } else {
                console.log("HolisticCamera: Sequence too short, discarding.");
                sessionStateRef.current = 'IDLE'; 
                setSessionState('IDLE'); 
                sequenceBuffer.current = [];
                frameImageBuffer.current = [];
                preRollBuffer.length = 0;
                preRollImageBuffer.length = 0;
              }
            }
          } else {
            postRollCounter = 0;
          }
        }

        onResultsRef.current(results, data);
        framesRef.current++;
        const now = performance.now();
        if (now - lastTimeRef.current >= 1000) {
          onFpsUpdate(Math.round((framesRef.current * 1000) / (now - lastTimeRef.current)));
          framesRef.current = 0; lastTimeRef.current = now;
        }

        const canvasCtx = canvasRef.current?.getContext('2d');
        if (!canvasCtx || !canvasRef.current) return;
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        if (isMirrored) { canvasCtx.scale(-1, 1); canvasCtx.translate(-canvasRef.current.width, 0); }
        canvasCtx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
        
        const drawSet = (pts: any[], conn: any, color: string) => {
          if (!pts) return;
          MP_D.drawConnectors(canvasCtx, pts, conn, { color, lineWidth: 1.5 });
          MP_D.drawLandmarks(canvasCtx, pts, { color, lineWidth: 1, radius: 2 });
        };

        drawSet(results.poseLandmarks, (window as any).POSE_CONNECTIONS, config.visual_config.colors.pose);
        drawSet(results.leftHandLandmarks, (window as any).HAND_CONNECTIONS, config.visual_config.colors.hands);
        drawSet(results.rightHandLandmarks, (window as any).HAND_CONNECTIONS, config.visual_config.colors.hands);
        
        if (results.faceLandmarks) {
            MP_D.drawConnectors(canvasCtx, results.faceLandmarks, (window as any).FACEMESH_TESSELATION, { 
              color: config.visual_config.colors.face, 
              lineWidth: 0.5 
            });
        }
        canvasCtx.restore();
        if (isLoading) setIsLoading(false);
      });

      if (typeof CameraClass !== 'function') {
        console.error("HolisticCamera: Camera is not available on window!");
        throw new TypeError("Camera is not available.");
      }

      cameraInstanceRef.current = new CameraClass(videoRef.current!, {
        onFrame: async () => { 
          if (videoRef.current && active.current && enabled) {
            try { await holistic.send({ image: videoRef.current }); } catch (e) {}
          }
        },
        width: 1280, height: 720, facingMode
      });
      
      cameraInstanceRef.current.start().catch((err: any) => {
        setIsLoading(false);
        onError(err.name || 'Camera Error');
      });
    };

    initHolistic();

    return () => { 
      active.current = false; 
      cameraInstanceRef.current?.stop(); 
      holisticInstanceRef.current?.close(); 
    };
  }, [enabled, facingMode]);

  return (
    <div className={`relative w-full h-full bg-black overflow-hidden ${sessionState === 'RECORDING' ? 'ring-4 ring-indigo-500 ring-inset animate-pulse' : ''}`}>
      {isLoading && enabled && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"/>
          <p className="text-indigo-400 font-bold uppercase tracking-[0.3em] text-[9px]">Waking ML Sensors...</p>
        </div>
      )}
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className={`w-full h-full object-cover ${!enabled ? 'hidden' : ''}`} width={1280} height={720} />
    </div>
  );
};

export default HolisticCamera;
