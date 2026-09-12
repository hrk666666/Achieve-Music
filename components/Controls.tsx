import React, { useState, useRef, useEffect } from "react";
import { useSpring, animated, to } from "@react-spring/web";
import { formatTime } from "../services/utils";
import Visualizer from "./visualizer/Visualizer";
import SmartImage from "./SmartImage";
import {
  LoopIcon,
  LoopOneIcon,
  ShuffleIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  NextIcon,
  QueueIcon,
} from "./Icons";
import { PlayMode } from "../types";

interface ControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number, playImmediately?: boolean, defer?: boolean) => void;
  title: string;
  artist: string;
  audioRef: React.RefObject<HTMLAudioElement>;
  onNext: () => void;
  onPrev: () => void;
  playMode: PlayMode;
  onToggleMode: () => void;
  onTogglePlaylist: () => void;
  accentColor: string;
  coverUrl?: string;
  isBuffering: boolean;
}

const Controls: React.FC<ControlsProps> = ({
  isPlaying,
  onPlayPause,
  currentTime,
  duration,
  onSeek,
  title,
  artist,
  audioRef,
  onNext,
  onPrev,
  playMode,
  onToggleMode,
  onTogglePlaylist,
  accentColor,
  coverUrl,
  isBuffering,
}) => {

  // Progress bar seeking state
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekTime, setSeekTime] = useState(0);

  // Optimistic seek state
  const [isWaitingForSeek, setIsWaitingForSeek] = useState(false);
  const seekTargetRef = useRef(0);

  // Interpolated time for smooth progress bar
  const [interpolatedTime, setInterpolatedTime] = useState(currentTime);
  const progressLastTimeRef = useRef(Date.now());

  // Buffered time range from audio element
  const [bufferedEnd, setBufferedEnd] = useState(0);

  useEffect(() => {
    if (isSeeking) return;

    // If we are waiting for a seek to complete, check if we've reached the target
    if (isWaitingForSeek) {
      const diff = Math.abs(currentTime - seekTargetRef.current);
      // If we are close enough (within 0.5s), or if enough time has passed (handled by timeout elsewhere),
      // we consider the seek 'done' and resume normal syncing.
      // But for now, we ONLY sync if close, otherwise we keep the optimistic value.
      if (diff < 0.5) {
        setIsWaitingForSeek(false);
        setInterpolatedTime(currentTime);
      }
      // Else: do nothing, keep interpolatedTime as is (the seek target)
    } else {
      // Normal operation: sync with prop
      setInterpolatedTime(currentTime);
    }

    if (!isPlaying) return;

    let animationFrameId: number;

    const animate = () => {
      const now = Date.now();
      const dt = (now - progressLastTimeRef.current) / 1000;
      progressLastTimeRef.current = now;

      if (isPlaying && !isSeeking && !isWaitingForSeek) {
        setInterpolatedTime((prev) => {
          // Simple linear extrapolation
          const next = prev + dt;
          // Clamp to duration
          return Math.min(next, duration);
        });
      } else if (isPlaying && isWaitingForSeek) {
        // If waiting for seek, we can still extrapolate from the target
        // to make it feel responsive immediately
        setInterpolatedTime((prev) => {
          const next = prev + dt;
          return Math.min(next, duration);
        });
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    progressLastTimeRef.current = Date.now();
    animationFrameId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrameId);
  }, [currentTime, isPlaying, isSeeking, duration, isWaitingForSeek]);

  // Update buffered time range from audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateBuffered = () => {
      // Get the audio's actual duration (may differ from prop during loading)
      const audioDuration = audio.duration;

      if (audio.buffered.length > 0 && Number.isFinite(audioDuration) && audioDuration > 0) {
        // Find the maximum buffered end time
        let maxEnd = 0;
        for (let i = 0; i < audio.buffered.length; i++) {
          const end = audio.buffered.end(i);
          if (end > maxEnd) {
            maxEnd = end;
          }
        }
        // Clamp to duration to prevent exceeding 100%
        setBufferedEnd(Math.min(maxEnd, audioDuration));
      } else {
        setBufferedEnd(0);
      }
    };

    // Reset buffered state when audio source changes
    const handleEmptied = () => {
      setBufferedEnd(0);
    };

    // Initial update
    updateBuffered();

    // Listen to various events for buffer updates
    audio.addEventListener("progress", updateBuffered);
    audio.addEventListener("loadeddata", updateBuffered);
    audio.addEventListener("canplaythrough", updateBuffered);
    audio.addEventListener("durationchange", updateBuffered);
    audio.addEventListener("emptied", handleEmptied);
    audio.addEventListener("loadstart", handleEmptied);

    return () => {
      audio.removeEventListener("progress", updateBuffered);
      audio.removeEventListener("loadeddata", updateBuffered);
      audio.removeEventListener("canplaythrough", updateBuffered);
      audio.removeEventListener("durationchange", updateBuffered);
      audio.removeEventListener("emptied", handleEmptied);
      audio.removeEventListener("loadstart", handleEmptied);
    };
  }, [audioRef]);

  const displayTime = isSeeking ? seekTime : interpolatedTime;

  const [coverSpring, coverApi] = useSpring(() => ({
    scale: isPlaying ? 1.04 : 0.94,
    boxShadow: isPlaying
      ? "0 20px 35px rgba(0,0,0,0.55)"
      : "0 10px 20px rgba(0,0,0,0.45)",
    config: { tension: 300, friction: 28 },
  }));

  useEffect(() => {
    coverApi.start({
      scale: isPlaying ? 1.04 : 0.94,
      boxShadow: isPlaying
        ? "0 20px 35px rgba(0,0,0,0.55)"
        : "0 10px 20px rgba(0,0,0,0.45)",
      config: { tension: 300, friction: 28 },
    });
  }, [isPlaying, coverApi]);

  useEffect(() => {
    if (!coverUrl) return;
    coverApi.start({
      scale: 0.96,
      config: { tension: 320, friction: 24 },
    });
    const timeout = window.setTimeout(() => {
      coverApi.start({
        scale: isPlaying ? 1.04 : 0.94,
        boxShadow: isPlaying
          ? "0 20px 35px rgba(0,0,0,0.55)"
          : "0 10px 20px rgba(0,0,0,0.45)",
        config: { tension: 260, friction: 32 },
      });
    }, 180);
    return () => clearTimeout(timeout);
  }, [coverUrl, isPlaying, coverApi]);



  const getModeIcon = () => {
    // Standard white colors, simplified hover
    const iconClass =
      "w-5 h-5 text-white/60 hover:text-white transition-colors";

    switch (playMode) {
      case PlayMode.LOOP_ONE:
        return (
          <div className="relative">
            <LoopOneIcon className={iconClass} />
            <span className="absolute -top-1 -right-1 text-[8px] font-bold bg-white text-black rounded-[2px] px-0.5 leading-none">
              1
            </span>
          </div>
        );
      case PlayMode.SHUFFLE:
        return <ShuffleIcon className={iconClass} />;
      default: // LOOP_ALL
        return <LoopIcon className={iconClass} />;
    }
  };

  const controlsScaleSpring = useSpring({
    scale: isPlaying ? 1.02 : 0.97,
    config: {
      tension: isPlaying ? 320 : 260,
      friction: isPlaying ? 22 : 30,
    },
    immediate: false,
  });

  // Calculate buffered percentage from actual audio buffered time
  const bufferedWidthPercent = duration > 0
    ? Math.min(100, Math.max(0, (bufferedEnd / duration) * 100))
    : 0;

  return (
    <div className="w-full flex flex-col items-center justify-center gap-2 text-white select-none">
      {/* Cover Section */}
      <animated.div
        style={{
          boxShadow: coverSpring.boxShadow,
          transform: to(
            [coverSpring.scale, controlsScaleSpring.scale],
            (coverScale, controlScale) => `scale(${coverScale * controlScale})`
          ),
        }}
        className="relative aspect-square w-64 md:w-72 lg:w-[300px] rounded-3xl bg-gradient-to-br from-gray-800 to-gray-900 shadow-lg shadow-black/30 ring-1 ring-white/10 overflow-hidden mb-6"
      >
        {coverUrl ? (
          <SmartImage
            src={coverUrl}
            alt="Album Art"
            containerClassName="absolute inset-0"
            imgClassName="w-full h-full object-cover"
            loading="eager"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/20">
            <div className="text-8xl mb-4">♪</div>
            <p className="text-sm">No Music Loaded</p>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent pointer-events-none"></div>
      </animated.div>
      {/* Song Info */}
      <div className="text-center mb-1 px-4 select-text cursor-text">
        <h2 className="text-2xl font-bold tracking-tight drop-shadow-md line-clamp-1">
          {title}
        </h2>
        <p className="text-white/60 text-lg font-medium line-clamp-1">
          {artist}
        </p>
      </div>

      {/* Spectrum Visualizer */}
      <div className="w-full flex justify-center h-8 mb-2">
        <Visualizer audioRef={audioRef} isPlaying={isPlaying} />
      </div>

      {/* Progress Bar */}
      <div className="w-full max-w-xl flex items-center gap-3 text-xs font-medium text-white/50 group/bar relative">
        <span className="w-10 text-right font-mono tracking-widest">
          {formatTime(displayTime)}
        </span>

        <div className="relative flex-1 h-8 flex items-center cursor-pointer group">
          {/* Background Track */}
          <div className="absolute inset-x-0 h-[3px] bg-white/20 rounded-full group-hover:h-[6px] transition-[height] duration-200 ease-out"></div>

          {/* Buffer Progress */}
          <div
            className="absolute left-0 h-[3px] rounded-full group-hover:h-[6px] transition-[height] duration-200 ease-out"
            style={{
              width: bufferedWidthPercent + "%",
              backgroundColor: "rgba(255,255,255,0.35)",
            }}
          ></div>

          {/* Active Progress */}
          <div
            className="absolute left-0 h-[3px] rounded-full group-hover:h-[6px] transition-[height] duration-200 ease-out"
            style={{
              width: `${(displayTime / (duration || 1)) * 100}%`,
              backgroundColor: "rgba(255,255,255,0.9)",
            }}
          ></div>

          {/* Input Range */}
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={displayTime}
            onMouseDown={() => setIsSeeking(true)}
            onTouchStart={() => setIsSeeking(true)}
            onChange={(e) => {
              const time = parseFloat(e.target.value);
              setSeekTime(time);
              onSeek(time, false, true); // Deferred seek
            }}
            onMouseUp={(e) => {
              const time = parseFloat((e.target as HTMLInputElement).value);
              onSeek(time, false, false); // Actual seek
              setIsSeeking(false);

              // Optimistic update
              setInterpolatedTime(time);
              seekTargetRef.current = time;
              setIsWaitingForSeek(true);

              // Safety timeout: if seek doesn't happen within 1s, give up waiting
              setTimeout(() => setIsWaitingForSeek(false), 1000);
            }}
            onTouchEnd={(e) => {
              const time = parseFloat((e.target as HTMLInputElement).value);
              onSeek(time, false, false); // Actual seek
              setIsSeeking(false);

              // Optimistic update
              setInterpolatedTime(time);
              seekTargetRef.current = time;
              setIsWaitingForSeek(true);

              // Safety timeout
              setTimeout(() => setIsWaitingForSeek(false), 1000);
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
          />
        </div>

        <span className="w-10 font-mono tracking-widest">
          {formatTime(duration)}
        </span>
      </div>

      {/* Controls Row - Flattened for Equal Spacing */}
      {/* Layout: [Mode] [Vol] [Prev] [Play] [Next] [Settings] [List] */}
      <div className="w-full max-w-[380px] mt-2 md:mt-6 px-2">
        <div className="flex items-center justify-between w-full">
          {/* 1. Play Mode */}
          <button
            onClick={onToggleMode}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
            title="Playback Mode"
          >
            {getModeIcon()}
          </button>



          {/* 3. Previous */}
          <button
            onClick={onPrev}
            className="text-white hover:text-white/70 transition-colors active:scale-90 duration-200"
            aria-label="Previous"
          >
            <PrevIcon className="w-9 h-9" />
          </button>

          {/* 4. Play/Pause (Center) */}
          <button
            onClick={onPlayPause}
            className="w-14 h-14 flex items-center justify-center rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-transform duration-200 shadow-lg shadow-white/10"
          >
            <div className="relative w-6 h-6">
              {/* Pause Icon */}
              <PauseIcon
                className={`absolute inset-0 w-full h-full transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isPlaying
                  ? "opacity-100 scale-100 rotate-0"
                  : "opacity-0 scale-50 -rotate-90"
                  }`}
              />

              <PlayIcon
                className={`absolute inset-0 w-full h-full transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${!isPlaying
                  ? "opacity-100 scale-100 rotate-0"
                  : "opacity-0 scale-50 rotate-90"
                  }`}
              />
            </div>
          </button>

          {/* 5. Next */}
          <button
            onClick={onNext}
            className="text-white hover:text-white/70 transition-colors active:scale-90 duration-200"
            aria-label="Next"
          >
            <NextIcon className="w-9 h-9" />
          </button>



          {/* 7. Playlist/Queue */}
          <button
            onClick={onTogglePlaylist}
            className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/60 hover:text-white"
            title="Queue"
          >
            <QueueIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Controls;




