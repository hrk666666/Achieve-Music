import { LyricLine } from "../types";
import { parseLyrics } from "./lyrics";
import { loadImageElementWithCache } from "./cache";

// Declare global for the script loaded in index.html
declare const jsmediatags: any;
declare const ColorThief: any;

export const formatTime = (seconds: number): string => {
  if (isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export const shuffleArray = <T>(array: T[]): T[] => {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};

// Helper to fetch images（同源图片直连，无需代理）
export const fetchImageViaProxy = async (targetUrl: string): Promise<Blob> => {
  // Try direct request first (works for most cases)
  try {
    const response = await fetch(targetUrl, {
      mode: 'cors',
      cache: 'force-cache'
    });
    if (response.ok) {
      return await response.blob();
    }
  } catch (error) {

  }

  // Final fallback: Try with Image object and canvas
  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        return reject(new Error('Canvas context unavailable'));
      }
      
      ctx.drawImage(img, 0, 0);
      
      try {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Canvas to blob conversion failed')));
      } catch (securityError) {
        reject(new Error('Security error: Image is cross-origin restricted'));
      }
    };
    
    img.onerror = () => reject(new Error('Image loading failed'));
    img.src = targetUrl;
  });
};

export const parseMusicLink = (
  input: string,
): { platform: string; type: "song" | "playlist"; id: string } | null => {
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();
    const params = new URLSearchParams(url.search);
    let platform: string;
    let type: "song" | "playlist";
    let id: string | null = null;

    // Handle Netease Cloud Music (music.163.com)
    if (hostname.includes("163.com")) {
      platform = "netease";
      // Handle music.163.com/#/song?id=... (Hash router)
      if (url.hash.includes("/song") || url.hash.includes("/playlist")) {
        const hashParts = url.hash.split("?");
        if (hashParts.length > 1) {
          const hashParams = new URLSearchParams(hashParts[1]);
          id = hashParams.get("id");
          if (id) {
            type = url.hash.includes("/song") ? "song" : "playlist";
            return { platform, type, id };
          }
        }
      }
      // Handle standard params
      id = params.get("id");
      if (id) {
        type = url.pathname.includes("song") ? "song" : "playlist";
        return { platform, type, id };
      }
    }

    // Handle QQ Music (y.qq.com)
    else if (hostname.includes("y.qq.com")) {
      platform = "tencent";
      // QQ Music format: y.qq.com/n/ryqq/songDetail/003tRgFf0FCu2W
      // or y.qq.com/n/ryqq/playlist/8232463538
      if (url.pathname.includes("songDetail")) {
        type = "song";
        const pathParts = url.pathname.split("/");
        id = pathParts[pathParts.length - 1];
      } else if (url.pathname.includes("playlist")) {
        type = "playlist";
        const pathParts = url.pathname.split("/");
        id = pathParts[pathParts.length - 1];
      } else if (url.pathname.includes("song") || url.pathname.includes("album")) {
        // Alternative format: y.qq.com/song/001J2Hf64A2x9z
        type = "song";
        const pathParts = url.pathname.split("/");
        id = pathParts[pathParts.length - 1];
      }
      if (id) {
        return { platform, type, id };
      }
    }

    // Handle Baidu Music (music.baidu.com)
    else if (hostname.includes("music.baidu.com")) {
      platform = "baidu";
      // Baidu Music format: music.baidu.com/song/278744849
      // or music.baidu.com/playlist/123456789
      if (url.pathname.includes("/song/")) {
        type = "song";
        const pathParts = url.pathname.split("/");
        id = pathParts[pathParts.length - 1];
      } else if (url.pathname.includes("/playlist/")) {
        type = "playlist";
        const pathParts = url.pathname.split("/");
        id = pathParts[pathParts.length - 1];
      }
      if (id) {
        return { platform, type, id };
      }
    }

    // Handle Kugou Music (kugou.com)
    else if (hostname.includes("kugou.com")) {
      platform = "kugou";
      // Kugou format: song.kugou.com/song/#hash=ABC1234567890DEF
      if (url.hash.includes("hash=")) {
        type = "song";
        id = url.hash.split("hash=")[1].split("&")[0];
      } else if (url.pathname.includes("/share/")) {
        // Playlist format: kugou.com/share/playList/?id=123456789
        type = "playlist";
        id = params.get("id");
      }
      if (id) {
        return { platform, type, id };
      }
    }

    // Handle Xiami Music (xiami.com)
    else if (hostname.includes("xiami.com")) {
      platform = "xiami";
      // Xiami format: xiami.com/song/1775614683
      // or xiami.com/collect/123456789
      if (url.pathname.includes("/song/")) {
        type = "song";
        const pathParts = url.pathname.split("/");
        id = pathParts[pathParts.length - 1];
      } else if (url.pathname.includes("/collect/")) {
        type = "playlist";
        const pathParts = url.pathname.split("/");
        id = pathParts[pathParts.length - 1];
      }
      if (id) {
        return { platform, type, id };
      }
    }

    // Fallback for unsupported platforms or invalid URLs
    return null;
  } catch (e) {
    return null;
  }
};

// Keep backward compatibility
export const parseNeteaseLink = parseMusicLink;



// 完整解析 FLAC 容器：VORBIS_COMMENT (type=4) + PICTURE (type=6)
// 不依赖 jsmediatags，直接读二进制，保证 FLAC 封面和内嵌歌词都能取出
const parseFlacMetadata = async (
  file: File,
): Promise<{ title?: string; artist?: string; picture?: string; lyrics?: string }> => {
  try {
    const ab = await file.arrayBuffer();
    const dv = new DataView(ab);
    if (ab.byteLength < 4) return {};
    if (
      dv.getUint8(0) !== 0x66 || dv.getUint8(1) !== 0x4c ||
      dv.getUint8(2) !== 0x61 || dv.getUint8(3) !== 0x43
    ) return {};

    let offset = 4;
    const total = ab.byteLength;
    const decoder = new TextDecoder();
    const out: { title?: string; artist?: string; picture?: string; lyrics?: string } = {};

    const toBase64 = (bytes: Uint8Array) => {
      let bin = "";
      const len = bytes.length;
      for (let i = 0; i < len; i++) bin += String.fromCharCode(bytes[i]);
      return window.btoa(bin);
    };

    while (offset + 4 <= total) {
      const header = dv.getUint8(offset);
      const last = (header & 0x80) !== 0;
      const type = header & 0x7f;
      const length = dv.getUint32(offset, false) & 0xffffff;
      const blockStart = offset + 4;
      if (blockStart + length > total) break;

      if (type === 4) {
        // VORBIS_COMMENT
        let p = blockStart;
        const vendorLen = dv.getUint32(p, true);
        p += 4 + vendorLen;
        const comments = dv.getUint32(p, true);
        p += 4;
        for (let i = 0; i < comments && p + 4 <= total; i++) {
          const len = dv.getUint32(p, true);
          p += 4;
          if (p + len > total) break;
          const raw = decoder.decode(new Uint8Array(ab, p, len));
          p += len;
          const eq = raw.indexOf("=");
          if (eq > 0) {
            const k = raw.slice(0, eq).toUpperCase();
            const v = raw.slice(eq + 1);
            if (k === "TITLE") out.title = v;
            else if (k === "ARTIST") out.artist = v;
            else if (k === "LYRICS" || k === "LYRIC" || k === "UNSYNCEDLYRICS") out.lyrics = v;
          }
        }
      } else if (type === 6) {
        // METADATA_BLOCK_PICTURE —— 取第一张封面
        if (!out.picture) {
          let p = blockStart;
          p += 4; // picture type
          const mimeLen = dv.getUint32(p, false); p += 4;
          const mime = decoder.decode(new Uint8Array(ab, p, mimeLen)); p += mimeLen;
          const descLen = dv.getUint32(p, false); p += 4 + descLen;
          p += 16; // width, height, depth, colors used
          const dataLen = dv.getUint32(p, false); p += 4;
          if (p + dataLen <= total) {
            const b64 = toBase64(new Uint8Array(ab, p, dataLen));
            out.picture = `data:${mime.split(";")[0]};base64,${b64}`;
          }
        }
      }

      offset = blockStart + length;
      if (last) break;
    }
    return out;
  } catch {
    return {};
  }
};

// Metadata Parser using jsmediatags (MP3/ID3v2); FLAC 走 parseFlacMetadata
export const parseAudioMetadata = (
  file: File,
): Promise<{
  title?: string;
  artist?: string;
  picture?: string;
  lyrics?: string;
}> => {
  return new Promise((resolve) => {
    // FLAC 文件直接用自写解析器，不依赖 jsmediatags
    if (file.type === "audio/flac" || /\.flac$/i.test(file.name || "")) {
      parseFlacMetadata(file).then(resolve).catch(() => resolve({}));
      return;
    }

    if (typeof jsmediatags === "undefined") {
      resolve({});
      return;
    }

    try {
      jsmediatags.read(file, {
        onSuccess: (tag: any) => {
          try {
            const tags = tag.tags;
            let pictureUrl = undefined;
            let lyricsText = undefined;

            if (tags.picture) {
              const { data, format } = tags.picture;
              let base64String = "";
              const len = data.length;
              for (let i = 0; i < len; i++) {
                base64String += String.fromCharCode(data[i]);
              }
              pictureUrl = `data:${format};base64,${window.btoa(base64String)}`;
            }

            if (tags.USLT) {
              lyricsText =
                typeof tags.USLT === "object"
                  ? tags.USLT.lyrics || tags.USLT.text
                  : tags.USLT;
            } else if (tags.lyrics) {
              lyricsText = tags.lyrics;
            } else if (tags.LYRICS) {
              lyricsText = tags.LYRICS;
            }

            resolve({
              title: tags.title,
              artist: tags.artist,
              picture: pictureUrl,
              lyrics: lyricsText,
            });
          } catch (innerErr) {
            resolve({});
          }
        },
        onError: (error: any) => {
          resolve({});
        },
      });
    } catch (err) {
      resolve({});
    }
  });
};

// 从远端 URL 读取音频内嵌元数据（封面/内嵌歌词），供 music 目录歌曲使用
export const loadRemoteAudioMetadata = async (
  url: string,
  fileName = "audio",
): Promise<{ title?: string; artist?: string; picture?: string; lyrics?: string }> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const blob = await res.blob();
    const file = new File([blob], fileName, { type: blob.type || "audio/mpeg" });
    return await parseAudioMetadata(file);
  } catch {
    return {};
  }
};

// 读取同名 .lrc 字幕（如 xxx.mp3 -> xxx.lrc），仅当内容带时间轴时返回
export const loadSidecarLyrics = async (audioUrl: string): Promise<string | null> => {
  try {
    const lrcUrl = audioUrl.replace(/\.[^.]+$/, "") + ".lrc";
    const res = await fetch(lrcUrl);
    if (!res.ok) return null;
    const text = await res.text();
    return text && /\[\d{1,2}:\d{2}/.test(text) ? text : null;
  } catch {
    return null;
  }
};

export const extractColors = async (imageSrc: string): Promise<string[]> => {
  if (typeof ColorThief === "undefined") {
    return ["#4f46e5", "#db2777", "#1f2937"];
  }

  try {
    const img = await loadImageElementWithCache(imageSrc);
    const colorThief = new ColorThief();
    const palette = colorThief.getPalette(img, 5);

    if (!palette || palette.length === 0) {
      return ["#4f46e5", "#db2777", "#1f2937"];
    }

    const vibrantCandidates = palette.filter((rgb: number[]) => {
      const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      return lum > 30;
    });

    const candidates = 
      vibrantCandidates.length > 0 ? vibrantCandidates : palette;

    candidates.sort((a: number[], b: number[]) => {
      const satA = Math.max(...a) - Math.min(...a);
      const satB = Math.max(...b) - Math.min(...b);
      return satB - satA;
    });

    const topColors = candidates.slice(0, 4);
    if (topColors.length === 0) {
      return ["#4f46e5", "#db2777", "#1f2937"];
    }
    return topColors.map((c: number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`);
  } catch (err) {
    return ["#4f46e5", "#db2777", "#1f2937"];
  }
};

