import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "http";
import Meting from "@meting/core";
import http from "http";
import https from "https";

const PLATFORMS = ["netease", "tencent", "kugou", "baidu", "kuwo"] as const;

// Meting 实例缓存
const metingCache = new Map<string, InstanceType<typeof Meting>>();
function getMeting(server: string) {
  let m = metingCache.get(server);
  if (!m) {
    m = new Meting(server);
    m.format(true);
    metingCache.set(server, m);
  }
  return m;
}

function parseQuery(req: IncomingMessage): Record<string, string> {
  const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { params[k] = v; });
  return params;
}

function sendJson(res: ServerResponse, data: any, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, message: string, status = 500) {
  sendJson(res, { error: message }, status);
}

function redirect(res: ServerResponse, url: string) {
  res.writeHead(302, { Location: url });
  res.end();
}

// ===== 流式代理：请求远端 CDN 并转发给客户端 =====
function proxyAudio(
  targetUrl: string,
  clientReq: IncomingMessage,
  clientRes: ServerResponse,
): Promise<boolean> {
  return new Promise((resolve) => {
    const parsed = new URL(targetUrl);
    const mod = parsed.protocol === "https:" ? https : http;

    const headers: Record<string, string> = {
      "Referer": "https://music.126.net/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "audio/mpeg,audio/*;q=0.8,*/*;q=0.5",
      "Connection": "keep-alive",
    };
    // 转发 Range 请求（支持拖动进度条）
    if (clientReq.headers["range"]) headers["Range"] = clientReq.headers["range"] as string;

    const proxyReq = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers,
        timeout: 15000,
      },
      (proxyRes) => {
        if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
          // CDN 不可用
          clientRes.destroy();
          resolve(false);
          return;
        }

        // 把 CDN 响应头转发给客户端
        const responseHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(proxyRes.headers)) {
          if (val && !["transfer-encoding", "connection"].includes(key.toLowerCase())) {
            responseHeaders[key] = val as string;
          }
        }
        responseHeaders["Access-Control-Allow-Origin"] = "*";
        clientRes.writeHead(proxyRes.statusCode || 200, responseHeaders);
        proxyRes.pipe(clientRes);

        proxyRes.on("end", () => resolve(true));
        proxyRes.on("error", () => resolve(false));
      },
    );

    proxyReq.on("error", () => resolve(false));
    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      resolve(false);
    });
    proxyReq.end();
  });
}

// ===== 验证 CDN URL 是否可访问 =====
function verifyCdnUrl(url: string): Promise<{ ok: boolean; size?: number }> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "HEAD",
        headers: {
          "Referer": "https://music.126.net/",
          "User-Agent": "Mozilla/5.0",
        },
        timeout: 8000,
      },
      (res) => {
        const ok = res.statusCode === 200 || res.statusCode === 206;
        const size = parseInt(res.headers["content-length"] || "0", 10);
        req.destroy();
        resolve({ ok, size });
      },
    );
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false });
    });
    req.end();
  });
}

// ===== 跨平台 fallback =====
async function tryFallbackForSong(
  title: string,
  artist: string,
  currentPlatform: string,
): Promise<string | null> {
  const fallbackPlatforms = PLATFORMS.filter((p) => p !== currentPlatform);
  const keyword = `${title} ${artist}`.trim();

  for (const platform of fallbackPlatforms) {
    try {
      const meting = getMeting(platform);
      const searchResult = await meting.search(keyword);
      const songs = JSON.parse(searchResult);
      if (!Array.isArray(songs) || songs.length === 0) continue;

      // 取前 3 个结果尝试
      for (const song of songs.slice(0, 3)) {
        const urlId = song.url_id || song.id;
        if (!urlId) continue;

        try {
          const urlResult = await meting.url(urlId.toString());
          const urlData = JSON.parse(urlResult);
          if (!urlData?.url) continue;

          // 验证 fallback URL 的 CDN 可用性
          const check = await verifyCdnUrl(urlData.url);
          if (check.ok) {
            return urlData.url;
          }
        } catch {
          // 换下一个结果
        }
      }
    } catch {
      // 换平台
    }
  }
  return null;
}

export default function musicApiPlugin(): Plugin {
  return {
    name: "music-api",
    configureServer(server) {
      server.middlewares.use("/api/music", async (req, res) => {
        try {
          const query = parseQuery(req);
          const server_ = query.server || "netease";
          const type = query.type || "search";
          const id = query.id || "";

          if (!PLATFORMS.includes(server_ as any)) {
            return sendError(res, `不支持的平台: ${server_}`, 400);
          }

          const meting = getMeting(server_);

          switch (type) {
            case "search": {
              if (!id) return sendError(res, "搜索关键词不能为空", 400);
              const result = await meting.search(id);
              const songs = JSON.parse(result);
              if (!Array.isArray(songs)) return sendJson(res, []);
              const mapped = songs.map((s: any) => ({
                id: s.id?.toString() || "",
                name: s.name || "",
                artist: Array.isArray(s.artist) ? s.artist.join("/") : (s.artist || ""),
                album: s.album || "",
                pic_id: s.pic_id?.toString() || "",
                lyric_id: s.lyric_id?.toString() || "",
                url_id: s.url_id?.toString() || "",
                duration: s.duration || 0,
              }));
              return sendJson(res, mapped);
            }

            case "url": {
              if (!id) return sendError(res, "歌曲 ID 不能为空", 400);
              const result = await meting.url(id);
              const data = JSON.parse(result);

              let targetUrl: string | null = data?.url || null;
              let finalPlatform = server_;

              // 如果初始 URL 无效或 CDN 不可访问，尝试 fallback
              if (targetUrl) {
                const check = await verifyCdnUrl(targetUrl);
                // 如果 CDN 403/404 或内容太小（<2MB 判定为试听版/错误页）
                if (!check.ok || (check.size && check.size < 2_000_000)) {
                  // 先尝试从 song API 拿到歌名/歌手再 fallback
                  try {
                    const songInfo = await meting.song(id);
                    const songData = JSON.parse(songInfo);
                    const song = Array.isArray(songData) ? songData[0] : songData;
                    if (song?.name) {
                      const artist = Array.isArray(song.artist) ? song.artist.join("/") : (song.artist || "");
                      const fallbackUrl = await tryFallbackForSong(song.name, artist, server_);
                      if (fallbackUrl) {
                        targetUrl = fallbackUrl;
                        finalPlatform = "fallback";
                      }
                    }
                  } catch { /* ignore */ }
                }
              } else {
                // meting.url 没返回 URL，直接 fallback
                try {
                  const songInfo = await meting.song(id);
                  const songData = JSON.parse(songInfo);
                  const song = Array.isArray(songData) ? songData[0] : songData;
                  if (song?.name) {
                    const artist = Array.isArray(song.artist) ? song.artist.join("/") : (song.artist || "");
                    const fallbackUrl = await tryFallbackForSong(song.name, artist, server_);
                    if (fallbackUrl) {
                      targetUrl = fallbackUrl;
                      finalPlatform = "fallback";
                    }
                  }
                } catch { /* ignore */ }
              }

              if (!targetUrl) {
                return sendError(res, "该歌曲可能需要 VIP 或受版权保护，暂时无法播放", 403);
              }

              // 流式代理转发（支持 Range 请求 → 可拖动进度条）
              const proxied = await proxyAudio(targetUrl, req, res);
              if (!proxied && !res.headersSent) {
                return sendError(res, "音频流获取失败", 502);
              }
              return;
            }

            case "lrc": {
              if (!id) return sendError(res, "歌曲 ID 不能为空", 400);
              const result = await meting.lyric(id);
              const data = JSON.parse(result);
              return sendJson(res, {
                lyric: data?.lyric || "",
                tlyric: data?.tlyric || "",
              });
            }

            case "pic": {
              if (!id) return sendError(res, "图片 ID 不能为空", 400);
              const result = await meting.pic(id);
              const data = JSON.parse(result);
              if (data?.url) {
                return redirect(res, data.url);
              }
              return sendError(res, "封面图不可用", 404);
            }

            case "song": {
              if (!id) return sendError(res, "歌曲 ID 不能为空", 400);
              const result = await meting.song(id);
              const data = JSON.parse(result);
              const song = Array.isArray(data) ? data[0] : data;
              if (!song) return sendError(res, "歌曲不存在", 404);
              return sendJson(res, {
                id: song.id?.toString() || "",
                name: song.name || "",
                artist: Array.isArray(song.artist) ? song.artist.join("/") : (song.artist || ""),
                album: song.album || "",
                pic_id: song.pic_id?.toString() || "",
                lyric_id: song.lyric_id?.toString() || "",
                url_id: song.url_id?.toString() || "",
              });
            }

            case "playlist": {
              if (!id) return sendError(res, "歌单 ID 不能为空", 400);
              const result = await meting.playlist(id);
              const data = JSON.parse(result);
              if (!Array.isArray(data)) return sendJson(res, []);
              const mapped = data.map((s: any) => ({
                id: s.id?.toString() || "",
                name: s.name || "",
                artist: Array.isArray(s.artist) ? s.artist.join("/") : (s.artist || ""),
                album: s.album || "",
                pic_id: s.pic_id?.toString() || "",
                lyric_id: s.lyric_id?.toString() || "",
                url_id: s.url_id?.toString() || "",
              }));
              return sendJson(res, mapped);
            }

            default:
              return sendError(res, `不支持的操作类型: ${type}`, 400);
          }
        } catch (err: any) {
          if (!res.headersSent) {
            sendError(res, err?.message || "服务器内部错误");
          }
        }
      });
    },
  };
}
