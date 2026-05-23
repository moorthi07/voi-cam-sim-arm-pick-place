/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  Mic, MicOff, Video, VideoOff, Terminal, Sparkles, 
  HelpCircle, CheckCircle2, ChevronRight, Play, Square, 
  RefreshCw, FileSpreadsheet, Eye, EyeOff, Brain, ChevronDown, ListOrdered, Check,
  Sliders, Minus, Plus, GripHorizontal
} from 'lucide-react';
import { MujocoSim } from '../MujocoSim';
import * as THREE from 'three';
import { GoogleGenAI, Type } from "@google/genai";

interface VoiceGestureControlProps {
  sim: MujocoSim | null;
  isDarkMode: boolean;
}

interface TelemetryLogEntry {
  id: string;
  timestamp: string;
  command: string;
  source: 'Voice' | 'Gesture' | 'System' | 'Manual';
  pos: { x: number; y: number; z: number };
  joints: number[];
  status: 'COMPLETED' | 'MOVING' | 'EXECUTING' | 'STABILIZED';
  gripper: 'OPEN' | 'CLOSED';
}

export function VoiceGestureControl({ sim, isDarkMode }: VoiceGestureControlProps) {
  // UI Activation States
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isGestureActive, setIsGestureActive] = useState(false);
  const [showWebcamPreview, setShowWebcamPreview] = useState(true);
  const [voiceStatus, setVoiceStatus] = useState<string>('Mic offline');
  const [gestureStatus, setGestureStatus] = useState<string>('Camera offline');
  const [lastSpeechCommand, setLastSpeechCommand] = useState<string>('');
  const [detectedGesture, setDetectedGesture] = useState<string>('None');
  const [textCommandInput, setTextCommandInput] = useState<string>('');

  // Live browser permission states
  const [micPermissionState, setMicPermissionState] = useState<string>('checking...');
  const [camPermissionState, setCamPermissionState] = useState<string>('checking...');

  // Query permissions block
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions.query({ name: 'microphone' as any })
        .then((status) => {
          setMicPermissionState(status.state);
          status.onchange = () => setMicPermissionState(status.state);
        }).catch(() => {
          setMicPermissionState('prompt');
        });

      navigator.permissions.query({ name: 'camera' as any })
        .then((status) => {
          setCamPermissionState(status.state);
          status.onchange = () => setCamPermissionState(status.state);
        }).catch(() => {
          setCamPermissionState('prompt');
        });
    } else {
      setMicPermissionState('unsupported');
      setCamPermissionState('unsupported');
    }
  }, []);

  // Gemini AI parsing states
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    return localStorage.getItem('gemini_api_key') || (import.meta as any).env.VITE_GEMINI_API_KEY || '';
  });
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [isAiExecuting, setIsAiExecuting] = useState(false);
  const [aiSteps, setAiSteps] = useState<Array<{
    id: string;
    reasoning: string;
    direction: 'up' | 'down' | 'forward' | 'back' | 'left' | 'right' | 'open' | 'close' | 'home';
    steps: number;
    status: 'PENDING' | 'EXECUTING' | 'COMPLETED';
  }>>([]);
  const [aiError, setAiError] = useState<string | null>(null);

  // Real-time bottom status bar state
  const [statusBarMsg, setStatusBarMsg] = useState<{
    type: 'success' | 'info' | 'voice' | 'gesture' | 'ai' | 'error';
    payload: string;
    timestamp: string;
  }>({
    type: 'info',
    payload: 'System online. Ready for multimodal voice & gesture actuation.',
    timestamp: new Date().toLocaleTimeString()
  });

  // Logs state
  const [telemetryLogs, setTelemetryLogs] = useState<TelemetryLogEntry[]>([]);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  // References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const cameraHelperRef = useRef<any>(null);
  const handsHelperRef = useRef<any>(null);
  const commandTickerRef = useRef<number | null>(null);

  // Camera dragging states
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [isDraggingCam, setIsDraggingCam] = useState(false);
  const dragStartOffset = useRef({ x: 0, y: 0 });

  const handleDragCamMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Left click only
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('select')) return;
    
    setIsDraggingCam(true);
    dragStartOffset.current = {
      x: e.clientX - dragPos.x,
      y: e.clientY - dragPos.y
    };
    e.preventDefault();
  };

  const handleDragCamTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('select')) return;
    
    setIsDraggingCam(true);
    const touch = e.touches[0];
    dragStartOffset.current = {
      x: touch.clientX - dragPos.x,
      y: touch.clientY - dragPos.y
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingCam) return;
      setDragPos({
        x: e.clientX - dragStartOffset.current.x,
        y: e.clientY - dragStartOffset.current.y
      });
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDraggingCam) return;
      const touch = e.touches[0];
      setDragPos({
        x: touch.clientX - dragStartOffset.current.x,
        y: touch.clientY - dragStartOffset.current.y
      });
    };

    const handleMouseUp = () => setIsDraggingCam(false);
    const handleTouchEnd = () => setIsDraggingCam(false);

    if (isDraggingCam) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove, { passive: true });
      window.addEventListener('touchend', handleTouchEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDraggingCam]);

  // Mode settings
  const [incrementSpeed, setIncrementSpeed] = useState<number>(0.05); // move step size
  const [isPinching, setIsPinching] = useState(false);

  // Load styling classes based on theme
  const panelStyle = isDarkMode 
    ? "bg-slate-900/80 border-white/10 text-slate-100" 
    : "bg-white/70 border-white/80 text-slate-800";
  const cardStyle = isDarkMode
    ? "bg-slate-950/40 border-white/5"
    : "bg-white/40 border-slate-200/50";
  const logHeaderStyle = isDarkMode
    ? "border-white/5 bg-slate-950/60"
    : "border-slate-100 bg-slate-50/75";
  const headerText = isDarkMode ? "text-indigo-400" : "text-indigo-600";
  const subText = isDarkMode ? "text-slate-400" : "text-slate-500";
  const terminalText = isDarkMode ? "text-emerald-400 font-mono" : "text-emerald-700 font-mono";

  // Helper to append/upsert telemetry logs
  const upsertTelemetryLog = (commandName: string, source: 'Voice' | 'Gesture' | 'System' | 'Manual', status: 'COMPLETED' | 'MOVING' | 'EXECUTING' | 'STABILIZED') => {
    if (!sim || !sim.mjData || !sim.ikSys) return;

    const x = sim.ikSys.target.position.x;
    const y = sim.ikSys.target.position.y;
    const z = sim.ikSys.target.position.z;

    // Read current Franka joint qpos values
    const joints: number[] = [];
    for (let i = 0; i < 7; i++) {
      joints.push(sim.mjData.qpos[i] || 0);
    }

    // Read gripper actuator state
    let gripperState: 'OPEN' | 'CLOSED' = 'CLOSED';
    if (sim.gripperActuatorId !== -1) {
      const gripperVal = sim.mjData.ctrl[sim.gripperActuatorId];
      if (gripperVal > 100) {
        gripperState = 'OPEN';
      }
    }

    setTelemetryLogs((prev) => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString() + '.' + String(now.getMilliseconds()).padStart(3, '0');
      
      // Look for an existing "MOVING" or "EXECUTING" log for the same source & command
      const existingIdx = prev.findIndex(item => item.command === commandName && item.source === source && (item.status === 'MOVING' || item.status === 'EXECUTING'));
      
      if (existingIdx !== -1) {
        // Upsert (update) existing row with latest coordinates & status
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          pos: { x, y, z },
          joints,
          status,
          gripper: gripperState
        };
        return updated;
      } else {
        // Insert new row
        const newLogEntry: TelemetryLogEntry = {
          id: now.getTime().toString() + Math.random().toString(36).substr(2, 5),
          timestamp: timeStr,
          command: commandName,
          source,
          pos: { x, y, z },
          joints,
          status,
          gripper: gripperState
        };
        return [newLogEntry, ...prev].slice(0, 50); // Keep last 50
      }
    });
  };

  // Robot Action Handlers (Unified Cartesian steering)
  const triggerRobotMotion = (direction: string, magnitude: number, source: 'Voice' | 'Gesture') => {
    if (!sim) return;

    // Ensure IK is turned on
    sim.setIkEnabled(true);

    const targetPos = sim.ikSys.target.position;
    
    // Limits
    const minZ = 0.02;
    const maxZ = 0.85;
    const minXY = -0.8;
    const maxXY = 0.8;

    switch (direction.toLowerCase()) {
      case 'up':
        targetPos.z = THREE.MathUtils.clamp(targetPos.z + magnitude, minZ, maxZ);
        break;
      case 'down':
        targetPos.z = THREE.MathUtils.clamp(targetPos.z - magnitude, minZ, maxZ);
        break;
      case 'forward':
        targetPos.x = THREE.MathUtils.clamp(targetPos.x + magnitude, minXY, maxXY);
        break;
      case 'back':
      case 'backward':
        targetPos.x = THREE.MathUtils.clamp(targetPos.x - magnitude, minXY, maxXY);
        break;
      case 'left':
        targetPos.y = THREE.MathUtils.clamp(targetPos.y + magnitude, minXY, maxXY);
        break;
      case 'right':
        targetPos.y = THREE.MathUtils.clamp(targetPos.y - magnitude, minXY, maxXY);
        break;
      case 'open':
        if (sim.gripperActuatorId !== -1) {
          sim.mjData.ctrl[sim.gripperActuatorId] = 255; // Open
        }
        break;
      case 'close':
        if (sim.gripperActuatorId !== -1) {
          sim.mjData.ctrl[sim.gripperActuatorId] = 0; // Close
        }
        break;
      case 'home':
        sim.moveIkTargetTo(new THREE.Vector3(0, 0, 0.45), 1000);
        break;
      default:
        return; // do nothing
    }

    // Capture position update live in telemetry log
    upsertTelemetryLog(direction.toUpperCase(), source, 'MOVING');
    
    // Update bottom status bar payload
    setStatusBarMsg({
      type: source === 'Voice' ? 'voice' : 'gesture',
      payload: `[Motion Actuated] Command "${direction.toUpperCase()}" executing from ${source} telemetry control.`,
      timestamp: new Date().toLocaleTimeString()
    });
    
    // Complete movement status in a short timeout
    setTimeout(() => {
      upsertTelemetryLog(direction.toUpperCase(), source, 'COMPLETED');
    }, 400);
  };

  // Continuous execution of voice command logic if voice holds
  const startMovementTicker = (cmd: string, source: 'Voice' | 'Gesture') => {
    if (commandTickerRef.current) clearInterval(commandTickerRef.current);
    
    // Run an increment loop to make actions feel continuous and highly integrated
    commandTickerRef.current = window.setInterval(() => {
      triggerRobotMotion(cmd, 0.015, source);
    }, 100);
  };

  const stopMovementTicker = () => {
    if (commandTickerRef.current) {
      clearInterval(commandTickerRef.current);
      commandTickerRef.current = null;
    }
  };

  // Gemini complex prompt parsing and sequential robotic execution
  const handleComplexAiCommand = async (commandText: string) => {
    if (!commandText.trim()) return;
    setIsAiProcessing(true);
    setAiError(null);
    setAiSteps([]);

    const key = geminiApiKey || (import.meta as any).env.VITE_GEMINI_API_KEY || '';
    if (!key) {
      setAiError("Please configure a valid GEMINI_API_KEY in the settings board.");
      setIsAiProcessing(false);
      setStatusBarMsg({
        type: 'error',
        payload: '[Core AI Error] No Gemini API key detected. Add it in settings to compile micro-action sequences.',
        timestamp: new Date().toLocaleTimeString()
      });
      return;
    }
    
    setStatusBarMsg({
      type: 'ai',
      payload: `[Gemini CoT AI Engine] Compiling expression: "${commandText}"`,
      timestamp: new Date().toLocaleTimeString()
    });

    try {
      const aiObj = new GoogleGenAI({ apiKey: key });
      const systemGuide = `You are a spatial routing compiler for a 7-DOF Franka Panda robotic arm. 
Deconstruct the command into a clean JSON sequence.
Available actions/directions:
- "up"
- "down"
- "forward"
- "back"
- "left"
- "right"
- "open"
- "close"
- "home"

Guidelines:
1. Translate directions explicitly. E.g., "grip", "down grip" means: action "down" or "close".
2. Match "grip" or "grip tightly" as "close".
3. Return a clean sequence of steps. E.g. "move up 5 times", mapping to direction: "up", steps: 5.
4. "open30%" can map to "open" with steps: 1.
5. If multiple commands are chained, compile them in strict chronological order.

Your response MUST be a pure JSON array matching the Schema. No wrappers or markdown annotations.`;

      const response = await aiObj.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Compile this robotic steering query: "${commandText}"`,
        config: {
          systemInstruction: systemGuide,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                reasoning: { 
                  type: Type.STRING, 
                  description: "Human-readable planning reasoning for this step (e.g. 'Ascending 5 increments to clear boundary')" 
                },
                direction: { 
                  type: Type.STRING, 
                  description: "Action type: up, down, forward, back, left, right, open, close, home" 
                },
                steps: { 
                  type: Type.INTEGER, 
                  description: "Number of sequential repetitions for this motion" 
                }
              },
              required: ["reasoning", "direction", "steps"]
            }
          }
        }
      });

      const text = response.text;
      if (!text) throw new Error("Empty response from AI model.");
      
      let parsedSteps = JSON.parse(text);
      if (!Array.isArray(parsedSteps)) {
        parsedSteps = [parsedSteps];
      }

      const formatted = parsedSteps.map((s: any, idx: number) => ({
        id: `ai-step-${idx}-${Date.now()}`,
        reasoning: s.reasoning || `Instruction step ${idx + 1}`,
        direction: (s.direction?.toLowerCase() || 'up') as any,
        steps: Math.min(Math.max(s.steps || 1, 1), 20),
        status: 'PENDING' as const
      }));

      setAiSteps(formatted);
      setIsAiProcessing(false);
      
      setStatusBarMsg({
        type: 'success',
        payload: `[AI Success] Compiled into ${formatted.length} micro-action steps. Executing pipeline...`,
        timestamp: new Date().toLocaleTimeString()
      });

      // Auto-trigger sequence playback
      executeAiSteps(formatted);

    } catch (err: any) {
      console.error("AI Compile Error", err);
      setAiError(err.message || "Failed to parse instruction via Gemini.");
      setIsAiProcessing(false);
      setStatusBarMsg({
        type: 'error',
        payload: `[AI Failure] Parsing failed: ${err.message || 'Check connection'}`,
        timestamp: new Date().toLocaleTimeString()
      });
    }
  };

  const executeAiSteps = async (stepsToExecute: typeof aiSteps) => {
    if (!sim) {
      setAiError("Simulation not ready for playback.");
      setStatusBarMsg({
        type: 'error',
        payload: 'Robot Simulation not active for AI sequence.',
        timestamp: new Date().toLocaleTimeString()
      });
      return;
    }
    setIsAiExecuting(true);
    setAiError(null);

    try {
      for (let i = 0; i < stepsToExecute.length; i++) {
        // Mark executing
        setAiSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'EXECUTING' } : s));
        const active = stepsToExecute[i];

        setStatusBarMsg({
          type: 'ai',
          payload: `[AI Rule Chain ${i + 1}/${stepsToExecute.length}] Executing "${active.direction.toUpperCase()}" (${active.steps} reps). Reasoning: "${active.reasoning}"`,
          timestamp: new Date().toLocaleTimeString()
        });

        // Execute repeated times
        for (let stepIdx = 0; stepIdx < active.steps; stepIdx++) {
          triggerRobotMotion(active.direction, 0.04, 'Voice');
          // Smooth spacing between micro movements
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Mark completed
        setAiSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'COMPLETED' } : s));
        // Spacer timing between distinct commands
        await new Promise(resolve => setTimeout(resolve, 400));
      }

      setStatusBarMsg({
        type: 'success',
        payload: `[AI Action Chain Completed] Joint tracking has successfully synchronized to goal coordinates.`,
        timestamp: new Date().toLocaleTimeString()
      });
    } catch (err: any) {
      console.error("Execution failed", err);
      setAiError("Error during physical motion execution.");
      setStatusBarMsg({
        type: 'error',
        payload: `[AI Error] Playback failed: ${err.message || 'Joint actuation anomaly'}`,
        timestamp: new Date().toLocaleTimeString()
      });
    } finally {
      setIsAiExecuting(false);
    }
  };

  // Initialize Speech Recognition (Voice Commands)
  const toggleVoice = async () => {
    if (isVoiceActive) {
      // Disabling mic
      stopMovementTicker();
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsVoiceActive(false);
      setVoiceStatus('Mic offline');
      setStatusBarMsg({
        type: 'info',
        payload: 'Microphone stream and speech recognizer offline.',
        timestamp: new Date().toLocaleTimeString()
      });
    } else {
      // Enabling mic
      setVoiceStatus('Acquiring mic...');
      setStatusBarMsg({
        type: 'info',
        payload: 'Prompting for native hardware microphone session...',
        timestamp: new Date().toLocaleTimeString()
      });
      try {
        // Force pop browser's native microphone prompt
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Release stream immediately so SpeechRecognition can acquire recording access cleanly
        micStream.getTracks().forEach(track => track.stop());
      } catch (err: any) {
        console.error('Core microphone acquisition failed', err);
        setVoiceStatus('Blocked by browser');
        setStatusBarMsg({
          type: 'error',
          payload: `Microphone block: ${err.message || 'Security settings blocked access'}`,
          timestamp: new Date().toLocaleTimeString()
        });
        return;
      }

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setVoiceStatus('Browser not supported');
        setStatusBarMsg({
          type: 'error',
          payload: 'Voice engine error: SpeechRecognition API not supported on this browser context.',
          timestamp: new Date().toLocaleTimeString()
        });
        return;
      }

      try {
        const rec = new SpeechRecognition();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';

        rec.onstart = () => {
          setVoiceStatus('Listening...');
          setIsVoiceActive(true);
          setStatusBarMsg({
            type: 'success',
            payload: 'Microphone LIVE. Speak standard robotic directives clearly.',
            timestamp: new Date().toLocaleTimeString()
          });
        };

        rec.onerror = (e: any) => {
          console.error('Speech Recognition Error', e);
          setVoiceStatus(`Error: ${e.error}`);
          setStatusBarMsg({
            type: 'error',
            payload: `Speech recognition error triggered: "${e.error}"`,
            timestamp: new Date().toLocaleTimeString()
          });
        };

        rec.onend = () => {
          setIsVoiceActive(false);
          setVoiceStatus('Mic disconnected');
          setStatusBarMsg({
            type: 'info',
            payload: 'Speech recognition session disconnected.',
            timestamp: new Date().toLocaleTimeString()
          });
        };

        rec.onresult = (event: any) => {
          const results = event.results;
          const lastResult = results[results.length - 1];
          const transcript = lastResult[0].transcript.trim().toLowerCase();
          
          setLastSpeechCommand(transcript);

          // Voice speed tuning commands
          const isSpeedUp = transcript.includes('faster') || transcript.includes('speed up') || transcript.includes('increase speed') || transcript.includes('faster speed');
          const isSpeedDown = transcript.includes('slower') || transcript.includes('speed down') || transcript.includes('decrease speed') || transcript.includes('slower speed');

          if (isSpeedUp) {
            setVoiceStatus('Active: SPEED UP');
            if (lastResult.isFinal) {
              setIncrementSpeed(prev => {
                const next = Math.min(prev + 0.02, 0.20);
                setStatusBarMsg({
                  type: 'voice',
                  payload: `[Voice Speed Action] Increased velocity to ${(next * 1000).toFixed(0)} mm/step`,
                  timestamp: new Date().toLocaleTimeString()
                });
                return next;
              });
              setLastSpeechCommand('speed up (matched)');
            } else {
              setStatusBarMsg({
                type: 'voice',
                payload: `Voice Speed Command hearing: "speed up..."`,
                timestamp: new Date().toLocaleTimeString()
              });
            }
            return;
          }

          if (isSpeedDown) {
            setVoiceStatus('Active: SPEED DOWN');
            if (lastResult.isFinal) {
              setIncrementSpeed(prev => {
                const next = Math.max(prev - 0.02, 0.01);
                setStatusBarMsg({
                  type: 'voice',
                  payload: `[Voice Speed Action] Decreased velocity to ${(next * 1000).toFixed(0)} mm/step`,
                  timestamp: new Date().toLocaleTimeString()
                });
                return next;
              });
              setLastSpeechCommand('speed down (matched)');
            } else {
              setStatusBarMsg({
                type: 'voice',
                payload: `Voice Speed Command hearing: "speed down..."`,
                timestamp: new Date().toLocaleTimeString()
              });
            }
            return;
          }

          // Voice keywords maps
          const words = transcript.split(' ');
          const commandWords = ['up', 'down', 'forward', 'back', 'backward', 'left', 'right', 'open', 'close', 'home'];
          
          let matchedCommand = '';
          for (const word of words) {
            if (commandWords.includes(word)) {
              matchedCommand = word;
              break;
            }
          }

          if (matchedCommand) {
            setVoiceStatus(`Active: ${matchedCommand.toUpperCase()}`);
            if (lastResult.isFinal) {
              triggerRobotMotion(matchedCommand, incrementSpeed, 'Voice');
              stopMovementTicker();
              setStatusBarMsg({
                type: 'voice',
                payload: `Voice Prompt matched [FINAL]: "${transcript.toUpperCase()}" ➔ Executing "${matchedCommand.toUpperCase()}"`,
                timestamp: new Date().toLocaleTimeString()
              });
            } else {
              // Interim match - continuously execute
              startMovementTicker(matchedCommand, 'Voice');
              setStatusBarMsg({
                type: 'voice',
                payload: `Voice Prompt hearing [INTERIM]: "${transcript}..." ➔ Flowing "${matchedCommand.toUpperCase()}"`,
                timestamp: new Date().toLocaleTimeString()
              });
            }
          } else {
            if (lastResult.isFinal) {
              setVoiceStatus('Listening...');
              stopMovementTicker();
              setStatusBarMsg({
                type: 'voice',
                payload: `Voice input unrecognized: "${transcript}" (Say "up", "down", "close", etc.)`,
                timestamp: new Date().toLocaleTimeString()
              });
            } else {
              setStatusBarMsg({
                type: 'voice',
                payload: `Listening: "${transcript}..."`,
                timestamp: new Date().toLocaleTimeString()
              });
            }
          }
        };

        recognitionRef.current = rec;
        rec.start();
      } catch (err: any) {
        setVoiceStatus(`Error starting: ${err.message}`);
        setStatusBarMsg({
          type: 'error',
          payload: `Voice engine start failure: ${err.message}`,
          timestamp: new Date().toLocaleTimeString()
        });
      }
    }
  };

  // Initialize Gesture Recognition (Camera Controls)
  const toggleGesture = async () => {
    if (isGestureActive) {
      // Disabling gesture tracking
      stopMovementTicker();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
      }
      if (cameraHelperRef.current) {
        cameraHelperRef.current.stop();
        cameraHelperRef.current = null;
      }
      setIsGestureActive(false);
      setGestureStatus('Camera offline');
      setDetectedGesture('None');
      setStatusBarMsg({
        type: 'info',
        payload: 'Camera gestural tracking session closed.',
        timestamp: new Date().toLocaleTimeString()
      });
    } else {
      // Enabling gesture tracking
      setGestureStatus('Initializing camera...');
      setStatusBarMsg({
        type: 'info',
        payload: 'Loading MediaPipe model weights and initiating webcam stream container...',
        timestamp: new Date().toLocaleTimeString()
      });

      if (!(window as any).Hands) {
        setGestureStatus('MediaPipe Hands loads...');
        setStatusBarMsg({
          type: 'error',
          payload: 'MediaPipe Hands libraries not ready. Ensure connection and click Hand Gestures again.',
          timestamp: new Date().toLocaleTimeString()
        });
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
        mediaStreamRef.current = stream;
        
        // Robust direct DOM querying fallback to guarantee reference lookup
        const videoElement = videoRef.current || document.getElementById('webcam-video-element') as HTMLVideoElement;
        if (videoElement) {
          videoElement.srcObject = stream;
        }

        const hands = new (window as any).Hands({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6
        });

        hands.onResults((results: any) => {
          onHandResults(results);
        });

        handsHelperRef.current = hands;

        const actualVideoNode = videoRef.current || document.getElementById('webcam-video-element');
        const camera = new (window as any).Camera(actualVideoNode, {
          onFrame: async () => {
            const currentVideo = videoRef.current || document.getElementById('webcam-video-element') as HTMLVideoElement;
            if (currentVideo) {
              await hands.send({ image: currentVideo });
            }
          },
          width: 320,
          height: 240
        });

        cameraHelperRef.current = camera;
        camera.start();

        setIsGestureActive(true);
        setGestureStatus('Tracking hands...');
        setStatusBarMsg({
          type: 'success',
          payload: 'Webcam feed established. MediaPipe hand skeleton pipeline operational.',
          timestamp: new Date().toLocaleTimeString()
        });
      } catch (err: any) {
        console.error(err);
        setGestureStatus(`Denied: ${err.message || 'Camera blocked'}`);
        setStatusBarMsg({
          type: 'error',
          payload: `Camera initialization blocked: ${err.message || 'Check browser permissions next to URL address bar'}`,
          timestamp: new Date().toLocaleTimeString()
        });
      }
    }
  };

  // Process MediaPipe Hands Landmarks
  const onHandResults = (results: any) => {
    if (!canvasRef.current || !videoRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Clear and draw canvas
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    
    // Flip canvas horizontally to feel like mirror
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvasRef.current.width, 0);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];
      setGestureStatus('Hand tracked');

      // Draw skeleton points for immediate interactive visual feedback
      landmarks.forEach((pt: any) => {
        const cx = pt.x * canvasRef.current!.width;
        const cy = pt.y * canvasRef.current!.height;
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#6366f1';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // Simple, robust heuristic for hand gesture recognition:
      // Landmarks:
      // index tip = 8, index pip = 6, index mcp = 5
      // middle tip = 12, middle pip = 10, middle mcp = 9
      // ring tip = 16, pinky tip = 20
      // thumb tip = 4, thumb ip = 3, thumb mcp = 2
      
      const indexTip = landmarks[8];
      const indexPip = landmarks[6];
      const indexMcp = landmarks[5];

      const middleTip = landmarks[12];
      const middlePip = landmarks[10];

      const ringTip = landmarks[16];
      const ringPip = landmarks[14];

      const pinkyTip = landmarks[20];
      const pinkyPip = landmarks[18];

      const thumbTip = landmarks[4];

      // Is finger extended? y is smaller at the top, so tip.y < pip.y means pointing up
      const isIndexExtended = indexTip.y < indexPip.y && indexPip.y < indexMcp.y;
      const isMiddleExtended = middleTip.y < middlePip.y;
      const isRingExtended = ringTip.y < ringPip.y;
      const isPinkyExtended = pinkyTip.y < pinkyPip.y;

      // 1. Pinch Detection (Finger Close)
      // distance between index tip and thumb tip
      const distIndexThumb = Math.sqrt(
        Math.pow(indexTip.x - thumbTip.x, 2) + Math.pow(indexTip.y - thumbTip.y, 2)
      );

      // Pinching is true if index and thumb tips are very close
      if (distIndexThumb < 0.05) {
        setDetectedGesture('Finger Close / Pinch');
        triggerRobotMotion('close', 0, 'Gesture');
        setStatusBarMsg({
          type: 'gesture',
          payload: 'Gesture Active: Pinching Index/Thumb (Close gripper triggered)',
          timestamp: new Date().toLocaleTimeString()
        });
      } else if (isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended) {
        // Only index finger extended => Finger Up!
        setDetectedGesture('Finger Up');
        triggerRobotMotion('up', 0.015, 'Gesture');
        setStatusBarMsg({
          type: 'gesture',
          payload: 'Gesture Active: Index Finger Extended (Move Up triggered)',
          timestamp: new Date().toLocaleTimeString()
        });
      } else if (!isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended) {
        // Fist closed => Close gripper
        setDetectedGesture('Fist Closed');
        triggerRobotMotion('close', 0, 'Gesture');
        setStatusBarMsg({
          type: 'gesture',
          payload: 'Gesture Active: Fist Closed (Close gripper triggered)',
          timestamp: new Date().toLocaleTimeString()
        });
      } else if (isIndexExtended && isMiddleExtended && isRingExtended && isPinkyExtended) {
        // All fingers extended => Open gripper
        setDetectedGesture('Fingers Open');
        triggerRobotMotion('open', 0, 'Gesture');
        setStatusBarMsg({
          type: 'gesture',
          payload: 'Gesture Active: Hand Fully Open (Open gripper triggered)',
          timestamp: new Date().toLocaleTimeString()
        });
      } else if (indexTip.y > indexMcp.y && thumbTip.y < indexTip.y) {
        // Hand facing down, index bent downwards
        setDetectedGesture('Finger Down');
        triggerRobotMotion('down', 0.015, 'Gesture');
        setStatusBarMsg({
          type: 'gesture',
          payload: 'Gesture Active: Index Curved Downward (Move Down triggered)',
          timestamp: new Date().toLocaleTimeString()
        });
      } else {
        setDetectedGesture('Open / Resting');
      }
    } else {
      setDetectedGesture('None');
    }
    
    ctx.restore();
  };

  // Cleanup tickers on unmount
  useEffect(() => {
    return () => {
      stopMovementTicker();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (cameraHelperRef.current) {
        cameraHelperRef.current.stop();
      }
    };
  }, []);

  // Sync log on startup if none exists
  useEffect(() => {
    if (sim && telemetryLogs.length === 0) {
      upsertTelemetryLog('SIMULATION START', 'System', 'STABILIZED');
    }
  }, [sim]);

  return (
    <div className={`absolute left-4 top-1/2 -translate-y-1/2 min-[660px]:left-10 w-[360px] glass-panel rounded-[2.5rem] flex flex-col z-40 max-h-[75vh] overflow-hidden shadow-2xl transition-all border border-white/20 p-6 ${panelStyle}`}>
      
      {/* Title Header */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-indigo-500/10">
        <div>
          <h2 className="text-base font-bold flex items-center gap-1.5 leading-none">
            <Sparkles className="w-5 h-5 text-indigo-500 animate-pulse" />
            <span>Voice & Gesture Command</span>
          </h2>
          <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest font-bold">Actuator Co-ordination</p>
        </div>
        <div className="relative shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-indigo-500/10">
          <span className="flex h-2 w-2 relative">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isVoiceActive || isGestureActive ? 'bg-indigo-400' : 'bg-slate-400'}`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isVoiceActive || isGestureActive ? 'bg-indigo-500' : 'bg-slate-500'}`}></span>
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1 scroll-smooth custom-scrollbar">
        {/* Hardware & Browser Permissions Diagnostics */}
        <div className="p-3.5 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 space-y-2.5">
          <div className="flex justify-between items-center text-[9px] font-bold tracking-wider text-slate-400 uppercase">
            <span>Hardware & Permissions Diagnosis</span>
            <span className="animate-pulse h-1.5 w-1.5 rounded-full bg-indigo-500"></span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className={`p-2 rounded-xl border flex flex-col justify-between ${isDarkMode ? 'bg-slate-950/50 border-white/5' : 'bg-white/80 border-slate-100'}`}>
              <div className="flex items-center gap-1.5 text-slate-400 font-bold uppercase text-[8px]">
                <Mic className="w-3 h-3 text-indigo-400 animate-pulse" />
                <span>Microphone</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="font-mono text-[9px] capitalize">{micPermissionState}</span>
                {micPermissionState === 'granted' ? (
                  <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                ) : micPermissionState === 'denied' ? (
                  <span className="h-2 w-2 rounded-full bg-red-500"></span>
                ) : (
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping"></span>
                )}
              </div>
            </div>

            <div className={`p-2 rounded-xl border flex flex-col justify-between ${isDarkMode ? 'bg-slate-950/50 border-white/5' : 'bg-white/80 border-slate-100'}`}>
              <div className="flex items-center gap-1.5 text-slate-400 font-bold uppercase text-[8px]">
                <Video className="w-3 h-3 text-indigo-400 animate-pulse" />
                <span>Camera</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="font-mono text-[9px] capitalize">{camPermissionState}</span>
                {camPermissionState === 'granted' ? (
                  <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                ) : camPermissionState === 'denied' ? (
                  <span className="h-2 w-2 rounded-full bg-red-500"></span>
                ) : (
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping"></span>
                )}
              </div>
            </div>
          </div>

          {/* Blocked state visual tips */}
          {(micPermissionState === 'denied' || camPermissionState === 'denied') && (
            <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-[9px] text-red-400 leading-relaxed space-y-1">
              <p className="font-bold">⚠️ Access Blocked by Browser:</p>
              <ol className="list-decimal list-inside pl-1 text-[8.5px] font-sans">
                <li>Look at your browser's URL address bar next to the domain name.</li>
                <li>Click the <strong>Lock (🔒) or Camera/Mic icon</strong> in the address bar.</li>
                <li>Change Microphone/Camera permission to <strong>"Allow"</strong>.</li>
                <li>Click the <strong>Refresh App</strong> button below to apply!</li>
              </ol>
            </div>
          )}

          {/* Sandbox alert */}
          <div className="text-[9px] text-slate-400 leading-relaxed font-sans pb-1 px-0.5">
            <strong>Iframe Restriction:</strong> Sandboxed iframes block voice/camera. Click <strong>'Open in new tab' ↗</strong> in the top-right of your screen to bypass, then click allow!
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => window.location.reload()}
              className="px-2.5 py-1.5 rounded-xl border border-indigo-500/20 text-indigo-400 text-[10px] font-bold font-sans flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer hover:bg-indigo-500/10"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh App</span>
            </button>
            <button
              onClick={async () => {
                try {
                  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                  stream.getTracks().forEach(t => t.stop());
                  window.location.reload();
                } catch (e: any) {
                  alert("Trigger failed or aborted: " + e.message);
                }
              }}
              className="px-2.5 py-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-[10px] font-bold font-sans flex items-center justify-center gap-1 active:scale-95 transition-all cursor-pointer"
            >
              <Sparkles className="w-3 h-3" />
              <span>Force Prompt</span>
            </button>
          </div>
        </div>

        {/* Toggle Controllers Section */}
        <div className="grid grid-cols-2 gap-3">
          {/* Voice Activator */}
          <button 
            id="voice-mic-toggle-btn"
            onClick={toggleVoice}
            className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all active:scale-95 text-center cursor-pointer ${
              isVoiceActive 
                ? 'bg-indigo-500 border-indigo-400 text-white shadow-lg' 
                : (isDarkMode ? 'bg-slate-950 border-white/5 hover:border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-700')
            }`}
          >
            {isVoiceActive ? <Mic className="w-5 h-5 animate-bounce" /> : <MicOff className="w-5 h-5 opacity-60 text-indigo-500" />}
            <span className="text-[11px] font-bold">Voice Commands</span>
            <span className={`text-[8px] truncate max-w-full font-mono ${isVoiceActive ? 'text-indigo-100' : 'text-slate-400'}`}>
              {voiceStatus}
            </span>
          </button>

          {/* Gesture Activator */}
          <button 
            id="camera-gesture-toggle-btn"
            onClick={toggleGesture}
            className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all active:scale-95 text-center cursor-pointer ${
              isGestureActive 
                ? 'bg-indigo-500 border-indigo-400 text-white shadow-lg' 
                : (isDarkMode ? 'bg-slate-950 border-white/5 hover:border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-700')
            }`}
          >
            {isGestureActive ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5 opacity-60 text-indigo-500" />}
            <span className="text-[11px] font-bold">Hand Gestures</span>
            <span className={`text-[8px] truncate max-w-full font-mono ${isGestureActive ? 'text-indigo-100' : 'text-slate-400'}`}>
              {gestureStatus}
            </span>
          </button>
        </div>

        {/* Robot Speed Control Option */}
        <div className={`p-3 rounded-2xl border ${cardStyle} space-y-2`}>
          <div className="flex justify-between items-center text-[9px] font-bold tracking-wider text-slate-400 uppercase">
            <span className="flex items-center gap-1.5 font-sans">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              <span>Robot Movement Speed</span>
            </span>
            <span className="font-mono text-indigo-400 bg-indigo-500/10 px-1 rounded animate-pulse">
              {(incrementSpeed * 1000).toFixed(0)} mm/step
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setIncrementSpeed(prev => {
                  const next = Math.max(prev - 0.01, 0.01);
                  setStatusBarMsg({
                    type: 'info',
                    payload: `[Speed Tune] Reduced step size to ${(next * 1000).toFixed(0)} mm/step`,
                    timestamp: new Date().toLocaleTimeString()
                  });
                  return next;
                });
              }}
              className={`p-1.5 rounded-lg border flex items-center justify-center transition-all hover:bg-slate-500/10 active:scale-95 cursor-pointer ${
                isDarkMode ? 'bg-slate-950 border-white/5 hover:border-indigo-500/10 text-slate-300' : 'bg-slate-50 border-slate-200 hover:border-indigo-400 text-slate-700'
              }`}
              title="Decrease Movement Speed"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>

            <div className="flex-1 flex items-center gap-2">
              <input
                type="range"
                min="0.01"
                max="0.20"
                step="0.01"
                value={incrementSpeed}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setIncrementSpeed(val);
                  setStatusBarMsg({
                    type: 'info',
                    payload: `[Speed Tune] Adjusted step size to ${(val * 1000).toFixed(0)} mm/step`,
                    timestamp: new Date().toLocaleTimeString()
                  });
                }}
                className="w-full accent-indigo-500 h-1 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setIncrementSpeed(prev => {
                  const next = Math.min(prev + 0.01, 0.20);
                  setStatusBarMsg({
                    type: 'info',
                    payload: `[Speed Tune] Increased step size to ${(next * 1000).toFixed(0)} mm/step`,
                    timestamp: new Date().toLocaleTimeString()
                  });
                  return next;
                });
              }}
              className={`p-1.5 rounded-lg border flex items-center justify-center transition-all hover:bg-slate-500/10 active:scale-95 cursor-pointer ${
                isDarkMode ? 'bg-slate-950 border-white/5 hover:border-indigo-500/10 text-slate-300' : 'bg-slate-50 border-slate-200 hover:border-indigo-400 text-slate-700'
              }`}
              title="Increase Movement Speed"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex justify-between items-center text-[8px] text-slate-400 font-mono">
            <span>Min: 10mm</span>
            <div className="flex gap-1.5">
              {[0.02, 0.05, 0.10, 0.15].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => {
                    setIncrementSpeed(val);
                    setStatusBarMsg({
                      type: 'info',
                      payload: `[Speed Preset] Configured step velocity limit to ${(val * 1000).toFixed(0)} mm/step`,
                      timestamp: new Date().toLocaleTimeString()
                    });
                  }}
                  className={`px-1.5 py-0.5 rounded border transition-colors hover:border-indigo-500/30 font-mono ${
                    Math.abs(incrementSpeed - val) < 0.005
                      ? 'bg-indigo-500/15 border-indigo-500/35 text-indigo-400 font-bold font-mono'
                      : (isDarkMode ? 'border-white/5 bg-slate-950/40 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-600')
                  }`}
                >
                  {(val * 1000).toFixed(0)}mm
                </button>
              ))}
            </div>
            <span>Max: 200mm</span>
          </div>
          
          <div className="text-[8px] text-slate-400/80 leading-normal bg-indigo-500/5 p-1 rounded border border-indigo-500/10 flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
            <span>Voice Command Tuning is online! Speak <strong className="text-indigo-400">"faster" / "speed up"</strong> or <strong className="text-indigo-400">"slower" / "speed down"</strong>.</span>
          </div>
        </div>

        {/* Gemini API Key Configuration Support */}
        <div className={`p-3 rounded-2xl border ${cardStyle} space-y-2`}>
          <div className="flex justify-between items-center text-[9px] font-bold tracking-wider text-slate-400 uppercase">
            <span className="flex items-center gap-1.5 font-sans">
              <Brain className="w-3.5 h-3.5 text-indigo-400" />
              <span>Gemini Settings</span>
            </span>
            <span className="font-mono text-indigo-400 bg-indigo-505/10 px-1 rounded">SECURE</span>
          </div>
          <div className="flex gap-1.5 items-center">
            <input 
              type="password"
              value={geminiApiKey}
              onChange={(e) => {
                const val = e.target.value;
                setGeminiApiKey(val);
                localStorage.setItem('gemini_api_key', val);
              }}
              placeholder="GEMINI_API_KEY (Stored in LocalStorage)"
              className={`flex-1 px-3 py-1.5 text-[10px] font-mono rounded-xl border focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                isDarkMode 
                  ? 'bg-slate-950 border-white/5 text-slate-200 placeholder-slate-600' 
                  : 'bg-white border-slate-200 text-slate-800 placeholder-slate-400'
              }`}
            />
            <button 
              type="button"
              onClick={() => {
                setGeminiApiKey('');
                localStorage.removeItem('gemini_api_key');
              }}
              className={`px-3 py-1.5 text-[9px] rounded-xl border font-bold transition-all hover:bg-red-500 hover:text-white capitalize cursor-pointer ${
                isDarkMode ? 'bg-slate-900 border-white/5 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-600'
              }`}
            >
              Clear
            </button>
          </div>
        </div>

        {/* Chain-of-Thought AI Compiler Board */}
        <div className={`p-4 rounded-[2rem] border ${cardStyle} space-y-3`}>
          <div className="flex justify-between items-center pb-2 border-b border-indigo-500/10">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-indigo-500 animate-pulse" />
              <div>
                <span className="text-[11px] font-bold block leading-none">AI Chain-of-Thought Compiler</span>
                <span className="text-[8px] text-slate-400 font-medium">Auto-Execute Complex CoT Pipelines</span>
              </div>
            </div>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-mono bg-indigo-500/10 text-indigo-400 font-bold">READY</span>
          </div>

          <form 
            onSubmit={(e) => {
              e.preventDefault();
              if (isAiProcessing || isAiExecuting) return;
              handleComplexAiCommand(textCommandInput);
            }}
            className="flex gap-1.5"
          >
            <input 
              type="text"
              value={textCommandInput}
              onChange={(e) => setTextCommandInput(e.target.value)}
              disabled={isAiProcessing || isAiExecuting}
              placeholder="e.g. move up 5 times and forward 2 steps open30% down grip, up"
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-serif border focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                isDarkMode 
                  ? 'bg-slate-950 border-white/5 text-slate-200 placeholder-slate-500' 
                  : 'bg-white border-slate-200 text-slate-800 placeholder-slate-400'
              } ${isAiProcessing || isAiExecuting ? 'opacity-50 cursor-not-allowed' : ''}`}
            />
            <button 
              type="submit"
              disabled={isAiProcessing || isAiExecuting || !textCommandInput.trim()}
              className={`px-3 py-2 rounded-xl bg-indigo-500 text-white text-xs font-bold font-sans transition-colors cursor-pointer hover:bg-indigo-600 ${
                isAiProcessing || isAiExecuting || !textCommandInput.trim() ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              Compile
            </button>
          </form>

          {/* Quick preset trigger buttons for complex prompts */}
          <div className="space-y-1.5">
            <span className="text-[8px] text-slate-400 uppercase font-bold tracking-wider">Example Complex Chains:</span>
            <div className="flex flex-col gap-1">
              {[
                "move up 5 times and forward 2 steps open30% down grip, up",
                "forward 3 times, close, up 4 times, back 2, open",
                "home, down 3 times, close, up 5 times"
              ].map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={isAiProcessing || isAiExecuting}
                  onClick={() => {
                    setTextCommandInput(preset);
                    handleComplexAiCommand(preset);
                  }}
                  className={`text-[9.5px] px-2.5 py-1.5 rounded-xl border text-left flex items-center gap-1.5 transition-all active:scale-[0.98] ${
                    isDarkMode
                      ? 'bg-slate-950/60 border-white/5 hover:border-indigo-500/20 text-slate-300'
                      : 'bg-slate-50/50 border-slate-200 hover:border-indigo-400 text-slate-700'
                  } ${isAiProcessing || isAiExecuting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <Sparkles className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
                  <span className="font-mono truncate">{preset}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Manual Incremental Control Pills */}
          <div className="pt-2 border-t border-indigo-500/5 space-y-1.5">
            <span className="text-[8px] text-slate-400 uppercase font-bold tracking-wider">Manual Single Commands:</span>
            <div className="flex flex-wrap gap-1">
              {['up', 'down', 'forward', 'back', 'open', 'close', 'home'].map((cmd) => (
                <button
                  key={cmd}
                  type="button"
                  disabled={isAiProcessing || isAiExecuting}
                  onClick={() => {
                    setLastSpeechCommand(cmd);
                    triggerRobotMotion(cmd, incrementSpeed, 'Manual');
                  }}
                  className={`px-2 py-1 rounded-lg text-[9px] font-mono border transition-all active:scale-95 cursor-pointer uppercase ${
                    isDarkMode
                      ? 'bg-slate-900 border-white/5 hover:border-indigo-500/20 text-slate-300'
                      : 'bg-slate-50 border-slate-200 hover:border-indigo-400 text-slate-600'
                  } ${isAiProcessing || isAiExecuting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {cmd}
                </button>
              ))}
            </div>
          </div>

          {/* Error display */}
          {aiError && (
            <div className="p-2.5 rounded-xl border border-red-500/20 bg-red-500/5 text-[10px] text-red-400 font-sans leading-relaxed">
              <strong>Error:</strong> {aiError}
            </div>
          )}

          {/* Processing / Compiler Log Feedback */}
          {isAiProcessing && (
            <div className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/25 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 text-indigo-400 animate-spin" />
              <p className="text-[10px] font-mono text-indigo-300 animate-pulse">Gemini compiling motion paths...</p>
            </div>
          )}

          {/* Compiled Sequential steps with status tracking */}
          {aiSteps.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-indigo-500/10">
              <div className="flex justify-between items-center text-[9px] font-bold tracking-wider text-slate-400 uppercase">
                <span className="flex items-center gap-1"><ListOrdered className="w-3.5 h-3.5 text-indigo-400" /> Compiled Actions</span>
                <span className={isAiExecuting ? 'text-amber-400 animate-pulse font-bold' : 'text-emerald-400 font-bold'}>
                  {isAiExecuting ? 'EXECUTING...' : 'COMPLETED'}
                </span>
              </div>
              
              <div className="space-y-1.5 max-h-[180px] overflow-y-auto custom-scrollbar pr-1">
                {aiSteps.map((step, idx) => (
                  <div 
                    key={step.id} 
                    className={`p-2 rounded-xl border border-dashed transition-all duration-300 ${
                      step.status === 'EXECUTING'
                        ? 'bg-amber-500/10 border-amber-500/40 text-amber-500 shadow'
                        : step.status === 'COMPLETED'
                        ? 'bg-emerald-500/5 border-emerald-500/15 opacity-60 text-slate-400'
                        : 'bg-slate-950/20 border-white/5 text-slate-300'
                    }`}
                  >
                    <div className="flex justify-between items-center text-[10px] gap-1">
                      <span className="font-bold flex items-center gap-1">
                        <span className="w-4 h-4 rounded-full bg-slate-800 text-[8px] flex items-center justify-center text-slate-200 shrink-0">{idx+1}</span>
                        <span className={step.status === 'EXECUTING' ? 'text-amber-400 font-bold' : ''}>
                          {step.direction.toUpperCase()} ({step.steps} reps)
                        </span>
                      </span>
                      {step.status === 'EXECUTING' && (
                        <span className="text-[8px] font-mono bg-amber-500/20 text-amber-400 px-1 py-0.5 rounded animate-pulse font-bold">ACTIVE</span>
                      )}
                      {step.status === 'COMPLETED' && (
                        <span className="text-[8px] font-mono bg-emerald-500/20 text-emerald-400 px-1 py-0.5 rounded font-bold flex items-center gap-0.5"><Check className="w-2.5 h-2.5" /> DONE</span>
                      )}
                      {step.status === 'PENDING' && (
                        <span className="text-[8px] font-mono text-slate-500">WAITING</span>
                      )}
                    </div>
                    <p className="text-[9px] text-slate-400 mt-1 pl-5.5 font-sans leading-relaxed">
                      Reasoning: {step.reasoning}
                    </p>
                  </div>
                ))}
              </div>

              {!isAiExecuting && (
                <button
                  type="button"
                  onClick={() => executeAiSteps(aiSteps)}
                  className="w-full py-1.5 mt-1 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-[10px] font-bold transition-colors flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" /> Rerun Compiled Sequence
                </button>
              )}
            </div>
          )}
        </div>

        {/* Live Command Logs Overlays */}
        {(lastSpeechCommand || detectedGesture !== 'None') && (
          <div className={`p-3 rounded-xl border flex flex-col gap-1.5 text-xs font-mono shadow-inner ${cardStyle}`}>
            <span className="text-[8px] font-bold tracking-wider text-slate-400 uppercase">Input Feed State</span>
            {lastSpeechCommand && (
              <p className="flex justify-between items-center">
                <span className="text-slate-400">Voice Word Match:</span>
                <span className="text-indigo-400 font-semibold truncate max-w-[170px]">{lastSpeechCommand}</span>
              </p>
            )}
            {isGestureActive && (
              <p className="flex justify-between items-center">
                <span className="text-slate-400">Gesture Matched:</span>
                <span className="text-indigo-400 font-semibold">{detectedGesture}</span>
              </p>
            )}
          </div>
        )}

        {/* Camera Webcam Preview Mirror */}
        <div 
          className={isGestureActive 
            ? "fixed bottom-24 right-5 z-[55] w-48 md:w-56 aspect-[4/3] rounded-2xl overflow-hidden bg-slate-950 border border-indigo-500/50 shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-5 select-none cursor-grab active:cursor-grabbing hover:border-indigo-400"
            : "relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-slate-950 border border-white/10 shrink-0 group shadow-inner"
          }
          onMouseDown={isGestureActive ? handleDragCamMouseDown : undefined}
          onTouchStart={isGestureActive ? handleDragCamTouchStart : undefined}
          style={isGestureActive ? { transform: `translate(${dragPos.x}px, ${dragPos.y}px)`, touchAction: 'none' } : undefined}
        >
          <video 
            id="webcam-video-element"
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            className={`w-full h-full object-cover -scale-x-100 absolute inset-0 ${isGestureActive && showWebcamPreview ? 'block' : 'hidden'}`}
          />
          <canvas 
            id="webcam-canvas-element"
            ref={canvasRef} 
            width={320} 
            height={240} 
            className={`w-full h-full object-cover absolute inset-0 pointer-events-none ${isGestureActive && showWebcamPreview ? 'block' : 'hidden'}`}
          />
          
          {isGestureActive ? (
            <>
              {/* Drag handles & status controls overlay */}
              <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/75 backdrop-blur-md px-1.5 py-0.5 rounded-lg text-[8px] font-mono font-bold text-indigo-400 border border-indigo-500/20 select-none z-10">
                <GripHorizontal className="w-3 h-3 text-indigo-400 animate-pulse shrink-0" />
                <span>DRAG WEBCAM</span>
              </div>

              <button 
                type="button"
                onClick={() => setShowWebcamPreview(!showWebcamPreview)}
                className="absolute top-2 right-2 bg-black/75 hover:bg-black/90 p-1.5 rounded-lg transition-colors text-white cursor-pointer z-20 border border-white/5 shadow"
                title={showWebcamPreview ? "Hide Webcam Feed" : "Show Webcam Feed"}
              >
                {showWebcamPreview ? <EyeOff className="w-3 h-3 text-slate-300" /> : <Eye className="w-3 h-3 text-slate-300" />}
              </button>

              {!showWebcamPreview && (
                <div className="absolute inset-x-0 inset-y-0 flex flex-col items-center justify-center bg-slate-950 text-slate-400 text-xs text-center z-0">
                  <Video className="w-8 h-8 text-indigo-500 mb-2 animate-pulse" />
                  <span>Webcam streaming in background</span>
                </div>
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 p-4 text-center">
              <VideoOff className="w-8 h-8 text-indigo-500/50 mb-2 animate-pulse" />
              <span className="text-[11px] font-bold text-slate-300 uppercase tracking-widest">Hand Gestures Offline</span>
              <p className="text-[9px] text-slate-500 max-w-[220px] mt-1 leading-relaxed">
                Click "Hand Gestures" toggle above to initialize MediaPipe skeletal capture feed coordinates.
              </p>
            </div>
          )}
        </div>

        {/* Active Coordinates Log Panel (The requested running upsert log) */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-slate-400" />
              <span>Upsert Telemetry Log</span>
            </h3>
            <button 
              onClick={() => setTelemetryLogs([])}
              className="text-[9px] hover:text-indigo-400 transition-colors uppercase font-bold"
            >
              Clear Logs
            </button>
          </div>

          <div className={`p-1 rounded-2xl border flex flex-col gap-2 max-h-[160px] overflow-y-auto scroll-smooth custom-scrollbar ${cardStyle}`}>
            {telemetryLogs.length === 0 ? (
              <div className="text-center py-6 text-[10px] text-slate-500 italic">
                Logs will populate as joints coordinate...
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {telemetryLogs.map((log) => {
                  const isSelected = selectedLogId === log.id || log.status === 'MOVING' || log.status === 'EXECUTING';
                  
                  return (
                    <div 
                      key={log.id}
                      onClick={() => setSelectedLogId(isSelected ? null : log.id)}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer text-[10px] font-mono ${
                        log.status === 'MOVING' || log.status === 'EXECUTING'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                          : isSelected
                            ? 'bg-indigo-500/10 border-indigo-500/40'
                            : 'bg-slate-950/20 border-white/5 hover:bg-slate-950/40'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-sans font-bold text-[9px] bg-slate-800/40 px-1 rounded uppercase tracking-wider text-slate-300">
                          {log.source}: {log.command}
                        </span>
                        <span className={`text-[8px] font-bold ${
                          log.status === 'MOVING' || log.status === 'EXECUTING' ? 'text-amber-400 animate-pulse' : 'text-emerald-400'
                        }`}>
                          {log.status}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-1.5 text-slate-400 text-[9px] font-mono mt-1 pt-1 border-t border-indigo-500/5">
                        <p><span className="text-slate-500">X:</span> {log.pos.x.toFixed(3)}</p>
                        <p><span className="text-slate-500">Y:</span> {log.pos.y.toFixed(3)}</p>
                        <p><span className="text-slate-500">Z:</span> {log.pos.z.toFixed(3)}</p>
                      </div>

                      {/* Expanded View for Joint Space coordination */}
                      {isSelected && (
                        <div className="mt-2 pt-2 border-t border-indigo-500/10 space-y-1 text-slate-300 animate-in slide-in-from-top-1.5 duration-150">
                          <p className="text-[8px] text-slate-500 font-bold font-sans uppercase uppercase tracking-widest pl-0.5">Actuator Joint Co-ordination (rad)</p>
                          <div className="grid grid-cols-4 gap-1 font-mono text-[8px] leading-tight text-indigo-300 bg-black/40 p-1.5 rounded-lg">
                            {log.joints.map((val, idx) => (
                              <p key={idx} className="truncate select-all" title={`Joint ${idx+1}`}>
                                <span className="text-slate-500 shrink-0 pr-0.5">q{idx+1}:</span>
                                {val.toFixed(3)}
                              </p>
                            ))}
                          </div>
                          <div className="flex justify-between font-sans text-[8px] text-slate-400 font-semibold pt-1">
                            <span>Gripper Val: {log.gripper}</span>
                            <span>Time: {log.timestamp}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Tip / Tutorial section */}
        <div className={`p-4 rounded-3xl border flex gap-3 text-[10px] leading-relaxed ${cardStyle}`}>
          <HelpCircle className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
          <div className="space-y-1 font-sans">
            <span className="font-bold text-indigo-300">Voice Instructions:</span>
            <p className={subText}>Speak commands clearly like: <strong className="text-slate-300 font-bold">"up"</strong>, <strong className="text-slate-300 font-bold">"down"</strong>, <strong className="text-slate-300 font-bold">"left"</strong>, <strong className="text-slate-300 font-bold">"right"</strong>, <strong className="text-slate-300 font-bold">"forward"</strong>, <strong className="text-slate-300 font-bold">"back"</strong>, <strong className="text-slate-300 font-bold">"open"</strong>, <strong className="text-slate-300 font-bold">"close"</strong>, <strong className="text-slate-300 font-bold">"home"</strong>.</p>
            <span className="font-bold text-indigo-300 block pt-1.5">Camera Hands Gestures:</span>
            <ul className={`list-disc list-inside space-y-0.5 ${subText}`}>
              <li>Index Finger Up = Target moves UP</li>
              <li>Pinch/Fist = Closes Gripper</li>
              <li>Hand Open = Opens Gripper</li>
              <li>Index Bent Downwards = Target moves DOWN</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Persistent Bottom High-Fidelity Status Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-[60] bg-slate-900/95 backdrop-blur-xl border-t border-indigo-500/20 px-6 py-2 flex flex-col min-[880px]:flex-row gap-2 items-center justify-between shadow-2xl transition-all font-sans">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isVoiceActive || isGestureActive ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isVoiceActive || isGestureActive ? 'bg-emerald-500' : 'bg-amber-400'}`}></span>
            </span>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">TELEOP STATUS CO-ORDINATOR</span>
          </div>
          
          <div className="h-4 w-px bg-slate-700/50 hidden min-[880px]:block" />
          
          <div className="flex items-center gap-2">
            <div className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-[9px] font-mono text-indigo-400 flex items-center gap-1">
              <Mic className="w-2.5 h-2.5 shrink-0" />
              <span>Voice: {isVoiceActive ? 'ACTIVE (LIVE)' : 'OFFLINE'}</span>
            </div>
            <div className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-[9px] font-mono text-indigo-400 flex items-center gap-1">
              <Video className="w-2.5 h-2.5 shrink-0" />
              <span>Camera: {isGestureActive ? 'ACTIVE (LIVE)' : 'OFFLINE'}</span>
            </div>
          </div>
        </div>

        {/* Real-time telemetry feed */}
        <div className="flex-1 flex max-[879px]:w-full justify-center min-[880px]:justify-start items-center gap-2 overflow-hidden px-2">
          <span className="text-[9px] font-bold font-mono text-slate-400 shrink-0 uppercase">TELEMETRY ACTION:</span>
          <div className={`p-1.5 px-3 rounded-xl border flex items-center gap-2 w-full max-w-[550px] overflow-hidden truncate transition-all ${
            statusBarMsg.type === 'error' 
              ? 'bg-red-500/10 border-red-500/30 text-red-400' 
              : statusBarMsg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : statusBarMsg.type === 'voice'
              ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-300'
              : statusBarMsg.type === 'gesture'
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              : 'bg-slate-950/40 border-white/5 text-slate-300'
          }`}>
            <span className="text-[9px] font-mono text-slate-500 shrink-0">[{statusBarMsg.timestamp}]</span>
            <span className="text-[10.5px] font-medium font-mono truncate">{statusBarMsg.payload}</span>
          </div>
        </div>

        {/* Controls block */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] font-mono text-indigo-300 uppercase tracking-widest pr-1 font-bold">GEMINI: AGENT MULTIMODAL ACTIVE</span>
        </div>
      </div>
    </div>
  );
}
