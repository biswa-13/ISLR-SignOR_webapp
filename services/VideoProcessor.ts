
import { AppConfig } from '../types';
import { FeatureExtractor, ExtractionResult } from './FeatureExtractor';

export class VideoProcessor {
  private holistic: any = null;

  private async ensureInitialized() {
    if (this.holistic) return;

    // Use global MediaPipe objects from window (loaded via script tags in index.html)
    const resolveConstructor = (obj: any, name: string) => {
      if (typeof obj === 'function') return obj;
      if (obj && typeof obj[name] === 'function') return obj[name];
      if (obj && typeof obj.default === 'function') return obj.default;
      return null;
    };

    const HolisticClassRaw = (window as any).Holistic;
    const HolisticClass = resolveConstructor(HolisticClassRaw, 'Holistic');
    
    if (!HolisticClass) {
      console.error("VideoProcessor: Holistic is not available on window!", { 
        HolisticClassRaw,
        type: typeof HolisticClassRaw,
        windowKeys: Object.keys(window).filter(k => k.includes('Holistic'))
      });
      throw new TypeError("Holistic is not available.");
    }

    this.holistic = new HolisticClass({
      locateFile: (file: string) => `/lib/mediapipe/holistic/${file}`,
    });

    this.holistic.setOptions({
      modelComplexity: 1,
      smoothLandmarks: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  async processVideo(
    file: File, 
    config: AppConfig, 
    onProgress: (p: number) => void,
    onFrameLog?: (frameIdx: number, meta: any) => void,
    onDebugFrames?: (frames: string[]) => void
  ): Promise<number[][]> {
    await this.ensureInitialized();
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;

    await new Promise((resolve) => {
      video.onloadedmetadata = resolve;
    });

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const targetFrames = config.model_config.target_frames;
    const duration = video.duration;
    const interval = duration / targetFrames;
    const sequence: number[][] = [];
    const debugFrames: string[] = [];

    let resolveFrame: ((result: ExtractionResult) => void) | null = null;
    this.holistic.onResults((results: any) => {
        const extraction = FeatureExtractor.extract(results);
        if (resolveFrame) resolveFrame(extraction);
    });

    for (let i = 0; i < targetFrames; i++) {
      video.currentTime = Math.min(i * interval, duration);
      await new Promise((resolve) => { video.onseeked = resolve; });
      
      if (config.app_settings.debug_mode && ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        debugFrames.push(canvas.toDataURL('image/jpeg', 0.5));
      }

      const frameResult = await new Promise<ExtractionResult>((resolve) => {
        resolveFrame = resolve;
        this.holistic.send({ image: video });
      });
      sequence.push(frameResult.data);
      if (onFrameLog) onFrameLog(i, frameResult.meta);
      onProgress(Math.round(((i + 1) / targetFrames) * 100));
    }

    if (config.app_settings.debug_mode && onDebugFrames) {
      onDebugFrames(debugFrames);
    }

    URL.revokeObjectURL(video.src);
    this.holistic.onResults(() => {}); 
    // SignEngine will handle padding if frames are missing or sequence is shorter
    return sequence;
  }
}

export const videoProcessor = new VideoProcessor();
