
export interface Point {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export type ViewportState = 'READY' | 'MOVE_LEFT' | 'MOVE_RIGHT' | 'TOO_CLOSE' | 'TOO_FAR' | 'NOT_DETECTED' | 'ANALYZING' | 'RECORDING' | 'PROCESSING_FILE';

export type SessionState = 'IDLE' | 'RECORDING' | 'ANALYZING' | 'COOLDOWN' | 'UPLOADING';

export interface ViewportStatus {
  state: ViewportState;
  instruction: string;
}

export interface HolisticResults {
  faceLandmarks?: Point[];
  poseLandmarks?: Point[];
  leftHandLandmarks?: Point[];
  rightHandLandmarks?: Point[];
  image: HTMLCanvasElement | HTMLVideoElement | ImageBitmap;
}

export interface LandmarkStats {
  face: number;
  pose: number;
  leftHand: number;
  rightHand: number;
  total: number;
  activeFeatures: number;
}

export interface PredictionResult {
  word: string;
  confidence: number;
}

export interface AppConfig {
  app_settings: {
    app_name: string;
    version: string;
    debug_mode: boolean;
  };
  model_config: {
    profile: string;
    target_frames: number;
    input_shape: number[];
    labels: string[];
  };
  keypoints_config: {
    profiles: {
      [key: string]: {
        pose_indices: "ALL" | "NONE" | number[];
        face_indices: "ALL" | "NONE" | number[];
        leftHand_indices: "ALL" | "NONE" | number[];
        rightHand_indices: "ALL" | "NONE" | number[];
        total_points: number;
        features: number;
      }
    };
    flattening_order: string[];
  };
  visual_config: {
    colors: {
      pose: string;
      hands: string;
      face: string;
      ready: string;
      error: string;
      analyzing: string;
    };
    drawing: {
      landmark_radius: number;
      line_width: number;
      connector_line_width: number;
    };
  };
  inference_logic: {
    confidence_threshold: number;
    min_hand_movement: number;
    prediction_cooldown_ms: number;
  };
}
