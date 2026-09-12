import { fetchViaProxy } from "./utils";

// API Configuration
const LYRIC_API_BASE = "https://163api.qijieya.cn";
const METING_API = "https://api.qijieya.cn/meting/";
const NETEASE_SEARCH_API = "https://163api.qijieya.cn/cloudsearch";
const NETEASE_API_BASE = "http://music.163.com/api";
const NETEASECLOUD_API_BASE = "https://163api.qijieya.cn";

// Meting API Configuration
const METING_CONFIG = {
  // Primary API (working one first)
  api: "https://api.injahow.cn/meting/?server=:server&type=:type&id=:id",
  // Fallback APIs
  fallbackApis: [
    "https://api.moeyao.cn/meting/?server=:server&type=:type&id=:id",
    "https://api.qijieya.cn/meting/?type=:type&id=:id&server=:server",
    "https://api.i-meto.com/meting/api?server=:server&type=:type&id=:id" // This one had 500 errors
  ]
};

const METADATA_KEYWORDS = [
  "歌词贡献者",
  "翻译贡献者",
  "作词",
  "作曲",
  "编曲",
  "制作",
  "词曲",
  "词 / 曲",
  "lyricist",
  "composer",
  "arrange",
  "translation",
  "translator",
  "producer",
];

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const metadataKeywordRegex = new RegExp(
  `^(${METADATA_KEYWORDS.map(escapeRegex).join("|")})\\s*[:：]`,
  "iu",
);

const TIMESTAMP_REGEX = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/;

interface NeteaseApiArtist {
  name?: string;
}

interface NeteaseApiAlbum {
  name?: string;
  picUrl?: string;
}

interface NeteaseApiSong {
  id: number;
  name?: string;
  ar?: NeteaseApiArtist[];
  al?: NeteaseApiAlbum;
  dt?: number;
}

interface NeteaseSearchResponse {
  result?: {
    songs?: NeteaseApiSong[];
  };
}

interface NeteasePlaylistResponse {
  songs?: NeteaseApiSong[];
}

interface NeteaseSongDetailResponse {
  code?: number;
  songs?: NeteaseApiSong[];
}

// Base track interface supporting multiple platforms
export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl?: string;
  duration?: number;
  platform: string; // netease, tencent, baidu, kugou, xiami
  platformId: string;
  isNetease?: boolean;
  neteaseId?: string;
}

// Backward compatibility
export interface NeteaseTrackInfo extends TrackInfo {
  isNetease: true;
  neteaseId: string;
}

type SearchOptions = {
  limit?: number;
  offset?: number;
};

const formatArtists = (artists?: NeteaseApiArtist[]) =>
  (artists ?? [])
    .map((artist) => artist.name?.trim())
    .filter(Boolean)
    .join("/") || "";

const mapNeteaseSongToTrack = (song: NeteaseApiSong): NeteaseTrackInfo => ({
  id: song.id.toString(),
  title: song.name?.trim() ?? "",
  artist: formatArtists(song.ar),
  album: song.al?.name?.trim() ?? "",
  coverUrl: song.al?.picUrl?.replaceAll("http:", "https:"),
  duration: song.dt,
  platform: "netease",
  platformId: song.id.toString(),
  isNetease: true,
  neteaseId: song.id.toString(),
});

// Map Meting API song data to TrackInfo
const mapMetingSongToTrack = (song: any, platform: string): TrackInfo => {
  // Extract song ID from URL if not directly available
  let songId = song.id;
  if (!songId && song.url) {
    // Extract from URL like: https://api.injahow.cn/meting/?server=tencent&type=url&id=004f2Iol3CAo01
    const url = new URL(song.url);
    const params = new URLSearchParams(url.search);
    songId = params.get('id') || '';
  }
  
  // Get cover URL and enhance for QQ Music if needed
  let coverUrl = (song.pic_url || song.pic)?.replaceAll("http:", "https:");
  
  // For QQ Music, enhance cover URL to get higher quality images
  if (platform === "tencent" && coverUrl) {
    try {
      // Check if it's already a direct y.gtimg.cn URL
      if (coverUrl.includes("y.gtimg.cn")) {
        // Extract albumMid from the URL
        const url = new URL(coverUrl);
        const pathParts = url.pathname.split("/");
        const filename = pathParts[pathParts.length - 1];
        const albumMidMatch = filename.match(/T002R\d+x\d+M000(\w+)\.jpg/);
        
        if (albumMidMatch && albumMidMatch[1]) {
          const albumMid = albumMidMatch[1];
          // Use higher quality (300x300) instead of default 90x90
          coverUrl = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`;
        }
      } else if (coverUrl.includes("meting")) {
        // For Meting API proxy URLs, extract the albumId and construct direct URL
        const url = new URL(coverUrl);
        const params = new URLSearchParams(url.search);
        const albumId = params.get('id');
        
        if (albumId) {
          // Use the albumId directly for QQ Music
          coverUrl = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumId}.jpg`;
        }
      }
    } catch (error) {
      // Fall back to original URL if enhancement fails
    }
  }

  return {
    id: `${platform}-${songId || Date.now()}`,
    title: song.name?.trim() ?? "",
    artist: Array.isArray(song.artist) ? song.artist.join("/") : (song.artist?.trim() ?? ""),
    album: song.album?.trim() ?? "",
    coverUrl: coverUrl,
    duration: song.duration,
    platform: platform,
    platformId: songId || '',
    isNetease: platform === "netease",
    neteaseId: platform === "netease" ? songId?.toString() : undefined,
  };
};

// Fetch from Meting API with fallback support
const fetchMetingApi = async (platform: string, type: string, id: string): Promise<any> => {
  // Prepare URLs with placeholders replaced
  const urls = [
    METING_CONFIG.api
      .replace(":server", platform)
      .replace(":type", type)
      .replace(":id", id),
    ...METING_CONFIG.fallbackApis.map(api => 
      api.replace(":server", platform)
         .replace(":type", type)
         .replace(":id", id)
    )
  ];

  // Try each URL until one succeeds
  for (const url of urls) {
    try {
      const data = await fetchViaProxy(url);
      if (data && (Array.isArray(data) || (data.songs && Array.isArray(data.songs)))) {
        return data;
      }
    } catch (error) {
      // Continue to next fallback
    }
  }

  throw new Error("All Meting API attempts failed");
};

// Fetch tracks from any platform using Meting API
export const fetchTracksFromPlatform = async (
  platform: string,
  type: "song" | "playlist",
  id: string
): Promise<TrackInfo[]> => {
  const data = await fetchMetingApi(platform, type, id);
  const songs = Array.isArray(data) ? data : data.songs || [];
  
  if (songs.length === 0) {
    throw new Error(`No songs found in ${platform} ${type}`);
  }

  return songs.map(song => mapMetingSongToTrack(song, platform));
};

// Get audio URL for any platform
export const getAudioUrl = (platform: string, id: string): string => {
  // For Netease, use existing API
  if (platform === "netease") {
    return getNeteaseAudioUrl(id);
  }
  // For other platforms, use primary Meting API URL pattern
  const primaryApi = METING_CONFIG.api.replace(":server", platform).replace(":type", "url").replace(":id", id);
  return primaryApi;
};

const isMetadataTimestampLine = (line: string): boolean => {
  const trimmed = line.trim();
  const match = trimmed.match(TIMESTAMP_REGEX);
  if (!match) return false;
  const content = match[4].trim();
  return metadataKeywordRegex.test(content);
};

const parseTimestampMetadata = (line: string) => {
  const match = line.trim().match(TIMESTAMP_REGEX);
  return match ? match[4].trim() : line.trim();
};

const isMetadataJsonLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    const json = JSON.parse(trimmed);
    if (json.c && Array.isArray(json.c)) {
      const content = json.c.map((item: any) => item.tx || "").join("");
      return metadataKeywordRegex.test(content);
    }
  } catch {
    // ignore invalid json
  }
  return false;
};

const parseJsonMetadata = (line: string) => {
  try {
    const json = JSON.parse(line.trim());
    if (json.c && Array.isArray(json.c)) {
      return json.c
        .map((item: any) => item.tx || "")
        .join("")
        .trim();
    }
  } catch {
    // ignore
  }
  return line.trim();
};

const extractMetadataLines = (content: string) => {
  const metadataSet = new Set<string>();
  const bodyLines: string[] = [];

  content.split("\n").forEach((line) => {
    if (!line.trim()) return;
    if (isMetadataTimestampLine(line)) {
      metadataSet.add(parseTimestampMetadata(line));
    } else if (isMetadataJsonLine(line)) {
      metadataSet.add(parseJsonMetadata(line));
    } else {
      bodyLines.push(line);
    }
  });

  return {
    clean: bodyLines.join("\n").trim(),
    metadata: Array.from(metadataSet),
  };
};

export const getNeteaseAudioUrl = (id: string) => {
  return `${METING_API}?type=url&id=${id}`;
};

// Implements the search logic from the user provided code snippet
export const searchNetEase = async (
  keyword: string,
  options: SearchOptions = {},
): Promise<NeteaseTrackInfo[]> => {
  const { limit = 20, offset = 0 } = options;
  const searchApiUrl = `${NETEASE_SEARCH_API}?keywords=${encodeURIComponent(
    keyword,
  )}&limit=${limit}&offset=${offset}`;

  try {
    const parsedSearchApiResponse = (await fetchViaProxy(
      searchApiUrl,
    )) as NeteaseSearchResponse;
    const songs = parsedSearchApiResponse.result?.songs ?? [];

    if (songs.length === 0) {
      return [];
    }

    return songs.map(mapNeteaseSongToTrack);
  } catch (error) {
    return [];
  }
};

export const fetchNeteasePlaylist = async (
  playlistId: string,
): Promise<NeteaseTrackInfo[]> => {
  try {
    // 使用網易雲音樂 API 獲取歌單所有歌曲
    // 由於接口限制，需要分頁獲取，每次獲取 50 首
    const allTracks: NeteaseTrackInfo[] = [];
    const limit = 50;
    let offset = 0;
    let shouldContinue = true;

    while (shouldContinue) {
      const url = `${NETEASECLOUD_API_BASE}/playlist/track/all?id=${playlistId}&limit=${limit}&offset=${offset}`;
      const data = (await fetchViaProxy(url)) as NeteasePlaylistResponse;
      const songs = data.songs ?? [];
      if (songs.length === 0) {
        break;
      }

      const tracks = songs.map(mapNeteaseSongToTrack);

      allTracks.push(...tracks);

      // Continue fetching if the current page was full
      if (songs.length < limit) {
        shouldContinue = false;
      } else {
        offset += limit;
      }
    }

    return allTracks;
  } catch (e) {
    return [];
  }
};

export const fetchNeteaseSong = async (
  songId: string,
): Promise<NeteaseTrackInfo | null> => {
  try {
    const url = `${NETEASECLOUD_API_BASE}/song/detail?ids=${songId}`;
    const data = (await fetchViaProxy(
      url,
    )) as NeteaseSongDetailResponse;
    const track = data.songs?.[0];
    if (data.code === 200 && track) {
      return mapNeteaseSongToTrack(track);
    }
    return null;
  } catch (e) {
    return null;
  }
};

// Keeps the old search for lyric matching fallbacks
export const searchAndMatchLyrics = async (
  title: string,
  artist: string,
): Promise<{ lrc: string; yrc?: string; tLrc?: string; metadata: string[] } | null> => {
  try {
    const songs = await searchNetEase(`${title} ${artist}`, { limit: 5 });

    if (songs.length === 0) {
      return null;
    }

    const songId = songs[0].id;

    const lyricsResult = await fetchLyricsById(songId);
    return lyricsResult;
  } catch (error) {
    return null;
  }
};

export const fetchLyricsById = async (
  songId: string,
): Promise<{ lrc: string; yrc?: string; tLrc?: string; metadata: string[] } | null> => {
  try {
    // 使用網易雲音樂 API 獲取歌詞
    const lyricUrl = `${NETEASECLOUD_API_BASE}/lyric/new?id=${songId}`;
    const lyricData = await fetchViaProxy(lyricUrl);

    const rawYrc = lyricData.yrc?.lyric;
    const rawLrc = lyricData.lrc?.lyric;
    const tLrc = lyricData.tlyric?.lyric;

    if (!rawYrc && !rawLrc) return null;

    const {
      clean: cleanLrc,
      metadata: lrcMetadata,
    } = rawLrc
        ? extractMetadataLines(rawLrc)
        : { clean: undefined, metadata: [] };

    const {
      clean: cleanYrc,
      metadata: yrcMetadata,
    } = rawYrc
        ? extractMetadataLines(rawYrc)
        : { clean: undefined, metadata: [] };

    // Extract metadata from translation if available
    let cleanTranslation: string | undefined;
    let translationMetadata: string[] = [];
    if (tLrc) {
      const result = extractMetadataLines(tLrc);
      cleanTranslation = result.clean;
      translationMetadata = result.metadata;
    }

    const metadataSet = Array.from(
      new Set([...lrcMetadata, ...yrcMetadata, ...translationMetadata]),
    );

    if (lyricData.transUser?.nickname) {
      metadataSet.unshift(`翻译贡献者: ${lyricData.transUser.nickname}`);
    }

    if (lyricData.lyricUser?.nickname) {
      metadataSet.unshift(`歌词贡献者: ${lyricData.lyricUser.nickname}`);
    }

    const baseLyrics = cleanLrc || cleanYrc || rawLrc || rawYrc;
    if (!baseLyrics) return null;

    const yrcForEnrichment = cleanYrc && cleanLrc ? cleanYrc : undefined;
    return {
      lrc: baseLyrics,
      yrc: yrcForEnrichment,
      tLrc: cleanTranslation,
      metadata: Array.from(metadataSet),
    };
  } catch (e) {
    return null;
  }
};
