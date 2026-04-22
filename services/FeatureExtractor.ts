
import { Point } from '../types';

/**
 * FeatureExtractor - ML Integrity Version
 * 
 * CRITICAL COORDINATE STANDARDS:
 * 1. Inputs: Raw normalized coordinates [0.0 - 1.0] from MediaPipe.
 * 2. Space: Shoulder-Relative (3D Euclidean).
 * 3. Extraction Order: 33 Pose -> 21 Left Hand -> 21 Right Hand.
 */

export interface ExtractionResult {
  data: number[];
  meta: {
    pose: number;
    lh: number;
    rh: number;
    refX: number;
    refY: number;
    scale: number;
    handImputed: boolean;
  };
}

export class FeatureExtractor {
  static extract(results: any, swapHands: boolean = false): ExtractionResult {
    const frameData: number[] = [];
    let refX = 0, refY = 0, refZ = 0, scaleFactor = 1.0;
    const epsilon = 1e-8;
    let handImputed = false;

    // 1. Reference Calculation (Indices 11 & 12 are shoulders)
    if (results.poseLandmarks && results.poseLandmarks[11] && results.poseLandmarks[12]) {
      const lS = results.poseLandmarks[11];
      const rS = results.poseLandmarks[12];
      
      refX = (lS.x + rS.x) / 2;
      refY = (lS.y + rS.y) / 2;
      refZ = ((lS.z || 0) + (rS.z || 0)) / 2;
      
      const shoulderWidth = Math.sqrt(
        Math.pow(lS.x - rS.x, 2) + 
        Math.pow(lS.y - rS.y, 2) + 
        Math.pow((lS.z || 0) - (rS.z || 0), 2)
      );
      
      scaleFactor = 1.0 / (shoulderWidth + epsilon);
    }

    // 2. Pose Extraction (33 points)
    for (let i = 0; i < 33; i++) {
      const p = (results.poseLandmarks && results.poseLandmarks[i]) 
        ? results.poseLandmarks[i] 
        : { x: 0, y: 0, z: 0 };
      
      frameData.push(
        (p.x - refX) * scaleFactor, 
        (p.y - refY) * scaleFactor, 
        ((p.z || 0) - refZ) * scaleFactor
      );
    }

    // 3. Hand Extraction (21 points per hand)
    const processHand = (landmarks: any[] | undefined) => {
      const has = !!(landmarks && landmarks.length > 0);
      if (!has) handImputed = true;
      for (let i = 0; i < 21; i++) {
        const p = (has && landmarks![i]) ? landmarks![i] : { x: 0, y: 0, z: 0 };
        frameData.push(
          (p.x - refX) * scaleFactor,
          (p.y - refY) * scaleFactor,
          ((p.z || 0) - refZ) * scaleFactor
        );
      }
    };

    const leftSource = swapHands ? results.rightHandLandmarks : results.leftHandLandmarks;
    const rightSource = swapHands ? results.leftHandLandmarks : results.rightHandLandmarks;

    processHand(leftSource);
    processHand(rightSource);

    return {
      data: frameData,
      meta: {
        pose: results.poseLandmarks?.length || 0,
        lh: leftSource?.length || 0,
        rh: rightSource?.length || 0,
        refX,
        refY,
        scale: 1.0 / scaleFactor,
        handImputed
      }
    };
  }
}
