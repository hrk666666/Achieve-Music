import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "http";
import Meting from "@meting/core";

const PLATFORMS = ["netease", "tencent", "kugou", "baidu", "kuwo"] as const;

// Meting 实例缓存（避免每次请求重新创建）
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

// 解析 URL 查询参数
function parseQuery(req: IncomingMessage): Record<string, string> {
  const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { params[k] = v; });
  return params;
}

// 发送 JSON 响应
function sendJson(res: ServerResponse, data: any, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

// 发送错误
function sendError(res: ServerResponse, message: string, status = 500) {
  sendJson(res, { error: message }, status);
}

// 302 重定向
function redirect(res: ServerResponse, url: string) {
  res.writeHead(302, { Location: url });
  res.end();
}

// 尝试从其他平台获取可播放 URL（VIP fallback）
async function tryFallbackUrl(title: string, artist: string): Promise<{ url: string; platform: string } | null> {
  const fallbackPlatforms = ["tencent", "kugou", "kuwo"];
  const keyword = `${title} ${artist}`.trim();

  for (const platform of fallbackPlatforms) {
    try {
      const meting = getMeting(platform);
      const searchResult = await meting.search(keyword);
      const songs = JSON.parse(searchResult);
      if (!Array.isArray(songs) || songs.length === 0) continue;

      // 取第一个结果尝试获取 URL
      const song = songs[0];
      const urlId = song.url_id;
      if (!urlId) continue;

      const urlResult = await meting.url(urlId.toString());
      const urlData = JSON.parse(urlResult);
      if (urlData?.url) {
        return { url: urlData.url, platform };
      }
    } catch {
      // 继续尝试下一个平台
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
              // 统一格式
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

              // 如果有 URL，直接 302 重定向
              if (data?.url) {
                return redirect(res, data.url);
              }

              // VIP/版权限制：尝试 fallback 到其他平台
              try {
                const songInfo = await meting.song(id);
                const songData = JSON.parse(songInfo);
                const song = Array.isArray(songData) ? songData[0] : songData;
                if (song?.name) {
                  const artist = Array.isArray(song.artist) ? song.artist.join("/") : (song.artist || "");
                  const fallback = await tryFallbackUrl(song.name, artist);
                  if (fallback) {
                    return redirect(res, fallback.url);
                  }
                }
              } catch {
                // fallback 也失败了
              }

              // 所有平台都无法播放
              return sendError(res, "该歌曲可能需要VIP或受版权保护，暂时无法播放", 403);
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
          sendError(res, err?.message || "服务器内部错误");
        }
      });
    },
  };
}
