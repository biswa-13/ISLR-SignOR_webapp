
import React, { useState, useEffect, useRef } from 'react';
import { Zap, RefreshCw, Upload, Play, Settings, X, Loader2, Video, Terminal, Activity, FileVideo, Trash2, RotateCcw, ChevronRight, BarChart3, AlertCircle, Download, Bug, Volume2, VolumeX } from 'lucide-react';
import JSZip from 'jszip';
import HolisticCamera from './components/HolisticCamera';
import { signEngine } from './services/SignEngine';
import { videoProcessor } from './services/VideoProcessor';
import { ttsService } from './services/TTSService';
import { LandmarkStats, AppConfig, ViewportStatus, PredictionResult } from './types';

type AppMode = 'LIVE' | 'UPLOAD';

interface ProcessLog {
  id: number;
  message: string;
  type: 'info' | 'success' | 'warning' | 'frame' | 'result' | 'debug';
}

const App: React.FC = () => {
  console.log("App: Component rendering...");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [appMode, setAppMode] = useState<AppMode>('LIVE');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [stats, setStats] = useState<LandmarkStats>({
    face: 0, pose: 0, leftHand: 0, rightHand: 0, total: 0, activeFeatures: 0
  });
  const [fps, setFps] = useState<number>(0);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isMirrored, setIsMirrored] = useState(true);
  const [viewportStatus, setViewportStatus] = useState<ViewportStatus>({ state: 'NOT_DETECTED', instruction: 'Detecting...' });
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [topRankings, setTopRankings] = useState<{word: string, confidence: number}[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [engineStatus, setEngineStatus] = useState<string>('Initializing...');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [logs, setLogs] = useState<ProcessLog[]>([]);
  const [debugFrames, setDebugFrames] = useState<string[]>([]);
  const [debugMode, setDebugMode] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const ttsEnabledRef = useRef(true);
  
  const lastStatsUpdate = useRef<number>(0);

  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log("App: Fetching app_config.json...");
    fetch('/app_config.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
        return r.json();
      })
      .then(data => {
        console.log("App: Config loaded successfully:", data);
        setConfig(data);
      })
      .catch(err => {
        console.error("App: Failed to load config:", err);
        setCameraError(`Failed to load application configuration: ${err.message}`);
      });

    const interval = setInterval(() => {
      setEngineStatus(signEngine.getEngineStatus());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const addLog = (message: string, type: ProcessLog['type'] = 'info') => {
    setLogs(prev => [...prev.slice(-1000), { id: Date.now() + Math.random(), message, type }]);
  };

  const handleSequence = async (sequence: number[][], debugImages?: string[]) => {
    if (!config) return;
    console.log(`App: handleSequence called with ${sequence.length} frames. DebugImages: ${debugImages?.length || 0}`);
    setIsAnalyzing(true);
    
    if (debugImages && debugImages.length > 0) {
      setDebugFrames(debugImages);
      if (debugMode) {
        addLog(">> AUTO-DOWNLOADING DEBUG BUNDLE...", "info");
        downloadDebugFrames(debugImages);
      }
    }

    try {
        const response = await signEngine.predict(sequence, config);
        console.log("App: Prediction response:", response);
        if (response) {
            setPrediction(response.result);
            setTopRankings(response.debug.top10);
            
            if (response.result?.word !== 'NA') {
              console.log(`App: Prediction "${response.result.word}" - TTS Enabled: ${ttsEnabledRef.current}`);
              if (ttsEnabledRef.current) {
                ttsService.speak(response.result.word);
              }
            }

            if (appMode === 'LIVE') {
                setTimeout(() => setPrediction(null), 5000);
            }
        } else {
            console.warn("App: Prediction response was null.");
        }
    } catch (e) {
        console.error("App: Prediction error:", e);
        setPrediction({ word: 'ERROR', confidence: 0 });
    } finally {
        setIsAnalyzing(false);
    }
  };

  const handleResults = (res: any, filtered: number[]) => {
    const now = Date.now();
    if (now - lastStatsUpdate.current < 250) return;
    lastStatsUpdate.current = now;

    setStats({
      face: res.faceLandmarks?.length || 0,
      pose: res.poseLandmarks?.length || 0,
      leftHand: res.leftHandLandmarks?.length || 0,
      rightHand: res.rightHandLandmarks?.length || 0,
      total: (res.faceLandmarks?.length || 0) + (res.poseLandmarks?.length || 0) + (res.leftHandLandmarks?.length || 0) + (res.rightHandLandmarks?.length || 0),
      activeFeatures: filtered.length
    });
  };

  const onFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadedFile(e.target.files[0]);
      setPrediction(null);
      setTopRankings([]);
      setLogs([]);
      addLog(`[SYSTEM] Linked source: ${e.target.files[0].name}`, 'success');
    }
  };

  const handleReset = () => {
    setUploadedFile(null);
    setPrediction(null);
    setTopRankings([]);
    setLogs([]);
    setUploadProgress(0);
    setCameraError(null);
  };

  const handleAnalyzeVideo = async () => {
    if (!uploadedFile || !config) return;
    
    setIsAnalyzing(true);
    setPrediction(null);
    setTopRankings([]);
    setLogs([]);
    addLog(">> BOOTING INFERENCE ENGINE", "info");

    let extractedDebugFrames: string[] = [];

    try {
      const sequence = await videoProcessor.processVideo(
        uploadedFile, 
        { ...config, app_settings: { ...config.app_settings, debug_mode: debugMode } }, 
        (p) => setUploadProgress(p),
        (frameIdx, meta) => {
          const handsDetected = !meta.handImputed;
          const logMsg = `F${frameIdx.toString().padStart(2, '0')} | P:${meta.pose} LH:${meta.lh} RH:${meta.rh} | CX:${meta.refX.toFixed(2)} SCALE:${meta.scale.toFixed(2)}`;
          addLog(logMsg, handsDetected ? 'frame' : 'warning');
        },
        (frames) => {
          console.log(`App: Received ${frames.length} debug frames.`);
          extractedDebugFrames = frames;
          setDebugFrames(frames);
        }
      );

      addLog(">> EXTRACTION COMPLETED (64 FRAMES)", "success");
      
      if (extractedDebugFrames.length > 0 && debugMode) {
        addLog(">> AUTO-DOWNLOADING DEBUG BUNDLE...", "info");
        downloadDebugFrames(extractedDebugFrames);
      }

      const response = await signEngine.predict(sequence, config);
      
      if (response) {
        const { result, debug } = response;
        setTopRankings(debug.top10);

        // DISPLAY ML INTEGRITY DATA
        addLog(`>> ML INTEGRITY: MIN:${debug.min.toFixed(3)} MAX:${debug.max.toFixed(3)} MEAN:${debug.mean.toFixed(3)}`, "debug");
        addLog(`>> TENSOR SHAPE: [${debug.inputShape.join(', ')}]`, "debug");

        addLog(">> PROBABILITY DISTRIBUTION:", "info");
        debug.top10.forEach((p, i) => {
            const isMatch = p.word === result?.word && result?.word !== 'NA';
            const bar = "█".repeat(Math.round(p.confidence * 15)).padEnd(15, '░');
            addLog(`${(i+1)}. ${p.word.padEnd(14)} [${bar}] ${(p.confidence * 100).toFixed(1)}%`, isMatch ? 'success' : 'info');
        });

        if (result?.word !== 'NA') {
          addLog(`>> FINAL PREDICTION: ${result?.word}`, "result");
          console.log(`App: Batch Prediction "${result.word}" - TTS Enabled: ${ttsEnabledRef.current}`);
          if (ttsEnabledRef.current) {
            ttsService.speak(result.word);
          }
        } else {
          addLog(">> UNCERTAIN PREDICTION (BELOW THRESHOLD)", "warning");
        }
        setPrediction(result);
      }
    } catch (err) {
      addLog(`>> FATAL ERROR: ${err instanceof Error ? err.message : 'Unknown exception'}`, 'warning');
      setPrediction({ word: 'ERROR', confidence: 0 });
    } finally {
      setIsAnalyzing(false);
      setUploadProgress(0);
    }
  };

  const downloadDebugFrames = async (framesToDownload?: any) => {
    const frames = Array.isArray(framesToDownload) ? framesToDownload : debugFrames;
    console.log(`App: downloadDebugFrames called with ${frames.length} frames.`);
    if (frames.length === 0) {
      console.warn("App: No frames to download.");
      return;
    }
    
    const zip = new JSZip();
    const folder = zip.folder("sign_frames");
    
    frames.forEach((base64, idx) => {
      const data = base64.split(',')[1];
      folder?.file(`frame_${idx.toString().padStart(2, '0')}.jpg`, data, { base64: true });
    });
    
    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sign_frames_${Date.now()}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addLog(">> DEBUG BUNDLE DOWNLOADED", "success");
  };

  const toggleDebugMode = () => {
    const nextState = !debugMode;
    setDebugMode(nextState);
    addLog(`>> DEBUG MODE: ${nextState ? 'ENABLED' : 'DISABLED'}`, nextState ? 'success' : 'info');
  };

  if (!config) return <div className="h-screen bg-slate-950 flex items-center justify-center text-indigo-400 font-black tracking-widest uppercase text-xs italic">SignSense Booting...</div>;

  const isNA = prediction?.word === 'NA' || prediction?.word === 'ERROR';

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500/30 overflow-hidden">
      <header className="absolute top-4 inset-x-4 flex items-center justify-between z-50 pointer-events-none">
        <div className="flex items-center gap-2 bg-slate-900/90 backdrop-blur-xl border border-slate-800 p-1.5 pr-3 rounded-lg pointer-events-auto shadow-2xl">
          <div className="p-1 bg-indigo-600 rounded shadow-lg shadow-indigo-600/30"><Zap className="w-3.5 h-3.5 text-white" /></div>
          <h1 className="text-[9px] font-black uppercase tracking-[0.2em] text-white italic">{config.app_settings.app_name}</h1>
        </div>

        <div className="flex items-center gap-1.5 pointer-events-auto bg-slate-900/90 backdrop-blur-xl border border-slate-800 p-1 rounded-xl shadow-xl">
            <button 
                onClick={() => { setAppMode('LIVE'); handleReset(); }}
                className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all flex items-center gap-2 ${appMode === 'LIVE' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
                <Video className="w-3 h-3" /> Live
            </button>
            <button 
                onClick={() => { setAppMode('UPLOAD'); handleReset(); }}
                className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all flex items-center gap-2 ${appMode === 'UPLOAD' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
                <Upload className="w-3 h-3" /> Batch
            </button>
            
            <div className="w-px h-4 bg-slate-800 mx-1" />
            
            <button 
                onClick={toggleDebugMode}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all flex items-center gap-2 ${debugMode ? 'bg-amber-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                title="Toggle Debug Mode"
            >
                <Bug className="w-3 h-3" /> {debugMode ? 'Debug ON' : 'Debug'}
            </button>
        </div>
        
        <div className="flex items-center gap-1.5 pointer-events-auto">
          {appMode === 'LIVE' && (
            <button onClick={() => setFacingMode(f => f === 'user' ? 'environment' : 'user')} className="p-2 bg-slate-900/90 border border-slate-800 rounded-lg shadow-xl hover:bg-slate-800 transition-colors"><RefreshCw className="w-3.5 h-3.5 text-indigo-400" /></button>
          )}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 lg:hidden bg-slate-900/90 border border-slate-800 rounded-lg hover:bg-slate-800 transition-colors"><Settings className="w-3.5 h-3.5 text-indigo-400" /></button>
        </div>
      </header>

      <main className="flex-1 relative flex overflow-hidden">
        {/* Sidebar with Real-time Rankings */}
        <div className={`
          fixed lg:relative lg:flex z-40 lg:z-10 w-56 h-full border-r border-slate-800/50 bg-slate-950/95 lg:bg-transparent backdrop-blur-xl 
          transition-transform duration-300 ease-in-out
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          <div className="flex flex-col p-4 w-full space-y-1 pt-24 custom-scrollbar overflow-y-auto">
            <h2 className="text-[7px] font-black uppercase tracking-[0.3em] text-slate-600 mb-2 px-1 italic">Diagnostic</h2>
            
            <div className="flex items-center justify-between px-1 py-1.5 border-b border-slate-900/50">
                <span className="text-[8px] text-slate-500 uppercase font-bold">Engine</span>
                <span className={`text-[8px] font-black ${engineStatus.includes('READY') ? 'text-green-500' : 'text-indigo-500'}`}>{engineStatus}</span>
            </div>
            <div className="flex items-center justify-between px-1 py-1.5 border-b border-slate-900/50">
                <span className="text-[8px] text-slate-500 uppercase font-bold">Frequency</span>
                <span className="text-[9px] font-mono text-slate-400">{appMode === 'LIVE' ? `${fps} FPS` : 'OFFLINE'}</span>
            </div>

            <div className="flex items-center justify-between px-1 py-1.5 border-b border-slate-900/50">
                <span className="text-[8px] text-slate-500 uppercase font-bold">Debug Mode</span>
                <button 
                  onClick={toggleDebugMode}
                  className={`p-1 rounded transition-colors ${debugMode ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}
                >
                  <Bug className="w-3 h-3" />
                </button>
            </div>

            <div className="flex items-center justify-between px-1 py-1.5 border-b border-slate-900/50">
                <span className="text-[8px] text-slate-500 uppercase font-bold">Text-to-Speech</span>
                <div className="flex items-center gap-1.5">
                  <button 
                    onClick={() => ttsService.speak("Audio testing.")}
                    className="p-1 rounded bg-slate-800 text-slate-400 hover:text-indigo-400 transition-colors"
                    title="Test Audio"
                  >
                    <Play className="w-3 h-3" />
                  </button>
                  <button 
                    onClick={() => setTtsEnabled(!ttsEnabled)}
                    className={`p-1 rounded transition-colors ${ttsEnabled ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}
                    title={ttsEnabled ? "Disable TTS" : "Enable TTS"}
                  >
                    {ttsEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                  </button>
                </div>
            </div>

            {debugMode && debugFrames.length > 0 && (
              <button 
                onClick={downloadDebugFrames}
                className="mt-2 w-full flex items-center justify-center gap-2 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 text-[8px] font-black uppercase rounded-lg border border-indigo-500/30 transition-all"
              >
                <Download className="w-3 h-3" /> Download {debugFrames.length} Frames
              </button>
            )}

            {/* Top 10 Real-time Rankings Section */}
            <h2 className="text-[7px] font-black uppercase tracking-[0.3em] text-slate-600 mb-2 mt-6 px-1 italic">Real-time Rankings</h2>
            <div className="space-y-2.5 px-1 py-2">
                {topRankings.length === 0 ? (
                    <div className="py-8 flex flex-col items-center justify-center opacity-20">
                        <BarChart3 className="w-6 h-6 mb-2" />
                        <span className="text-[6px] font-bold uppercase tracking-widest">Awaiting Input</span>
                    </div>
                ) : (
                    topRankings.map((rank, i) => (
                        <div key={rank.word} className="space-y-1 group">
                            <div className="flex justify-between items-end">
                                <span className={`text-[9px] font-black uppercase transition-colors ${i === 0 && rank.confidence > config.inference_logic.confidence_threshold ? 'text-indigo-400' : 'text-slate-400'}`}>
                                    {i + 1}. {rank.word}
                                </span>
                                <span className="text-[8px] font-mono text-slate-500">{(rank.confidence * 100).toFixed(1)}%</span>
                            </div>
                            <div className="h-1 w-full bg-slate-900 rounded-full overflow-hidden">
                                <div 
                                    className={`h-full transition-all duration-700 ${i === 0 && rank.confidence > config.inference_logic.confidence_threshold ? 'bg-indigo-500 shadow-[0_0_8px_#4f46e5]' : 'bg-slate-700'}`} 
                                    style={{ width: `${rank.confidence * 100}%` }} 
                                />
                            </div>
                        </div>
                    ))
                )}
            </div>

            {debugMode && (
              <div className="mt-6 p-3 bg-amber-600/10 border border-amber-600/30 rounded-xl space-y-3">
                <div className="flex items-center gap-2">
                  <Bug className="w-3 h-3 text-amber-500" />
                  <span className="text-[8px] font-black uppercase text-amber-500 tracking-widest">Debug Panel</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[7px] text-slate-500 uppercase font-bold">Cached Frames</span>
                  <span className="text-[9px] font-mono text-amber-400">{debugFrames.length} / 64</span>
                </div>
                <button 
                  onClick={downloadDebugFrames}
                  disabled={debugFrames.length === 0}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[8px] font-black uppercase transition-all ${
                    debugFrames.length > 0 
                    ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20 active:scale-[0.98]' 
                    : 'bg-slate-900 text-slate-600 cursor-not-allowed'
                  }`}
                >
                  <Download className="w-3 h-3" />
                  Download ZIP
                </button>
              </div>
            )}

            <h2 className="text-[7px] font-black uppercase tracking-[0.3em] text-slate-600 mb-2 mt-6 px-1 italic">Sensor Health</h2>
            <div className="px-1 py-1 space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between text-[7px] text-slate-500 uppercase font-bold"><span>Pose</span><span>{stats.pose}/33</span></div>
                <div className="h-0.5 w-full bg-slate-900 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 transition-all shadow-[0_0_8px_#4f46e5]" style={{ width: `${(stats.pose / 33) * 100}%` }} /></div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[7px] text-slate-500 uppercase font-bold"><span>Hands</span><span>{stats.leftHand + stats.rightHand}/42</span></div>
                <div className="h-0.5 w-full bg-slate-900 rounded-full overflow-hidden"><div className="h-full bg-green-500 transition-all shadow-[0_0_8px_#22c55e]" style={{ width: `${((stats.leftHand + stats.rightHand) / 42) * 100}%` }} /></div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 relative bg-black overflow-hidden z-0">
          {appMode === 'LIVE' ? (
            <>
              {cameraError ? (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 p-10 text-center">
                  <div className="p-4 bg-red-500/10 rounded-full mb-6">
                    <AlertCircle className="w-12 h-12 text-red-500" />
                  </div>
                  <h3 className="text-xl font-black uppercase tracking-tighter text-white mb-2">Camera Access Blocked</h3>
                  <p className="text-slate-400 text-sm max-w-md leading-relaxed mb-8">
                    SignSense requires camera access for real-time recognition. Please click the lock icon in your address bar and set Camera to "Allow".
                  </p>
                  <button 
                    onClick={() => window.location.reload()}
                    className="px-8 py-3 bg-indigo-600 text-white font-black uppercase tracking-widest text-[10px] rounded-xl hover:bg-indigo-500 transition-all active:scale-95 shadow-2xl shadow-indigo-600/20"
                  >
                    Retry Connection
                  </button>
                </div>
              ) : (
                <HolisticCamera 
                  enabled={true}
                  config={{ ...config, app_settings: { ...config.app_settings, debug_mode: debugMode } }}
                  facingMode={facingMode}
                  isMirrored={isMirrored}
                  prediction={prediction}
                  isAnalyzing={isAnalyzing}
                  onViewportStatusChange={setViewportStatus}
                  onSequenceComplete={handleSequence}
                  onResults={handleResults}
                  onFpsUpdate={setFps}
                  onDebugFrames={setDebugFrames}
                  onError={(err) => setCameraError(err)}
                />
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col bg-slate-950 p-4 sm:p-6 pt-20 overflow-hidden">
              <div className="w-full h-full flex flex-col lg:grid lg:grid-cols-12 gap-4 max-w-[1600px] mx-auto overflow-hidden">
                
                {/* Compact Controller Panel */}
                <div className="lg:col-span-3 flex flex-col gap-3 min-h-0">
                    {!uploadedFile ? (
                        <label className="block w-full group cursor-pointer flex-1">
                            <div className="h-full border border-dashed border-slate-800 group-hover:border-indigo-500/50 rounded-xl flex flex-col items-center justify-center transition-all bg-slate-900/10 hover:bg-indigo-500/5 p-4 text-center">
                                <FileVideo className="w-8 h-8 text-indigo-500/20 group-hover:text-indigo-500/40 mb-3 transition-colors" />
                                <h2 className="text-[10px] font-black uppercase text-slate-400 tracking-widest leading-tight">Link Dataset Asset<br/><span className="text-[7px] text-slate-600 font-normal">Supports .mp4, .webm</span></h2>
                            </div>
                            <input type="file" accept="video/*" onChange={onFileUpload} className="hidden" />
                        </label>
                    ) : (
                        <div className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-xl flex flex-col h-full space-y-4 shadow-xl">
                            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                                <span className="text-[8px] font-black uppercase text-slate-500 italic">Workstation</span>
                                <button onClick={handleReset} className="text-slate-600 hover:text-red-500 transition-colors p-1"><Trash2 className="w-3.5 h-3.5"/></button>
                            </div>
                            
                            <div className="space-y-1.5 flex-1">
                                <div className="flex justify-between items-center"><span className="text-[8px] text-slate-500 uppercase font-bold">Asset</span><span className="text-[9px] font-bold text-slate-200 truncate max-w-[100px]">{uploadedFile.name}</span></div>
                                <div className="flex justify-between items-center"><span className="text-[8px] text-slate-500 uppercase font-bold">Weight</span><span className="text-[9px] font-bold text-indigo-400">{(uploadedFile.size / (1024 * 1024)).toFixed(1)} MB</span></div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 pt-2">
                                <button 
                                    onClick={handleAnalyzeVideo}
                                    disabled={isAnalyzing}
                                    className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-black uppercase py-2.5 rounded-lg text-[8px] transition-all flex items-center justify-center gap-1.5 active:scale-[0.98] shadow-lg shadow-indigo-600/10"
                                >
                                    {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-2.5 h-2.5 fill-current" />}
                                    Inference
                                </button>
                                
                                <button 
                                    onClick={handleReset}
                                    disabled={isAnalyzing}
                                    className="border border-slate-800 hover:bg-slate-800 text-slate-400 font-black uppercase py-2.5 rounded-lg text-[8px] transition-all flex items-center justify-center gap-1.5 active:scale-[0.98]"
                                >
                                    <RotateCcw className="w-2.5 h-2.5" />
                                    Purge
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* High-Visibility Debug Terminal */}
                <div className="lg:col-span-9 flex flex-col h-full bg-black/40 border border-slate-800/80 rounded-xl overflow-hidden relative shadow-2xl">
                    <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-slate-900/40 backdrop-blur-md">
                        <div className="flex items-center gap-2">
                            <Terminal className="w-3.5 h-3.5 text-indigo-500" />
                            <span className="text-[8px] font-black uppercase tracking-[0.25em] text-slate-400">Extraction Console</span>
                        </div>
                        <div className="flex items-center gap-4">
                            {isAnalyzing && <span className="text-[7px] font-black text-indigo-400 animate-pulse tracking-[0.2em]">PROCESSING...</span>}
                            <div className={`w-2 h-2 rounded-full ${isAnalyzing ? 'bg-indigo-500 animate-pulse' : 'bg-slate-800'}`} />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar p-5 font-mono text-[9px] leading-relaxed bg-black/30">
                        {logs.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center opacity-10">
                                <Activity className="w-12 h-12 mb-3 text-indigo-500" />
                                <p className="uppercase font-black text-[9px] tracking-[0.5em]">Terminal Idle</p>
                            </div>
                        ) : (
                            <div className="flex flex-col">
                                {logs.map(log => (
                                    <div key={log.id} className={`py-0.5 border-l-2 pl-4 transition-all duration-300 ${
                                        log.type === 'success' ? 'text-green-400 border-green-500/40 bg-green-500/5' : 
                                        log.type === 'result' ? 'text-white text-sm font-black border-indigo-500 bg-indigo-500/10 py-3.5 my-3 shadow-[0_0_25px_rgba(79,70,229,0.15)]' :
                                        log.type === 'debug' ? 'text-slate-500 italic opacity-80' :
                                        log.type === 'warning' ? 'text-red-400 border-red-500/40 bg-red-500/5' : 
                                        log.type === 'frame' ? 'text-slate-400 border-slate-800/50' : 
                                        'text-indigo-400 border-indigo-500/20'
                                    }`}>
                                        <span className="flex items-center gap-3">
                                            {log.type === 'result' && <ChevronRight className="w-4 h-4 text-indigo-400" />}
                                            {log.message}
                                        </span>
                                    </div>
                                ))}
                                <div ref={logEndRef} className="h-6" />
                            </div>
                        )}
                    </div>

                    {uploadProgress > 0 && (
                        <div className="absolute bottom-0 inset-x-0 h-1.5 bg-slate-900/50">
                            <div className="h-full bg-indigo-500 transition-all duration-300 shadow-[0_0_20px_#4f46e5]" style={{ width: `${uploadProgress}%` }} />
                        </div>
                    )}
                </div>
              </div>
            </div>
          )}

          {/* Unified Prediction Result Component */}
          {prediction && (
            <div className="absolute inset-x-0 bottom-6 flex justify-center pointer-events-none px-6 z-40">
                <div className={`flex items-center gap-4 px-6 py-3 rounded-full shadow-[0_15px_50px_rgba(0,0,0,0.5)] border backdrop-blur-2xl animate-in fade-in slide-in-from-bottom-6 duration-500 pointer-events-auto ${
                    isNA ? 'bg-slate-900/95 border-slate-700' : 'bg-indigo-600/95 border-white/20'
                }`}>
                    <div className="flex flex-col">
                        <span className="text-[6px] font-black uppercase tracking-[0.5em] text-white/40 leading-none mb-1.5">
                            {prediction.word === 'ERROR' ? 'FAIL' : (isNA ? "UNCERTAIN" : "RECOGNIZED")}
                        </span>
                        <h2 className="text-xl font-black tracking-tighter uppercase text-white leading-none">
                            {prediction.word}
                        </h2>
                    </div>
                    
                    {!isNA && (
                        <div className="flex items-center gap-4 border-l border-white/20 pl-5">
                            <div className="flex flex-col">
                                <span className="text-[6px] font-bold text-white/40 uppercase tracking-widest mb-1">Confidence</span>
                                <span className="text-[11px] font-black text-white/90">{Math.round(prediction.confidence * 100)}%</span>
                            </div>
                            <div className="h-1.5 w-14 bg-black/40 rounded-full overflow-hidden">
                                <div className="h-full bg-white transition-all duration-1000" style={{ width: `${prediction.confidence * 100}%` }} />
                            </div>
                        </div>
                    )}
                    
                    {debugMode && debugFrames.length > 0 && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); downloadDebugFrames(); }}
                            className="ml-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-full transition-all text-white flex items-center gap-2 shadow-lg shadow-amber-600/20 active:scale-95 pointer-events-auto"
                            title="Download 64 Frames"
                        >
                            <Download className="w-4 h-4" />
                            <span className="text-[9px] font-black uppercase">Download Frames</span>
                        </button>
                    )}

                    <button onClick={() => setPrediction(null)} className="ml-2 p-1 hover:bg-white/10 rounded-full transition-colors"><X className="w-4 h-4 text-white/40" /></button>
                </div>
            </div>
          )}
          
          {/* Action HUD */}
          {appMode === 'LIVE' && !prediction && !cameraError && (
              <div className="absolute inset-x-0 bottom-8 flex flex-col items-center gap-3 pointer-events-none z-40">
                  {debugMode && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-indigo-600/20 border border-indigo-500/30 rounded text-[7px] font-black text-indigo-400 uppercase tracking-widest animate-pulse">
                      <Bug className="w-2.5 h-2.5" /> Debug Active
                    </div>
                  )}
                  <div className={`px-5 py-2 rounded-full border backdrop-blur-xl shadow-2xl flex items-center gap-3 transition-all duration-500 ${
                      viewportStatus.state === 'READY' ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400' : (viewportStatus.state === 'RECORDING' ? 'bg-red-500/20 border-red-500/40 text-red-400' : 'bg-slate-900/80 border-slate-800 text-slate-500')
                  }`}>
                      {viewportStatus.state === 'RECORDING' && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />}
                      <span className="text-[9px] font-black uppercase tracking-[0.4em]">{viewportStatus.instruction}</span>
                  </div>
              </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
