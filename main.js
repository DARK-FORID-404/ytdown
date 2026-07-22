// main.js - YouTube Downloader API for Deno Deploy
// Uses npm: specifier (native Deno support)

import ytdl from "npm:ytdl-core@4.11.5";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Parse query string
function parseQuery(url) {
  const q = new URL(url).searchParams;
  const obj = {};
  for (const [k, v] of q.entries()) obj[k] = v;
  return obj;
}

// Helper: get video info and available formats
async function getVideoInfo(videoUrl) {
  const info = await ytdl.getInfo(videoUrl);
  const formats = info.formats
    .filter(f => f.hasVideo && f.hasAudio)
    .map(f => ({
      itag: f.itag,
      quality: f.qualityLabel,
      container: f.container,
      codecs: f.codecs,
      bitrate: f.bitrate,
      fps: f.fps,
      width: f.width,
      height: f.height,
      url: f.url,
    }));
  const videoOnly = info.formats
    .filter(f => f.hasVideo && !f.hasAudio)
    .map(f => ({
      itag: f.itag,
      quality: f.qualityLabel,
      container: f.container,
      width: f.width,
      height: f.height,
      fps: f.fps,
      url: f.url,
    }));
  const audioOnly = info.formats
    .filter(f => f.hasAudio && !f.hasVideo)
    .map(f => ({
      itag: f.itag,
      quality: f.audioQuality || "medium",
      container: f.container,
      bitrate: f.bitrate,
      url: f.url,
    }));
  return {
    title: info.videoDetails.title,
    formats,
    videoOnly,
    audioOnly,
  };
}

// Main request handler
async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // GET /api/info
  if (path === "/api/info" && req.method === "GET") {
    const params = parseQuery(req.url);
    const videoUrl = params.url;
    if (!videoUrl) {
      return new Response(
        JSON.stringify({ error: "Missing url parameter" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }
    try {
      const data = await getVideoInfo(videoUrl);
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    } catch (err) {
      console.error("Info error:", err);
      return new Response(
        JSON.stringify({ error: err.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }
  }

  // GET /api/download
  if (path === "/api/download" && req.method === "GET") {
    const params = parseQuery(req.url);
    const videoUrl = params.url;
    const quality = params.quality || "720p";
    const itag = params.itag;

    if (!videoUrl) {
      return new Response(
        JSON.stringify({ error: "Missing url parameter" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    try {
      const info = await ytdl.getInfo(videoUrl);
      const title = info.videoDetails.title.replace(/[^\w\s]/gi, "");
      let format = null;

      if (itag) {
        format = info.formats.find(f => f.itag == parseInt(itag));
      } else {
        // Prefer combined format with exact quality label
        format = info.formats.find(
          f => f.qualityLabel === quality && f.hasVideo && f.hasAudio
        );
        if (!format) {
          // Fallback to best combined format
          format = info.formats
            .filter(f => f.hasVideo && f.hasAudio)
            .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
        }
      }

      if (!format) {
        return new Response(
          JSON.stringify({ error: "No suitable format found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }

      // Fetch the actual video stream using the format URL
      const response = await fetch(format.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch video: ${response.status}`);
      }

      const filename = `${title}_${format.qualityLabel || "default"}.${format.container || "mp4"}`;
      const headers = {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": `video/${format.container || "mp4"}`,
        ...corsHeaders,
      };

      return new Response(response.body, { headers });
    } catch (err) {
      console.error("Download error:", err);
      return new Response(
        JSON.stringify({ error: err.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }
  }

  // GET /api/download/separate
  if (path === "/api/download/separate" && req.method === "GET") {
    const params = parseQuery(req.url);
    const videoUrl = params.url;
    const type = params.type;
    const quality = params.quality;

    if (!videoUrl || !type) {
      return new Response(
        JSON.stringify({ error: "Missing url or type parameter" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    try {
      const info = await ytdl.getInfo(videoUrl);
      const title = info.videoDetails.title.replace(/[^\w\s]/gi, "");
      let format = null;

      if (type === "video") {
        const candidates = info.formats.filter(f => f.hasVideo && !f.hasAudio);
        if (quality) {
          format = candidates.find(f => f.qualityLabel === quality);
        }
        if (!format) format = candidates.sort((a, b) => (b.height || 0) - (a.height || 0))[0];
      } else if (type === "audio") {
        const candidates = info.formats.filter(f => f.hasAudio && !f.hasVideo);
        format = candidates.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      }

      if (!format) {
        return new Response(
          JSON.stringify({ error: "No format found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }

      const response = await fetch(format.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      const ext = format.container || (type === "audio" ? "m4a" : "mp4");
      const filename = `${title}_${type}_${format.qualityLabel || "default"}.${ext}`;
      const contentType = type === "audio" ? "audio/mpeg" : `video/${ext}`;
      const headers = {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": contentType,
        ...corsHeaders,
      };

      return new Response(response.body, { headers });
    } catch (err) {
      console.error("Separate download error:", err);
      return new Response(
        JSON.stringify({ error: err.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }
  }

  // GET /api/health
  if (path === "/api/health") {
    return new Response("OK", { headers: corsHeaders });
  }

  // 404
  return new Response(
    JSON.stringify({ error: "Not found" }),
    {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    }
  );
}

// Start server
Deno.serve(handler, { port: 8000 });
console.log("YouTube Downloader API running on Deno Deploy");
console.log("Endpoints:");
console.log("  GET /api/info?url=<video_url>");
console.log("  GET /api/download?url=<video_url>&quality=720p");
console.log("  GET /api/download/separate?url=<video_url>&type=video");
console.log("  GET /api/health");
