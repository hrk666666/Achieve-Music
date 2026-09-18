// 本地音乐 API（Vite 中间件，数据不出境，直连国内音乐平台）
const API_BASE = "/api/music";

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
}

export interface NeteaseTrackInfo extends TrackInfo {
  isNetease: true;
  neteaseId: string;
}

type SearchOptions = {
  limit?: number;
  offset?: number;
};

// 从本地 API 获取数据
async function fetchApi(params: Record<string, string>): Promise<any> {
  const url = new URL(API_BASE, window.location.origin);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await fetch(url.toString());
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API 请求失败: ${response.status}`);
  }
  return response.json();
}

// 将 Meting 返回格式转为 TrackInfo
function mapMetingToTrack(song: MetingSong, platform: string): TrackInfo {
  const id = song.id || song.url_id;
  return {
    id: `${platform}-${id}`,
    title: song.name?.trim() ?? "",
    artist: song.artist?.trim() ?? "",
    album: song.album?.trim() ?? "",
    coverUrl: song.pic_id ? `${API_BASE}?server=${platform}&type=pic&id=${song.pic_id}` : undefined,
    duration: song.duration,
    platform,
    platformId: id,
    isNetease: platform === "netease",
    neteaseId: platform === "netease" ? id : undefined,
  };
}

// 获取音频播放地址（直接作为 audio src，302 重定向到真实音频）
export function getAudioUrl(platform: string, id: string): string {
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
    return songs.map((s) => mapMetingToTrack(s, "netease") as NeteaseTrackInfo);
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

// 歌词匹配（用于本地文件自动匹配歌词）
export async function searchAndMatchLyrics(
  title: string,
  artist: string,
): Promise<{ lrc: string; yrc?: string; tLrc?: string; metadata: string[] } | null> {
  try {
    const songs = await searchNetEase(`${title} ${artist}`, { limit: 5 });
    if (songs.length === 0) return null;

    const song = songs[0];
    const songId = song.platformId;
    if (!songId) return null;

    return await fetchLyricsById(songId, song.platform);
  } catch (error) {
    return null;
  }
}

// 过滤网易云 LRC 开头的歌曲元数据行（作词/作曲/编曲等），避免显示为歌词
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

    // 清洗歌词：去掉空行和歌曲元数据行
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
