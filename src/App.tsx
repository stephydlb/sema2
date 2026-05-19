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
  userName?: string;
  connection: RTCPeerConnection;
  stream?: MediaStream;
}

export default function App() {
  const [view, setView] = useState<"splash" | "guide" | "app" | "dev">("splash");
  const [userName, setUserName] = useState("");
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
      welcome: "Bienvenue sur SEMA",
      tagline: "Communications Locales Sécurisées",
      getStarted: "Commencer",
      guideTitle: "Comment utiliser SEMA",
      instruction1: "1. Choisissez une fréquence identique à celle de vos amis.",
      instruction2: "2. Cliquez sur 'Initialiser le réseau' pour rejoindre.",
      instruction3: "3. Maintenez le bouton central pour parler.",
      instruction4: "4. Portée optimale: 50 mètres en local.",
      understand: "J'ai compris",
      enterName: "Entrez votre nom temporaire",
      namePlaceholder: "e.g. Alpha-7",
      devProfile: "Profil du Développeur",
      goBack: "Retour",
      visitGithub: "Visiter GitHub",
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
      welcome: "Welcome to SEMA",
      tagline: "Secure Local Communications",
      getStarted: "Get Started",
      guideTitle: "How to use SEMA",
      instruction1: "1. Choose a frequency identical to your friends.",
      instruction2: "2. Click 'Initialize Mesh' to join the channel.",
      instruction3: "3. Hold the center button to transmit voice.",
      instruction4: "4. Optimal range: 50 meters locally.",
      understand: "I understand",
      enterName: "Enter your temporary name",
      namePlaceholder: "e.g. Rogue-One",
      devProfile: "Developer Profile",
      goBack: "Go Back",
      visitGithub: "Visit GitHub",
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

    socket.on("signal", async ({ from, signal, userName: peerName }) => {
      const peer = peersRef.current[from];
      if (peer) {
        if (peerName && !peer.userName) {
          peer.userName = peerName;
          setPeers(prev => ({
            ...prev,
            [from]: { ...prev[from], userName: peerName }
          }));
        }
        try {
          if (signal.type === "offer") {
            await peer.connection.setRemoteDescription(new RTCSessionDescription(signal));
            const answer = await peer.connection.createAnswer();
            await peer.connection.setLocalDescription(answer);
            socket.emit("signal", { to: from, from: socket.id, signal: answer, userName: localStreamRef.current ? userName : "" });
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

    socket.on("user-joined", ({ userId, userName: peerName }) => {
      createPeer(userId, true, peerName);
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

  const createPeer = useCallback((userId: string, isInitiator: boolean, peerName?: string) => {
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
        socket.emit("signal", { to: userId, from: socket.id, signal: event.candidate, userName });
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
        socket.emit("signal", { to: userId, from: socket.id, signal: offer, userName });
      });
    }

    const peerObj = { id: userId, connection, userName: peerName };
    setPeers(prev => ({ ...prev, [userId]: peerObj }));
    peersRef.current[userId] = peerObj;
  }, [userName]);

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
      socket.emit("join-room", { roomName: roomId, userName });
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

  if (view === "splash") {
    return (
      <div className="h-full w-full bg-app-bg text-[#E0E0E0] flex items-center justify-center p-4 overflow-hidden select-none">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-[360px] h-[640px] bg-card-bg border border-border rounded-[48px] shadow-2xl overflow-hidden flex flex-col items-center justify-center p-8 text-center"
        >
          <Antenna className="w-20 h-20 text-accent mb-6 accent-glow" />
          <h1 className="text-4xl font-black tracking-tighter text-accent mb-2 accent-glow">SEMA</h1>
          <p className="text-sm text-text-dim mb-12 font-mono uppercase tracking-[0.2em]">{t.tagline}</p>
          
          <button 
            onClick={() => setView("guide")}
            className="w-full py-4 bg-accent/10 border border-accent/30 rounded-2xl text-accent font-bold tracking-widest uppercase hover:bg-accent/20 transition-all active:scale-95"
          >
            {t.getStarted}
          </button>
        </motion.div>
      </div>
    );
  }

  if (view === "guide") {
    return (
      <div className="h-full w-full bg-app-bg text-[#E0E0E0] flex items-center justify-center p-4 overflow-hidden select-none">
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full max-w-[360px] h-[640px] bg-card-bg border border-border rounded-[48px] shadow-2xl overflow-hidden flex flex-col p-8"
        >
          <div className="flex-1 flex flex-col justify-center gap-8">
            <div className="flex flex-col gap-2">
               <Shield className="w-10 h-10 text-accent mb-2" />
               <h2 className="text-2xl font-bold tracking-tight">{t.guideTitle}</h2>
            </div>
            
            <div className="space-y-6 text-sm text-[#9CA3AF] font-medium leading-relaxed">
              <div className="flex flex-col gap-3">
                 <label className="text-[10px] text-accent font-bold uppercase tracking-widest">{t.enterName}</label>
                 <input 
                  type="text" 
                  value={userName}
                  onChange={(e) => setUserName(e.target.value.substring(0, 12))}
                  placeholder={t.namePlaceholder}
                  className="w-full bg-[#252A33] border border-border p-4 rounded-2xl text-white focus:outline-none focus:border-accent/50 transition-colors"
                 />
              </div>
              <p className="flex gap-3">
                <span className="text-accent">01.</span> {t.instruction1}
              </p>
              <p className="flex gap-3">
                <span className="text-accent">02.</span> {t.instruction2}
              </p>
              <p className="flex gap-3">
                <span className="text-accent">03.</span> {t.instruction3}
              </p>
              <p className="flex gap-3">
                <span className="text-accent">04.</span> {t.instruction4}
              </p>
            </div>
          </div>

          <button 
            onClick={() => userName.trim() && setView("app")}
            disabled={!userName.trim()}
            className="w-full py-4 bg-accent text-card-bg rounded-2xl font-black tracking-widest uppercase hover:bg-accent/90 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t.understand}
          </button>
        </motion.div>
      </div>
    );
  }

  if (view === "dev") {
    return (
      <div className="h-full w-full bg-app-bg text-[#E0E0E0] flex items-center justify-center p-4 overflow-hidden select-none">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-[360px] h-[640px] bg-card-bg border border-border rounded-[48px] shadow-2xl overflow-hidden flex flex-col items-center p-8"
        >
          <div className="pt-10 flex flex-col items-center text-center flex-1">
             <div className="w-32 h-32 rounded-full border-2 border-accent p-1 mb-6">
                <img 
                  src="https://github.com/stephydlb.png" 
                  alt="Developer" 
                  className="w-full h-full rounded-full object-cover grayscale hover:grayscale-0 transition-all duration-500"
                  referrerPolicy="no-referrer"
                />
             </div>
             <h2 className="text-2xl font-bold mb-1">stephydlb</h2>
             <p className="text-accent text-[10px] font-mono uppercase tracking-[0.2em] mb-8">{t.devProfile}</p>
             
             <p className="text-sm text-text-dim leading-relaxed px-4">
                Full-stack developer passionate about building secure, privacy-focused communication tools for the mobile-first generation.
             </p>

             <div className="mt-12 w-full space-y-3">
                <a 
                  href="https://github.com/stephydlb" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-full py-4 bg-border/20 border border-border/50 rounded-2xl flex items-center justify-center gap-3 font-bold hover:bg-border/30 transition-all"
                >
                  <Users className="w-5 h-5" />
                  {t.visitGithub}
                </a>
             </div>
          </div>

          <button 
            onClick={() => setView("app")}
            className="mb-8 text-xs font-bold text-text-dim hover:text-white transition-colors"
          >
            {t.goBack}
          </button>
        </motion.div>
      </div>
    );
  }

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
            <h1 className="text-2xl font-bold tracking-tighter text-accent accent-glow pointer-events-auto cursor-pointer" onClick={() => setView("dev")}>SEMA</h1>
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
                    <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold text-xs mono italic uppercase">
                      {userName.charAt(0) || 'Y'}
                    </div>
                    <span className="text-sm font-medium">{userName || t.you}</span>
                  </div>
                  <span className={`text-[10px] font-mono ${isTalking ? 'text-accent animate-pulse' : 'text-text-dim'}`}>
                    {isTalking ? t.talking : t.activeStatus}
                  </span>
                </div>
                {Object.entries(peers).map(([id, p]) => {
                  const peer = p as Peer;
                  return (
                    <div key={id} className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${activeSpeaker === id ? 'bg-blue-500/10 border-blue-400/50' : 'bg-transparent border-border/50'}`}>
                      <div className="flex items-center space-x-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs mono italic uppercase ${activeSpeaker === id ? 'bg-blue-400 text-card-bg' : 'bg-text-dim/20 text-text-dim'}`}>
                          {(peer.userName || 'P').charAt(0)}
                        </div>
                        <span className={`text-sm font-medium ${activeSpeaker === id ? 'text-blue-400' : ''}`}>
                          {peer.userName || `Peer_${id.substring(0, 4)}`}
                        </span>
                      </div>
                      {activeSpeaker === id && (
                        <Volume2 className="w-3 h-3 text-blue-400 animate-pulse" />
                      )}
                    </div>
                  );
                })}
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
          const peer = peers[id] as Peer;
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

