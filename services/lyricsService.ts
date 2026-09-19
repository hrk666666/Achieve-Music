// 本地音乐 API（Vite 中间件，数据不出境，直连国内音乐平台）
const API_BASE = "/api/music";

// Pages 环境检测：无 Rust 后端，直连 meting API（meting 已允许 CORS）
const IS_PAGES = window.location.hostname.includes("github.io");
const METING_BASE = "https://api.i-meto.com/meting/api";

// Meting 统一返回格式
interface MetingSong {
  id: string;
  name: string;
  artist: string;
  album: string;
  pic_id: string;
  lyric_id: string;
  url_id: string;
  duration?: number;
  // Pages 环境：直接可用的完整 URL（带 auth 签名）
  _coverUrl?: string;
  _audioUrl?: string;
  _lrcUrl?: string;
  platform?: string;
}

// 统一 Track 接口
export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl?: string;
  duration?: number;
  platform: string;
  platformId: string;
  isNetease?: boolean;
  neteaseId?: string;
  audioUrl?: string;
  lrcUrl?: string;
}

export interface NeteaseTrackInfo extends TrackInfo {
  isNetease: true;
  neteaseId: string;
}

type SearchOptions = {
  limit?: number;
  offset?: number;
};

// 从 meting URL 中提取 id 参数
function extractMetingId(url: string): string {
  const m = url.match(/[?&]id=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

// 把 Meting2 返回的 {title,author,url,pic,lrc} 转成内部格式
function convertMeting2(item: any, platform: string): MetingSong | null {
  const songId = extractMetingId(item.url || "");
  if (!songId || songId === "undefined") return null;
  if (!item.title && !item.author) return null;
  return {
    id: songId,
    name: item.title || "",
    artist: item.author || "",
    album: "",
    pic_id: extractMetingId(item.pic || "") || songId,
    lyric_id: extractMetingId(item.lrc || "") || songId,
    url_id: songId,
    duration: 0,
    _coverUrl: item.pic || "",
    _audioUrl: item.url || "",
    _lrcUrl: item.lrc || "",
    platform,
  };
}

// 从本地 API 获取数据（桌面版走 Rust 代理，Pages 版直连 meting）
async function fetchApi(params: Record<string, string>): Promise<any> {
  const { server, type, id } = params;

  // 桌面版：走本地 Rust 代理
  if (!IS_PAGES) {
    const url = new URL(API_BASE, window.location.origin);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const response = await fetch(url.toString());
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `API 请求失败: ${response.status}`);
    }
    return response.json();
  }

  // Pages 版：直接调 meting
  if (type === "search") {
    // 多平台并行搜索
    const platforms = ["netease", "tencent", "kugou", "kuwo"];
    const results = await Promise.all(
      platforms.map(async (p) => {
        const url = `${METING_BASE}?server=${p}&type=search&id=${encodeURIComponent(id)}`;
        try {
          const resp = await fetch(url);
          const arr = await resp.json();
          return (Array.isArray(arr) ? arr : [])
            .slice(0, 8)
            .map((item) => convertMeting2(item, p))
            .filter(Boolean) as MetingSong[];
        } catch {
          return [];
        }
      })
    );
    return results.flat();
  }

  if (type === "lrc") {
    const url = `${METING_BASE}?server=${server}&type=lrc&id=${encodeURIComponent(id)}`;
    const resp = await fetch(url);
    const text = await resp.text();
    return { lyric: text, tlyric: "" };
  }

  // pic / url 不需要走这里（搜索结果已带完整 URL）
  return null;
}

// 将 Meting 返回格式转为 TrackInfo
function mapMetingToTrack(song: MetingSong, platform: string): TrackInfo {
  const id = song.id || song.url_id;
  // Pages 版直接用 meting 返回的完整封面 URL；桌面版走本地代理
  const coverUrl = IS_PAGES
    ? song._coverUrl || undefined
    : song.pic_id
    ? `${API_BASE}?server=${platform}&type=pic&id=${song.pic_id}`
    : undefined;
  return {
    id: `${platform}-${id}`,
    title: song.name?.trim() ?? "",
    artist: song.artist?.trim() ?? "",
    album: song.album?.trim() ?? "",
    coverUrl,
    duration: song.duration,
    platform,
    platformId: id,
    isNetease: platform === "netease",
    neteaseId: platform === "netease" ? id : undefined,
    audioUrl: IS_PAGES ? song._audioUrl || undefined : undefined,
    lrcUrl: IS_PAGES ? song._lrcUrl || undefined : undefined,
  };
}

// 获取音频播放地址
export function getAudioUrl(platform: string, id: string): string {
  if (IS_PAGES) {
    return `${METING_BASE}?server=${platform}&type=url&id=${encodeURIComponent(id)}`;
  }
  return `${API_BASE}?server=${platform}&type=url&id=${id}`;
}

// 兼容旧接口
export function getNeteaseAudioUrl(id: string): string {
  return getAudioUrl("netease", id);
}

// 搜索
export async function searchNetEase(
  keyword: string,
  _options: SearchOptions = {},
): Promise<NeteaseTrackInfo[]> {
  try {
    const songs: MetingSong[] = await fetchApi({
      server: "netease",
      type: "search",
      id: keyword,
    });
    return songs.map((s) => mapMetingToTrack(s, s.platform || "netease") as NeteaseTrackInfo);
  } catch (error) {
    return [];
  }
}

// 获取歌单
export async function fetchNeteasePlaylist(
  playlistId: string,
): Promise<NeteaseTrackInfo[]> {
  try {
    const songs: MetingSong[] = await fetchApi({
      server: "netease",
      type: "playlist",
      id: playlistId,
    });
    return songs.map((s) => mapMetingToTrack(s, "netease") as NeteaseTrackInfo);
  } catch (e) {
    return [];
  }
}

// 获取单曲详情
export async function fetchNeteaseSong(
  songId: string,
): Promise<NeteaseTrackInfo | null> {
  try {
    const song: MetingSong = await fetchApi({
      server: "netease",
      type: "song",
      id: songId,
    });
    if (!song?.id) return null;
    return mapMetingToTrack(song, "netease") as NeteaseTrackInfo;
  } catch (e) {
    return null;
  }
}

// 从任意平台获取歌曲/歌单
export async function fetchTracksFromPlatform(
  platform: string,
  type: "song" | "playlist",
  id: string,
): Promise<TrackInfo[]> {
  try {
    const songs: MetingSong[] = await fetchApi({
      server: platform,
      type,
      id,
    });
    return songs.map((s) => mapMetingToTrack(s, platform));
  } catch (err) {
    throw new Error(`无法从 ${platform} 获取${type === "playlist" ? "歌单" : "歌曲"}`);
  }
}

// 歌词匹配（用于本地文件自动匹配歌词）：遍历多平台搜索结果依次取歌词
export async function searchAndMatchLyrics(
  title: string,
  artist: string,
): Promise<{ lrc: string; yrc?: string; tLrc?: string; metadata: string[] } | null> {
  try {
    const songs = await searchNetEase(`${title} ${artist}`, { limit: 8 });
    if (songs.length === 0) return null;

    for (const song of songs.slice(0, 8)) {
      if (!song.platformId) continue;
      // Pages 版：直接用搜索结果里带 auth 的 lrc URL
      if (IS_PAGES && (song as any).lrcUrl) {
        try {
          const resp = await fetch((song as any).lrcUrl);
          const text = await resp.text();
          if (text && text.trim()) {
            return { lrc: text, tLrc: undefined, metadata: [] };
          }
        } catch { /* 继续试下一个 */ }
      }
      const result = await fetchLyricsById(song.platformId, song.platform);
      if (result && result.lrc && result.lrc.trim()) {
        return result;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

// 过滤 LRC 开头的歌曲元数据行
const METADATA_LINE = /^\[\d{2}:\d{2}[.:]\d{2,3}\]\s*(作曲|作词|编曲|制作人|制作|改编|OP|SP|词曲)(\s*[:：]|$)/;

// 获取歌词
export async function fetchLyricsById(
  songId: string,
  platform: string = "netease",
): Promise<{ lrc: string; yrc?: string; tLrc?: string; metadata: string[] } | null> {
  try {
    const data = await fetchApi({
      server: platform,
      type: "lrc",
      id: songId,
    });

    const rawLrc = data?.lyric;
    const rawTlyric = data?.tlyric;

    if (!rawLrc) return null;

    const cleanLrc = rawLrc
      .split("\n")
      .filter((line: string) => {
        const trimmed = line.trim();
        return trimmed !== "" && !METADATA_LINE.test(trimmed);
      })
      .join("\n");

    if (!cleanLrc.trim()) return null;

    let cleanTlyric: string | undefined;
    if (rawTlyric) {
      const filtered = rawTlyric
        .split("\n")
        .filter((line: string) => {
          const trimmed = line.trim();
          return trimmed !== "" && !METADATA_LINE.test(trimmed);
        })
        .join("\n");
      if (filtered.trim()) cleanTlyric = filtered;
    }

    return {
      lrc: cleanLrc,
      tLrc: cleanTlyric,
      metadata: [],
    };
  } catch (e) {
    return null;
  }
}
