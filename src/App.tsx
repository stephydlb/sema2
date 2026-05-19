/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { socket } from "./components/socket";
import { Mic, MicOff, Radio, Settings, Users, Shield, Signal, Volume2, Antenna } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Types
interface Peer {
  id: string;
  connection: RTCPeerConnection;
  stream?: MediaStream;
}

export default function App() {
  const [roomId, setRoomId] = useState("050.25");
  const [isJoined, setIsJoined] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "ready">("idle");
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [lang, setLang] = useState<"fr" | "en">("fr");
  const [showFreqList, setShowFreqList] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Record<string, Peer>>({});
  const audioContextRef = useRef<AudioContext | null>(null);

  const t = {
    fr: {
      online: "En ligne",
      offline: "Hors ligne",
      active: "ACTIF",
      range: "PORTÉE 50M",
      peers: "Pairs",
      latency: "Latence",
      ch: "CH",
      ptt: "Appuyer pour parler",
      transmitting: "Transmission",
      receiving: "Réception",
      meshInit: "Initialiser le réseau",
      meshDisconnect: "Déconnecter",
      selectFreq: "Sélectionner la fréquence",
      you: "Vous (Local)",
      talking: "PARLE",
      activeStatus: "ACTIF",
      meshNotice: "Sélectionnez une fréquence pour commencer",
      ready: "Audio: Prêt",
      changeFreq: "Changer Freq"
    },
    en: {
      online: "Online",
      offline: "Offline",
      active: "ACTIVE",
      range: "50M RANGE",
      peers: "Peers",
      latency: "Latency",
      ch: "CH",
      ptt: "Push to Talk",
      transmitting: "Transmitting",
      receiving: "Receiving",
      meshInit: "Initialize Mesh",
      meshDisconnect: "Disconnect",
      selectFreq: "Select frequency",
      you: "You (Local)",
      talking: "TALKING",
      activeStatus: "ACTIVE",
      meshNotice: "Select Frequency to Start",
      ready: "Audio: Ready",
      changeFreq: "Change Freq"
    }
  }[lang];

  const frequencies = ["050.25", "101.40", "144.00", "433.00", "868.00"];

  // Initialize Socket and local stream
  useEffect(() => {
    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Disable initial tracks
        stream.getAudioTracks().forEach(track => track.enabled = false);
        setLocalStream(stream);
        localStreamRef.current = stream;
        setStatus("ready");
      } catch (err) {
        console.error("Microphone access denied", err);
        setStatus("idle");
      }
    };

    init();

    socket.on("signal", async ({ from, signal }) => {
      const peer = peersRef.current[from];
      if (peer) {
        try {
          if (signal.type === "offer") {
            await peer.connection.setRemoteDescription(new RTCSessionDescription(signal));
            const answer = await peer.connection.createAnswer();
            await peer.connection.setLocalDescription(answer);
            socket.emit("signal", { to: from, from: socket.id, signal: answer });
          } else if (signal.type === "answer") {
            await peer.connection.setRemoteDescription(new RTCSessionDescription(signal));
          } else if (signal.candidate) {
            await peer.connection.addIceCandidate(new RTCIceCandidate(signal));
          }
        } catch (e) {
          console.error("Signal error", e);
        }
      }
    });

    socket.on("user-joined", (userId) => {
      createPeer(userId, true);
    });

    socket.on("user-left", (userId) => {
      removePeer(userId);
    });

    return () => {
      socket.off("signal");
      socket.off("user-joined");
      socket.off("user-left");
    };
  }, []);

  const createPeer = useCallback((userId: string, isInitiator: boolean) => {
    const configuration = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    };
    const connection = new RTCPeerConnection(configuration);

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        connection.addTrack(track, localStreamRef.current!);
      });
    }

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("signal", { to: userId, from: socket.id, signal: event.candidate });
      }
    };

    connection.ontrack = (event) => {
      setPeers(prev => ({
        ...prev,
        [userId]: { ...prev[userId], stream: event.streams[0] }
      }));
      peersRef.current[userId] = { ...peersRef.current[userId], stream: event.streams[0] };
      
      // Monitor audio level to indicate receiving
      monitorAudioLevel(event.streams[0], userId);
    };

    if (isInitiator) {
      connection.createOffer().then(offer => {
        connection.setLocalDescription(offer);
        socket.emit("signal", { to: userId, from: socket.id, signal: offer });
      });
    }

    const peerObj = { id: userId, connection };
    setPeers(prev => ({ ...prev, [userId]: peerObj }));
    peersRef.current[userId] = peerObj;
  }, []);

  const removePeer = (userId: string) => {
    const peer = peersRef.current[userId];
    if (peer) {
      peer.connection.close();
      const newPeers = { ...peersRef.current };
      delete newPeers[userId];
      peersRef.current = newPeers;
      setPeers(newPeers);
    }
  };

  const monitorAudioLevel = (stream: MediaStream, userId: string) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    const source = audioContextRef.current.createMediaStreamSource(stream);
    const analyzer = audioContextRef.current.createAnalyser();
    source.connect(analyzer);

    const data = new Uint8Array(analyzer.frequencyBinCount);
    const check = () => {
      analyzer.getByteFrequencyData(data);
      const volume = data.reduce((a, b) => a + b) / data.length;
      if (volume > 10) {
        setActiveSpeaker(userId);
        setIsReceiving(true);
      } else {
        if (activeSpeaker === userId) {
          setActiveSpeaker(null);
          setIsReceiving(false);
        }
      }
      if (peersRef.current[userId]) {
        requestAnimationFrame(check);
      }
    };
    check();
  };

  const joinFrequency = () => {
    if (!isJoined) {
      socket.emit("join-room", roomId);
      setIsJoined(true);
    } else {
      socket.emit("disconnect-from-room", roomId);
      setIsJoined(false);
      // Close all peer connections
      Object.keys(peersRef.current).forEach(removePeer);
    }
  };

  const handlePttStart = () => {
    if (!isJoined) return;
    setIsTalking(true);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => (track.enabled = true));
    }
  };

  const handlePttEnd = () => {
    setIsTalking(false);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => (track.enabled = false));
    }
  };

  return (
    <div className="h-full w-full bg-app-bg text-[#E0E0E0] flex items-center justify-center p-4 sm:p-8 overflow-hidden select-none">
      {/* Main Device Frame */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[360px] h-full max-h-[740px] bg-card-bg border border-border rounded-[48px] shadow-2xl overflow-hidden flex flex-col relative"
      >
        {/* Header Section */}
        <div className="px-8 pt-10 pb-6 flex justify-between items-center">
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold tracking-tighter text-accent accent-glow">SEMA</h1>
            <span className="text-[10px] text-text-dim font-mono tracking-widest uppercase">v1.0.4 Secure Mesh</span>
          </div>
          <div className="flex items-center space-x-2">
            <button 
              onClick={() => setLang(lang === "fr" ? "en" : "fr")}
              className="p-1.5 px-2 bg-border/20 border border-border/40 rounded-lg text-[9px] font-bold text-accent"
            >
              {lang.toUpperCase()}
            </button>
            <div className={`w-2 h-2 rounded-full ${isJoined ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-red-500'}`}></div>
            <span className={`text-[11px] font-medium uppercase tracking-wider ${isJoined ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
              {isJoined ? t.online : t.offline}
            </span>
          </div>
        </div>

        {/* Security / Info Bar */}
        <div className="px-8 py-4 bg-[#252A33]/50 border-y border-border">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <Shield className="w-4 h-4 text-accent" />
              <span className="text-xs font-mono text-[#9CA3AF] uppercase">AES-256 {t.active}</span>
            </div>
            <span className="text-[10px] text-[#4B5563] font-bold tracking-tight">{t.range}</span>
          </div>
        </div>

        {/* Main Interface Content */}
        <div className="flex-1 flex flex-col items-center justify-between py-10 px-8">
          
          {/* Stats Row */}
          <div className="w-full flex justify-between mb-8">
            <div className="text-center">
              <div className="text-[10px] text-text-dim uppercase mb-1 font-bold tracking-wider">{t.peers}</div>
              <div className="text-xl font-light">{Object.keys(peers).length + (isJoined ? 1 : 0)}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-text-dim uppercase mb-1 font-bold tracking-wider">{t.latency}</div>
              <div className="text-xl font-light">{isJoined ? '14ms' : '--'}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-text-dim uppercase mb-1 font-bold tracking-wider">{t.ch}</div>
              <div className="text-xl font-light mono">{roomId.split('.')[1] || '01'}</div>
            </div>
          </div>

          {/* PTT Button */}
          <div className="relative group">
            <AnimatePresence>
              {(isTalking || isReceiving) && (
                <motion.div
                   initial={{ scale: 0.8, opacity: 0 }}
                   animate={{ scale: 1.4, opacity: 0.15 }}
                   exit={{ scale: 2, opacity: 0 }}
                   transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                   className={`absolute inset-0 rounded-full pointer-events-none ${isTalking ? 'bg-accent' : 'bg-blue-400'}`}
                />
              )}
            </AnimatePresence>
            
            <button
               onMouseDown={handlePttStart}
               onMouseUp={handlePttEnd}
               onTouchStart={handlePttStart}
               onTouchEnd={handlePttEnd}
               disabled={!isJoined}
               className={`
                 relative w-48 h-48 rounded-full border-4 flex flex-col items-center justify-center transition-all duration-300 box-glow
                 ${!isJoined ? 'border-border bg-transparent opacity-40 cursor-not-allowed text-text-dim' : 
                   isTalking ? 'border-accent bg-accent/10 text-accent scale-95 shadow-[0_0_30px_rgba(0,209,255,0.2)]' : 
                   'border-border bg-card-bg hover:border-accent/40 text-[#E0E0E0] active:scale-95'}
               `}
            >
              <div className={`w-40 h-40 rounded-full border flex flex-col items-center justify-center gap-2 transition-colors
                ${isTalking ? 'border-accent/50' : 'border-accent/20'}
              `}>
                {isTalking ? <Mic className="w-10 h-10" /> : <MicOff className="w-10 h-10" />}
                <span className={`text-[10px] font-black tracking-[0.2em] uppercase transition-colors text-center px-4
                  ${isTalking ? 'text-accent' : 'text-accent/60'}
                `}>
                  {isTalking ? t.transmitting : isReceiving ? t.receiving : t.ptt}
                </span>
              </div>
            </button>
          </div>

          {/* Channel Selector / Peer List Mockup area */}
          <div className="w-full mt-10 space-y-3 overflow-y-auto max-h-[160px] pr-1 custom-scrollbar">
            {isJoined ? (
              <>
                <div className="flex items-center justify-between p-3 bg-[#252A33] rounded-xl border border-border">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold text-xs mono italic">Y</div>
                    <span className="text-sm font-medium">{t.you}</span>
                  </div>
                  <span className={`text-[10px] font-mono ${isTalking ? 'text-accent animate-pulse' : 'text-text-dim'}`}>
                    {isTalking ? t.talking : t.activeStatus}
                  </span>
                </div>
                {Object.entries(peers).map(([id]) => (
                  <div key={id} className="flex items-center justify-between p-3 bg-transparent rounded-xl border border-border/50">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-full bg-text-dim/20 flex items-center justify-center text-text-dim font-bold text-xs mono italic">
                        {id.substring(0, 1).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium">Peer_{id.substring(0, 4)}</span>
                    </div>
                    <span className="text-[10px] font-mono text-text-dim">12m</span>
                  </div>
                ))}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-20 text-text-dim/40 border border-dashed border-border rounded-xl">
                <Radio className="w-6 h-6 mb-2" />
                <span className="text-[10px] font-bold tracking-widest uppercase text-center">{t.meshNotice}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer / Controls Section */}
        <div className="px-8 py-6 border-t border-border flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <button 
               onClick={joinFrequency}
               className={`flex-1 py-3 px-4 rounded-xl border font-bold text-[10px] tracking-[0.1em] transition-all uppercase
                 ${isJoined 
                   ? 'bg-red-500/10 border-red-500/30 text-red-500 hover:bg-red-500/20' 
                   : 'bg-accent/10 border-accent/20 text-accent hover:bg-accent/20'}
               `}
            >
              {isJoined ? t.meshDisconnect : t.meshInit}
            </button>
            <div className="flex flex-col gap-2">
               <button 
                onClick={() => !isJoined && setShowFreqList(!showFreqList)}
                className={`py-3 px-4 rounded-xl border font-bold text-[10px] tracking-[0.1em] transition-all uppercase flex items-center gap-2
                  ${isJoined ? 'opacity-50 cursor-not-allowed' : 'bg-border/20 border-border/40 text-white hover:bg-border/30'}
                `}
               >
                 <Settings className="w-3 h-3" />
                 {t.changeFreq}
               </button>
            </div>
          </div>

          <AnimatePresence>
            {(showFreqList && !isJoined) && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden flex flex-wrap gap-2"
              >
                {frequencies.map((freq) => (
                  <button
                    key={freq}
                    onClick={() => {
                      setRoomId(freq);
                      setShowFreqList(false);
                    }}
                    className={`px-3 py-2 rounded-lg text-[10px] font-bold transition-all uppercase flex-1 min-w-[70px] border
                      ${roomId === freq ? 'bg-accent text-card-bg border-accent' : 'bg-transparent text-text-dim border-border/50 hover:border-accent/40'}
                    `}
                  >
                    {freq}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          
          <div className="h-1 bg-border rounded-full w-24 mx-auto mt-2"></div>
        </div>
      </motion.div>

      {/* Hidden Audio Elements */}
      <div className="hidden">
        {Object.keys(peers).map((id) => {
          const peer = peers[id];
          if (!peer.stream) return null;
          return (
            <audio 
              key={id} 
              autoPlay 
              playsInline 
              ref={(el) => { if (el) el.srcObject = peer.stream as MediaStream }} 
            />
          );
        })}
      </div>
    </div>
  );
}

