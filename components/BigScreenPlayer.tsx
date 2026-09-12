import React, { useState, useEffect, useRef } from "react";
import { Song, LyricLine } from "../types";
import { formatTime } from "../services/utils";

interface NowPlayingPanelProps {
  queue: Song[];
  currentSong?: Song | null;
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  accentColor: string;
  lyrics: LyricLine[];
  onPlayIndex: (index: number) => void;
  onClose: () => void;
  audioRef: React.RefObject<HTMLAudioElement>;
}

const NowPlayingPanel: React.FC<NowPlayingPanelProps> = ({
  queue,
  currentSong,
  currentIndex,
  isPlaying,
  currentTime,
  duration,
  accentColor,
  lyrics,
  onPlayIndex,
  onClose,
  audioRef,
}) => {
  const [activeLyricIdx, setActiveLyricIdx] = useState(-1);
  const [tab, setTab] = useState<"lyrics" | "queue">("lyrics");
  const activeLineRef = useRef<HTMLDivElement>(null);

  // ESC 关闭
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // 当前歌词行
  useEffect(() => {
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].isMetadata) continue;
      if (currentTime >= lyrics[i].time) idx = i;
    }
    setActiveLyricIdx(idx);
  }, [currentTime, lyrics]);

  useEffect(() => {
    if (activeLineRef.current && tab === "lyrics") {
      activeLineRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeLyricIdx, tab]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    if (audioRef.current && duration > 0) {
      audioRef.current.currentTime = ratio * duration;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* 主面板 —— 紧凑毛玻璃弹窗 */}
      <div
        className="relative w-[560px] max-h-[80vh] rounded-2xl bg-white/10 backdrop-blur-2xl border border-white/20 shadow-2xl overflow-hidden flex flex-col animate-[fadeIn_.2s_ease-out]"
        style={{ boxShadow: `0 20px 60px ${accentColor}25` }}
      >
        {/* 顶部 —— 正在播放条 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="text-white/80 text-sm font-medium">正在播放</div>
            <div className="text-white/30 text-xs">
              {currentSong ? `· ${currentIndex + 1} / ${queue.length}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTab(tab === "lyrics" ? "queue" : "lyrics")}
              className="px-2.5 py-1 rounded-md text-xs text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              title={tab === "lyrics" ? "切到播放列表" : "切到歌词"}
            >
              {tab === "lyrics" ? "☰ 列表" : "♪ 歌词"}
            </button>
            <button
              onClick={onClose}
              className="w-6 h-6 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center text-sm active:scale-90"
              title="关闭 (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 中间 —— tab 内容 */}
        {tab === "lyrics" ? (
          <>
            {/* 当前歌曲信息 + 进度 */}
            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center gap-3">
                {/* 迷你封面 */}
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-white/5 ring-1 ring-white/10 shrink-0">
                  {currentSong?.coverUrl ? (
                    <img src={currentSong.coverUrl} alt="" className={`w-full h-full object-cover ${isPlaying ? "animate-spin-slow" : ""}`} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/20 text-lg">♪</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-white font-semibold text-sm truncate">
                    {currentSong?.title || "暂无歌曲"}
                  </div>
                  <div className="text-white/40 text-xs truncate mt-0.5">
                    {currentSong?.artist || "—"}
                  </div>
                </div>
              </div>

              {/* 进度条 */}
              <div className="mt-2.5">
                <div
                  className="relative h-1 rounded-full bg-white/10 cursor-pointer group"
                  onClick={handleProgressClick}
                >
                  <div
                    className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-100"
                    style={{ width: `${progress}%`, background: accentColor }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ left: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-between text-white/30 text-[10px] mt-1 font-mono">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* 控制按钮 */}
              <div className="mt-2 flex items-center justify-center gap-1">
                <button
                  onClick={() => { onPlayIndex(Math.max(0, currentIndex - 1)); }}
                  className="w-8 h-8 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors flex items-center justify-center active:scale-90"
                  title="上一首"
                >
                  ⏮
                </button>
                <button
                  onClick={() => {
                    const audio = audioRef.current;
                    if (audio) audio.paused ? audio.play() : audio.pause();
                  }}
                  className="w-10 h-10 rounded-full text-black flex items-center justify-center shadow transition-transform hover:scale-105 active:scale-90"
                  style={{ background: accentColor }}
                  title={isPlaying ? "暂停" : "播放"}
                >
                  {isPlaying ? "⏸" : "▶"}
                </button>
                <button
                  onClick={() => { onPlayIndex(Math.min(queue.length - 1, currentIndex + 1)); }}
                  className="w-8 h-8 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors flex items-center justify-center active:scale-90"
                  title="下一首"
                >
                  ⏭
                </button>
              </div>
            </div>

            {/* 分隔线 */}
            <div className="h-px bg-white/5 mx-4" />

            {/* 歌词列表 */}
            <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0 custom-scroll">
              {lyrics.length > 0 ? (
                <div className="space-y-0.5">
                  {lyrics.map((line, i) => {
                    if (line.isMetadata) return null;
                    const isActive = i === activeLyricIdx;
                    return (
                      <div
                        key={i}
                        ref={isActive ? activeLineRef : undefined}
                        className={`text-[14px] leading-relaxed cursor-pointer px-2 py-1 rounded-md transition-all duration-300 ${
                          isActive
                            ? "text-white font-medium bg-white/5"
                            : "text-white/35 hover:text-white/65"
                        }`}
                        onClick={() => {
                          if (audioRef.current) audioRef.current.currentTime = line.time;
                        }}
                      >
                        {line.text || "♪"}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-white/25 text-sm">
                  暂无歌词
                </div>
              )}
            </div>
          </>
        ) : (
          /* 播放列表 */
          <div className="flex-1 overflow-y-auto py-2 min-h-0 custom-scroll">
            {queue.length > 0 ? (
              queue.map((song, i) => {
                const isCurrent = i === currentIndex;
                return (
                  <div
                    key={song.id}
                    onClick={() => onPlayIndex(i)}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                      isCurrent ? "bg-white/10" : "hover:bg-white/5"
                    }`}
                  >
                    <div className={`w-1 text-xs font-mono ${isCurrent ? "text-white" : "text-white/30"}`}>
                      {isCurrent ? "▶" : i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm truncate ${isCurrent ? "text-white font-medium" : "text-white/70"}`}>
                        {song.title}
                      </div>
                      <div className="text-[11px] text-white/40 truncate mt-0.5">
                        {song.artist}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-white/25 text-sm">
                播放列表为空
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        .custom-scroll::-webkit-scrollbar { width: 5px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
        .custom-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn .2s ease-out; }
      `}</style>
    </div>
  );
};

export default NowPlayingPanel;
