import React, { useState, useRef, useEffect, useCallback } from "react";
import { useToast } from "./hooks/useToast";
import { PlayState, Song } from "./types";
import FluidBackground from "./components/FluidBackground";
import Controls from "./components/Controls";
import LyricsView from "./components/LyricsView";
import PlaylistPanel from "./components/PlaylistPanel";
import KeyboardShortcuts from "./components/KeyboardShortcuts";
import SearchModal from "./components/SearchModal";
import { usePlaylist } from "./hooks/usePlaylist";
import { usePlayer } from "./hooks/usePlayer";
import { keyboardRegistry } from "./services/keyboardRegistry";
import MediaSessionController from "./components/MediaSessionController";
import SplashScreen from "./components/SplashScreen";

const SPLASH_KEY = "achieve_music_splash_seen";
const MUSIC_SCAN_KEY = "achieve_music_music_folder_scan";

interface UpdateInfo {
  current: string;
  latest: string;
  has_update: boolean;
  download_url: string;
}

// 无歌词时的全屏播放器模式（唱片式大封面，不显示任何提示文字）
const FullscreenPlayer: React.FC<{
  coverUrl?: string;
  title: string;
  artist: string;
  accentColor: string;
  isPlaying: boolean;
}> = ({ coverUrl, title, artist, accentColor, isPlaying }) => (
  <div className="flex flex-col items-center justify-center h-full gap-8 select-none">
    <div className="relative">
      <div
        className="absolute -inset-8 rounded-full blur-3xl transition-opacity duration-700"
        style={{
          background: accentColor,
          opacity: 0.25,
          animation: isPlaying ? "halo-pulse 6s ease-in-out infinite" : "none",
        }}
      />
      <div
        className={`relative w-56 h-56 md:w-72 md:h-72 rounded-full overflow-hidden ring-1 ring-white/15 shadow-2xl bg-gradient-to-br from-gray-800 to-gray-900 ${
          isPlaying ? "animate-spin-slow" : ""
        }`}
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={title}
            className="w-full h-full object-cover pointer-events-none"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/25 text-7xl">
            ♪
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-tr from-black/25 to-transparent pointer-events-none" />
      </div>
      {/* 唱片中心孔 */}
      <div className="absolute inset-0 m-auto w-9 h-9 rounded-full bg-black/70 ring-2 ring-white/25 pointer-events-none" />
    </div>
    <div className="text-center space-y-1.5 px-6">
      <h2 className="text-2xl font-bold tracking-tight line-clamp-1 text-white drop-shadow-md">
        {title}
      </h2>
      <p className="text-white/55 text-lg font-medium line-clamp-1">
        {artist}
      </p>
    </div>
  </div>
);

const App: React.FC = () => {
  const { toast } = useToast();
  const playlist = usePlaylist();
  const player = usePlayer({
    queue: playlist.queue,
    originalQueue: playlist.originalQueue,
    updateSongInQueue: playlist.updateSongInQueue,
    setQueue: playlist.setQueue,
    setOriginalQueue: playlist.setOriginalQueue,
  });

  const {
    audioRef,
    currentSong,
    playState,
    currentTime,
    duration,
    playMode,
    matchStatus,
    accentColor,
    togglePlay,
    toggleMode,
    handleSeek,
    playNext,
    playPrev,
    handleTimeUpdate,
    handleLoadedMetadata,
    handlePlaylistAddition,
    loadLyricsFile,
    playIndex,
    currentIndex,
    addSongAndPlay,
    handleAudioEnded,
    play,
    pause,
    resolvedAudioSrc,
    isBuffering,
    audioError,
  } = player;

  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showSplash, setShowSplash] = useState(() => {
    try { return !localStorage.getItem(SPLASH_KEY); } catch { return true; }
  });
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 更新横幅可见性
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  // music 文件夹自动扫描开关（默认开启）
  const [musicScanEnabled, setMusicScanEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUSIC_SCAN_KEY) !== "0";
    } catch {
      return true;
    }
  });

  // 启动检查：更新 / 网易云可用性 / music 文件夹扫描
  useEffect(() => {
    // 1) 检查 GitHub 是否有新版本（非强制，网络异常静默）
    fetch("/api/check-update")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.has_update && data.latest !== data.current) {
          setUpdateInfo(data);
        }
      })
      .catch(() => {
        /* 网络异常，静默跳过 */
      });

    // 2) 检查网易云搜索可用性（仅提示一次，不影响本地播放）
    fetch("/api/music?server=netease&type=search&id=test")
      .then((r) => r.text())
      .then((text) => {
        // 搜索失败时服务端返回 HTTP 502 + JSON {"error":...}；网络断开也可能返回空
        const body = (text || "").trim();
        const unusable =
          /"error"/.test(body) ||
          /"message"/.test(body) ||
          body === "[]" ||
          body === "" ||
          body === "null";
        if (unusable) {
          toast.info("网易云搜索暂不可用，可继续使用本地文件播放");
        }
      })
      .catch(() => {
        toast.info("网易云搜索暂不可用，可继续使用本地文件播放");
      });

    // 3) 自动扫描 music 文件夹（受开关控制）
    if (musicScanEnabled) {
      fetch("/api/music-folder")
        .then((r) => (r.ok ? r.json() : []))
        .then((list: { name: string; url: string }[]) => {
          if (!Array.isArray(list) || list.length === 0) return;
          const songs: Song[] = list.map((f) => {
            const base = f.name.replace(/\.[^.]+$/, "");
            const parts = base.split("-");
            const isPair = parts.length > 1 && base.includes("-");
            const artist = isPair ? parts[0].trim() : "本地音乐";
            let title = isPair ? parts.slice(1).join("-").trim() : base;
            // 去掉文件名里网易云歌曲 ID，如 (12345678) / [12345678]，保证云端歌词匹配
            title = title.replace(/[\(\[]?\d{7,9}[\)\]]?/g, "").trim();
            return {
              id: `music-${f.url}`,
              title: title || f.name,
              artist,
              fileUrl: f.url,
              needsLyricsMatch: true,
            } as Song;
          });
          playlist.addMusicFolderSongs(songs);
        })
        .catch(() => {
          /* 静默 */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicScanEnabled, playlist.addMusicFolderSongs]);

  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [activePanel, setActivePanel] = useState<"controls" | "lyrics">(
    "controls",
  );
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const mobileViewportRef = useRef<HTMLDivElement>(null);
  const [paneWidth, setPaneWidth] = useState(() => {
    if (typeof window === "undefined") return 0;
    return window.innerWidth;
  });



  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 1024px)");
    const updateLayout = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsMobileLayout(event.matches);
    };
    updateLayout(query);
    query.addEventListener("change", updateLayout);
    return () => query.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    if (!isMobileLayout) {
      setActivePanel("controls");
      setTouchStartX(null);
      setDragOffsetX(0);
    }
  }, [isMobileLayout]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateWidth = () => {
      setPaneWidth(window.innerWidth);
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    window.visualViewport?.addEventListener("resize", updateWidth);
    return () => {
      window.removeEventListener("resize", updateWidth);
      window.visualViewport?.removeEventListener("resize", updateWidth);
    };
  }, [isMobileLayout]);

  // Global Keyboard Registry Initialization
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyboardRegistry.handle(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Global Search Shortcut (Registered directly via useEffect for simplicity, or could use useKeyboardScope with high priority)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 音频加载失败时给出准确中文提示
  useEffect(() => {
    if (audioError) {
      toast.error(audioError);
    }
  }, [audioError]);

  const handleFileChange = async (files: FileList) => {
    const wasEmpty = playlist.queue.length === 0;
    const addedSongs = await playlist.addLocalFiles(files);
    if (addedSongs.length > 0) {
      setTimeout(() => {
        handlePlaylistAddition(addedSongs, wasEmpty);
      }, 0);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.types.includes("Files")) {
      setIsDragOver(true);
    }
  }, []);

  // 切换 music 文件夹自动扫描（默认开启）
  const toggleMusicScan = useCallback(() => {
    setMusicScanEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MUSIC_SCAN_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  // 打开浏览器下载新版本
  const openUpdatePage = useCallback(() => {
    if (updateInfo?.download_url) {
      window.open(updateInfo.download_url, "_blank", "noopener");
    }
  }, [updateInfo]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      // 只处理音频/歌词文件
      const audioFiles = Array.from(files).filter(
        (f) =>
          f.type.startsWith("audio/") ||
          f.name.endsWith(".lrc") ||
          f.name.endsWith(".txt"),
      );
      if (audioFiles.length > 0) {
        const dt = new DataTransfer();
        audioFiles.forEach((f) => dt.items.add(f));
        handleFileChange(dt.files);
        toast.success(`添加 ${audioFiles.length} 个文件`);
      } else {
        toast.error("拖入的文件不支持");
      }
    }
  }, [toast]);

  const handleImportUrl = async (input: string): Promise<boolean> => {
    const trimmed = input.trim();
    if (!trimmed) return false;
    const wasEmpty = playlist.queue.length === 0;
    const result = await playlist.importFromUrl(trimmed);
    if (!result.success) {
      toast.error(result.message ?? "Failed to load songs from URL");
      return false;
    }
    if (result.songs.length > 0) {
      setTimeout(() => {
        handlePlaylistAddition(result.songs, wasEmpty);
      }, 0);
      toast.success(`成功导入 ${result.songs.length} 首歌曲`);
      return true;
    }
    return false;
  };

  const handleImportAndPlay = (song: Song) => {
    // Check if song already exists in queue (by neteaseId for cloud songs, or by id)
    const existingIndex = playlist.queue.findIndex((s) => {
      if (song.isNetease && s.isNetease) {
        return s.neteaseId === song.neteaseId;
      }
      return s.id === song.id;
    });

    if (existingIndex !== -1) {
      // Song already in queue, just play it
      playIndex(existingIndex);
    } else {
      // Add and play atomically - no race conditions!
      addSongAndPlay(song);
    }
  };

  const handleAddToQueue = (song: Song) => {
    playlist.setQueue((prev) => [...prev, song]);
    playlist.setOriginalQueue((prev) => [...prev, song]);
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileLayout) return;
    setTouchStartX(event.touches[0]?.clientX ?? null);
    setDragOffsetX(0);
    setIsDragging(true);
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileLayout || touchStartX === null) return;
    const currentX = event.touches[0]?.clientX;
    if (currentX === undefined) return;
    const deltaX = currentX - touchStartX;
    const containerWidth = event.currentTarget.getBoundingClientRect().width;
    const limitedDelta = Math.max(
      Math.min(deltaX, containerWidth),
      -containerWidth,
    );
    setDragOffsetX(limitedDelta);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileLayout || touchStartX === null) return;
    const endX = event.changedTouches[0]?.clientX;
    if (endX === undefined) {
      setTouchStartX(null);
      setDragOffsetX(0);
      setIsDragging(false);
      return;
    }
    const deltaX = endX - touchStartX;
    const threshold = 60;
    if (deltaX > threshold) {
      setActivePanel("controls");
    } else if (deltaX < -threshold) {
      setActivePanel("lyrics");
    }
    setTouchStartX(null);
    setDragOffsetX(0);
    setIsDragging(false);
  };

  const handleTouchCancel = () => {
    if (isMobileLayout) {
      setTouchStartX(null);
      setDragOffsetX(0);
      setIsDragging(false);
    }
  };

  const toggleIndicator = () => {
    setActivePanel((prev) => (prev === "controls" ? "lyrics" : "controls"));
    setDragOffsetX(0);
    setIsDragging(false);
  };

  const controlsSection = (
    <div className="flex flex-col items-center justify-center w-full h-full z-30 relative p-4">
      <div className="relative flex flex-col items-center gap-8 w-full max-w-[360px]">
        <Controls
          isPlaying={playState === PlayState.PLAYING}
          onPlayPause={togglePlay}
          currentTime={currentTime}
          duration={duration}
          onSeek={handleSeek}
          title={currentSong?.title || "欢迎使用"}
          artist={currentSong?.artist || "请选择歌曲"}
          audioRef={audioRef}
          onNext={playNext}
          onPrev={playPrev}
          playMode={playMode}
          onToggleMode={toggleMode}
          onTogglePlaylist={() => setShowPlaylist(true)}
          accentColor={accentColor}
          coverUrl={currentSong?.coverUrl}
          isBuffering={isBuffering}
          onSearchClick={() => setShowSearch(true)}
          onUploadClick={() => fileInputRef.current?.click()}
        />

        {/* Floating Playlist Panel */}
        <PlaylistPanel
          isOpen={showPlaylist}
          onClose={() => setShowPlaylist(false)}
          queue={playlist.queue}
          currentSongId={currentSong?.id}
          onPlay={playIndex}
          onImport={handleImportUrl}
          onRemove={playlist.removeSongs}
          accentColor={accentColor}
          musicScanEnabled={musicScanEnabled}
          onToggleMusicScan={toggleMusicScan}
        />
      </div>
    </div>
  );

  const lyricsVersion = currentSong?.lyrics ? currentSong.lyrics.length : 0;
  const lyricsKey = currentSong ? `${currentSong.id}-${lyricsVersion}` : "no-song";
  const hasLyrics = (currentSong?.lyrics?.length ?? 0) > 0;

  const lyricsSection = (
    <div className="w-full h-full relative z-20 flex flex-col justify-center px-4 lg:pl-12">
      {currentSong ? (
        hasLyrics ? (
          <LyricsView
            key={lyricsKey}
            lyrics={currentSong?.lyrics || []}
            audioRef={audioRef}
            isPlaying={playState === PlayState.PLAYING}
            currentTime={currentTime}
            onSeekRequest={handleSeek}
            matchStatus={matchStatus}
          />
        ) : (
          <FullscreenPlayer
            coverUrl={currentSong?.coverUrl}
            title={currentSong?.title || ""}
            artist={currentSong?.artist || ""}
            accentColor={accentColor}
            isPlaying={playState === PlayState.PLAYING}
          />
        )
      ) : null}
    </div>
  );

  const fallbackWidth = typeof window !== "undefined" ? window.innerWidth : 0;
  const effectivePaneWidth = paneWidth || fallbackWidth;
  const baseOffset = activePanel === "lyrics" ? -effectivePaneWidth : 0;
  const mobileTranslate = baseOffset + dragOffsetX;

  return (
    <div
      className="relative w-full h-screen flex flex-col overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <FluidBackground
        key={isMobileLayout ? "mobile" : "desktop"}
        colors={currentSong?.colors || []}
        coverUrl={currentSong?.coverUrl}
        isPlaying={playState === PlayState.PLAYING}
        isMobileLayout={isMobileLayout}
      />

      {/* 发现新版本横幅（非强制） */}
      {updateInfo && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-[90] flex items-center gap-3 px-4 py-2 rounded-full bg-black/70 backdrop-blur-xl border border-white/15 shadow-lg cursor-pointer hover:bg-black/80 transition-colors"
          onClick={openUpdatePage}
          title="打开下载页"
        >
          <span className="text-yellow-300 text-sm">发现新版本 v{updateInfo.latest}</span>
          <span className="text-white/60 text-xs">点击下载</span>
        </div>
      )}

      {/* 拖拽 overlay */}
      {isDragOver && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
          <div className="px-10 py-16 rounded-2xl border-2 border-dashed border-white/40 bg-white/5 text-center">
            <div className="text-5xl mb-4">📁</div>
            <div className="text-xl font-semibold text-white">松开添加音乐</div>
            <div className="text-sm text-white/60 mt-1">支持拖入 .mp3 .flac .wav .lrc 等</div>
          </div>
        </div>
      )}

      {/* 全局隐藏的文件选择器（顶栏和 Controls 底部按钮都用它） */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            handleFileChange(files);
          }
          e.target.value = "";
        }}
        accept="audio/*,.lrc,.txt"
        multiple
        className="hidden"
      />

      <audio
        ref={audioRef}
        src={resolvedAudioSrc ?? currentSong?.fileUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleAudioEnded}
        crossOrigin="anonymous"
      />

      <KeyboardShortcuts
        isPlaying={playState === PlayState.PLAYING}
        onPlayPause={togglePlay}
        onNext={playNext}
        onPrev={playPrev}
        onSeek={handleSeek}
        currentTime={currentTime}
        duration={duration}
        onToggleMode={toggleMode}
        onTogglePlaylist={() => setShowPlaylist((prev) => !prev)}
      />

      <MediaSessionController
        currentSong={currentSong ?? null}
        playState={playState}
        currentTime={currentTime}
        duration={duration}
        playbackRate={player.speed}
        onPlay={play}
        onPause={pause}
        onNext={playNext}
        onPrev={playPrev}
        onSeek={handleSeek}
      />

      {/* Search Modal - Always rendered to preserve state, visibility handled internally */}
      <SearchModal
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
        queue={playlist.queue}
        onPlayQueueIndex={playIndex}
        onImportAndPlay={handleImportAndPlay}
        onAddToQueue={handleAddToQueue}
        currentSong={currentSong}
        isPlaying={playState === PlayState.PLAYING}
        accentColor={accentColor}
      />

      {/* Main Content Split */}
      {isMobileLayout ? (
        <div className="flex-1 relative w-full h-full">
          <div
            ref={mobileViewportRef}
            className="w-full h-full overflow-hidden"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
          >
            <div
              className={`flex h-full ${isDragging ? "transition-none" : "transition-transform duration-300"}`}
              style={{
                width: `${effectivePaneWidth * 2}px`,
                transform: `translateX(${mobileTranslate}px)`,
              }}
            >
              <div
                className="flex-none h-full"
                style={{ width: effectivePaneWidth }}
              >
                {controlsSection}
              </div>
              <div
                className="flex-none h-full"
                style={{ width: effectivePaneWidth }}
              >
                {lyricsSection}
              </div>
            </div>
          </div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4">
            <div
              className={`h-4 rounded-full bg-white/25 backdrop-blur-[30px] transition-all duration-300 ease-in-out cursor-pointer ${activePanel === "controls" ? "w-12" : "w-4"}`}
              onClick={() => setActivePanel("controls")}
            />
            <div
              className={`h-4 rounded-full bg-white/25 backdrop-blur-[30px] transition-all duration-300 ease-in-out cursor-pointer ${activePanel === "lyrics" ? "w-12" : "w-4"}`}
              onClick={() => setActivePanel("lyrics")}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 grid lg:grid-cols-2 w-full h-full">
          {controlsSection}
          {lyricsSection}
        </div>
      )}

      {/* 启动欢迎页 */}
      {showSplash && <SplashScreen onDismiss={() => setShowSplash(false)} />}
    </div>
  );
};

export default App;
