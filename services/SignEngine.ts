import { PredictionResult, AppConfig } from "../types";

// We prefer running the new `.tflite` model in-browser via TFJS-TFLite.
// If that fails (missing deps, WASM download blocked, etc.), we fall back to ONNX Runtime Web.

const MODEL_TFLITE_URL = "/models/mobile_islr_75kp.tflite";
const MODEL_ONNX_URL = "/models/mobile_islr_75kp.onnx";

const ORT_VERSION = "1.20.0";
const ORT_CDN_URL = `/lib/onnx/`;

// Keep the TFJS versions in sync with package.json.
const TFJS_WASM_VERSION = "4.22.0";
const TFJS_WASM_CDN_URL = `/lib/tfjs/`;

const TFJS_TFLITE_VERSION = "0.0.1-alpha.10";
const TFJS_TFLITE_CDN_URL = `/lib/tfjs/`;

export interface InferenceDebugInfo {
  backend: "tflite" | "onnx";
  min: number;
  max: number;
  mean: number;
  top10: { word: string; confidence: number }[];
  inputShape: number[];
}

type Backend = "tflite" | "onnx";

export class SignEngine {
  private backend: Backend | null = null;

  // TFLite (TFJS)
  private tf: any | null = null;
  private tfliteModel: any | null = null;

  // ONNX (fallback)
  private ort: any | null = null;
  private ortSession: any | null = null;

  private isModelLoaded = false;
  private isInitializing = true;
  private initializationError: string | null = null;

  constructor() {
    console.log("SignEngine: Constructor called.");
    this.initLocalModel();
  }

  private async initLocalModel() {
    console.log("SignEngine: Initializing...");
    try {
      // Prefer TFLite.
      await this.tryInitTflite();
      this.backend = "tflite";
      this.isModelLoaded = true;
      console.log("SignEngine: TFLite initialized successfully.");
    } catch (tfliteErr: any) {
      console.warn("SignEngine: TFLite init failed, falling back to ONNX.", tfliteErr);
      // Fall back to ONNX.
      try {
        await this.tryInitOnnx();
        this.backend = "onnx";
        this.isModelLoaded = true;
        console.log("SignEngine: ONNX initialized successfully.");
      } catch (onnxErr: any) {
        const tMsg = (tfliteErr && (tfliteErr.message || String(tfliteErr))) || "TFLite init failed";
        const oMsg = (onnxErr && (onnxErr.message || String(onnxErr))) || "ONNX init failed";
        this.initializationError = `Model init failed. TFLite: ${tMsg}. ONNX: ${oMsg}.`;
        console.error("SignEngine: All backends failed to initialize.", this.initializationError);
      }
    } finally {
      this.isInitializing = false;
    }
  }

  private async tryInitTflite() {
    console.log(`SignEngine: Attempting to fetch TFLite model from ${MODEL_TFLITE_URL}`);
    // Ensure model file is present.
    const resp = await fetch(MODEL_TFLITE_URL);
    if (!resp.ok) {
      console.error(`SignEngine: TFLite model fetch failed with status ${resp.status}`);
      throw new Error(`Model missing at ${MODEL_TFLITE_URL}`);
    }
    console.log("SignEngine: TFLite model fetched successfully.");

    // Load TFJS core + WASM backend.
    console.log("SignEngine: Loading TFJS dependencies...");
    const tf = await import("@tensorflow/tfjs-core");
    const wasm = await import("@tensorflow/tfjs-backend-wasm");

    // TFJS backend-wasm needs its .wasm assets reachable.
    const setWasmPath = (wasm as any).setWasmPath || (wasm as any).setWasmPaths;
    if (typeof setWasmPath === "function") {
      console.log(`SignEngine: Setting WASM path to ${TFJS_WASM_CDN_URL}`);
      setWasmPath(TFJS_WASM_CDN_URL);
    }

    console.log("SignEngine: Setting backend to WASM...");
    await (tf as any).setBackend("wasm");
    await (tf as any).ready();
    console.log("SignEngine: TFJS WASM backend ready.");

    // Load TFJS-TFLite.
    console.log("SignEngine: Loading TFJS-TFLite...");
    const tflite = await import("@tensorflow/tfjs-tflite");
    if (typeof (tflite as any).setWasmPath === "function") {
      console.log(`SignEngine: Setting TFLite WASM path to ${TFJS_TFLITE_CDN_URL}`);
      (tflite as any).setWasmPath(TFJS_TFLITE_CDN_URL);
    }

    const loadFn = (tflite as any).loadTFLiteModel;
    if (typeof loadFn !== "function") {
      throw new Error("@tensorflow/tfjs-tflite missing loadTFLiteModel() export");
    }

    console.log("SignEngine: Loading TFLite model into memory...");
    this.tfliteModel = await loadFn(MODEL_TFLITE_URL, { numThreads: 1 });
    this.tf = tf;
    console.log("SignEngine: TFLite model loaded into memory.");
  }

  private async tryInitOnnx() {
    console.log(`SignEngine: Attempting to fetch ONNX model from ${MODEL_ONNX_URL}`);
    // Ensure model file is present.
    const resp = await fetch(MODEL_ONNX_URL);
    if (!resp.ok) {
      console.error(`SignEngine: ONNX model fetch failed with status ${resp.status}`);
      throw new Error(`Model missing at ${MODEL_ONNX_URL}`);
    }
    const modelBuffer = await resp.arrayBuffer();
    console.log("SignEngine: ONNX model fetched successfully.");

    console.log("SignEngine: Loading ONNX Runtime...");
    const ort = await import("onnxruntime-web");
    (ort as any).env.wasm.wasmPaths = ORT_CDN_URL;
    (ort as any).env.wasm.numThreads = 1;
    (ort as any).env.wasm.simd = false;
    (ort as any).env.wasm.proxy = false;

    console.log("SignEngine: Creating ONNX Inference Session...");
    this.ortSession = await (ort as any).InferenceSession.create(new Uint8Array(modelBuffer), {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });

    this.ort = ort;
    console.log("SignEngine: ONNX Inference Session created.");
  }

  private softmax(arr: number[]): number[] {
    const maxLogit = Math.max(...arr);
    const exps = arr.map((x) => Math.exp(x - maxLogit));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    return exps.map((x) => x / (sumExps || 1));
  }

  async predict(
    sequence: number[][],
    config: AppConfig
  ): Promise<{ result: PredictionResult | null; debug: InferenceDebugInfo } | null> {
    if (!this.isModelLoaded || !this.backend) {
      console.warn("SignEngine: Predict called but model not loaded.");
      return null;
    }

    try {
      const targetFrames = config.model_config.target_frames || 64;
      const totalFeatures = config.keypoints_config.profiles[config.model_config.profile]?.features || 225;
      const tensorSize = targetFrames * totalFeatures;
      const flattened = new Float32Array(tensorSize);

      // Pad with last frame to avoid zero shocks.
      const lastAvailableFrame =
        sequence.length > 0 ? sequence[sequence.length - 1] : new Array(totalFeatures).fill(0);

      const actualSequence =
        sequence.length > targetFrames ? sequence.slice(sequence.length - targetFrames) : sequence;

      for (let i = 0; i < targetFrames; i++) {
        const frameData = actualSequence[i] || lastAvailableFrame;
        flattened.set(frameData.slice(0, totalFeatures), i * totalFeatures);
      }

      const shape = [1, targetFrames, totalFeatures];

      let outputData: number[];

      if (this.backend === "tflite") {
        if (!this.tf || !this.tfliteModel) return null;

        // TFJS-TFLite returns a tf.Tensor (or array of tensors).
        const tf = this.tf as any;
        const input = tf.tensor(flattened, shape, "float32");
        let out = this.tfliteModel.predict(input);
        if (Array.isArray(out)) out = out[0];

        const data = await out.data();
        outputData = Array.from(data as Float32Array);

        // Avoid GPU/CPU memory leaks.
        if (typeof out.dispose === "function") out.dispose();
        input.dispose();
      } else {
        if (!this.ort || !this.ortSession) return null;

        const ort = this.ort as any;
        const tensor = new ort.Tensor("float32", flattened, shape);
        const results = await this.ortSession.run({ [this.ortSession.inputNames[0]]: tensor });
        outputData = Array.from(results[this.ortSession.outputNames[0]].data as Float32Array);
      }

      // Our exported models emit logits; keep the same softmax post-processing as before.
      const probs = this.softmax(outputData);

      const indexedProbs = probs
        .map((p, i) => ({ word: config.model_config.labels[i] || `L${i}`, confidence: p }))
        .sort((a, b) => b.confidence - a.confidence);

      const debug: InferenceDebugInfo = {
        backend: this.backend,
        min: Math.min(...flattened),
        max: Math.max(...flattened),
        mean: flattened.reduce((a, b) => a + b, 0) / flattened.length,
        top10: indexedProbs.slice(0, 10),
        inputShape: shape,
      };

      const result = indexedProbs[0];
      return {
        result:
          result.confidence >= config.inference_logic.confidence_threshold
            ? result
            : { word: "NA", confidence: result.confidence },
        debug,
      };
    } catch (err) {
      console.error("Inference Error:", err);
      return null;
    }
  }

  public getEngineStatus() {
    if (this.isInitializing) return "BOOTING...";
    if (this.initializationError) return "INIT FAILED";
    if (!this.isModelLoaded || !this.backend) return "OFFLINE";

    if (this.backend === "tflite") return "READY (TFLite 75-KP)";
    return "READY (ONNX 75-KP)";
  }
}

export const signEngine = new SignEngine();