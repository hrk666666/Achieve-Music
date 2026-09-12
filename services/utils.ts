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

// Helper to request via CORS proxy (api.allorigins.win is reliable for GET requests)
// Try direct request first, fallback to proxy if CORS fails
export const fetchViaProxy = async (targetUrl: string): Promise<any> => {
  let text: string;

  // 1. Try direct request first
  try {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(
        `Direct fetch failed with status: ${response.status} ${targetUrl}`,
      );
    }
    text = await response.text();
    return JSON.parse(text);
  } catch (directError) {
    // 2. Direct request failed (likely CORS), try proxy


    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) {
        throw new Error(`Proxy fetch failed with status: ${response.status}`);
      }
      text = await response.text();
      return JSON.parse(text);
    } catch (proxyError) {

      throw proxyError;
    }
  }
};

// Proxy configurations for image fetching
const IMAGE_PROXIES = [
  (url: string) => `https://images.weserv.nl/?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`
];

// Helper to fetch images with CORS handling using reliable proxy
export const fetchImageViaProxy = async (targetUrl: string): Promise<Blob> => {
  // Try direct request first (works for most cases like NetEase)
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

  // For all images that failed direct fetch, try reliable proxies

  
  for (const proxyFactory of IMAGE_PROXIES) {
    try {
      const proxyUrl = proxyFactory(targetUrl);
      const response = await fetch(proxyUrl, {
        mode: 'cors',
        cache: 'force-cache'
      });
      
      if (response.ok) {
        return await response.blob();
      }
    } catch (error) {

    }
  }

  // Final fallback: Try with Image object and canvas (works for some cases)
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



// Metadata Parser using jsmediatags
export const parseAudioMetadata = (
  file: File,
): Promise<{
  title?: string;
  artist?: string;
  picture?: string;
  lyrics?: string;
}> => {
  return new Promise((resolve) => {
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

            // Extract embedded lyrics (USLT tag for unsynchronized lyrics)
            // Some formats also use "lyrics" or "LYRICS" tag
            if (tags.USLT) {
              // USLT can be an object with lyrics.text or just a string
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
