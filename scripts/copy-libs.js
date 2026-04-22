import fs from 'fs';
import path from 'path';

const copyFiles = (srcDir, destDir, extArray) => {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    
    if (entry.isDirectory()) {
      copyFiles(srcPath, destPath, extArray);
    } else {
      if (extArray && extArray.length > 0) {
        if (extArray.some(ext => entry.name.endsWith(ext))) {
           fs.copyFileSync(srcPath, destPath);
        }
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
};

try {
  console.log("Syncing offline assets to public folder...");
  
  // MediaPipe requires the full scope of internal bindings to function purely from static tags (js binaries, txt, etc)
  copyFiles('node_modules/@mediapipe/holistic', 'public/lib/mediapipe/holistic', []);
  copyFiles('node_modules/@mediapipe/camera_utils', 'public/lib/mediapipe/camera_utils', []);
  copyFiles('node_modules/@mediapipe/drawing_utils', 'public/lib/mediapipe/drawing_utils', []);

  // Tensor tools have their JS engines dynamically integrated into the Vite map directly, so they ONLY require the standalone binary compute artifacts mapped physically outside bundle.
  copyFiles('node_modules/onnxruntime-web/dist', 'public/lib/onnx', ['.wasm']);
  copyFiles('node_modules/@tensorflow/tfjs-backend-wasm/dist', 'public/lib/tfjs', ['.wasm']);
  
  if (fs.existsSync('node_modules/@tensorflow/tfjs-tflite/wasm')) {
      copyFiles('node_modules/@tensorflow/tfjs-tflite/wasm', 'public/lib/tfjs', ['.wasm']);
  }
  
  console.log("Offline static assets synchronized!");
} catch (e) {
  console.error("Failed to copy offline assets:", e);
  process.exit(1);
}
