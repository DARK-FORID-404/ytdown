// Main.js - Fixed YouTube Video Downloader API with Timeouts & Proper Streaming
// Deno Deploy compatible - v2.0

const QUALITY_MAP = {
  high: 1080,
  medium: 720,
  low: 480,
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

// In-memory cache for video info (TTL: 5 minutes)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&?#]+)/,
    /youtube\.com\/shorts\/([^&?#]+)/,
    /youtube\.com\/live\/([^&?#]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  throw new Error("Invalid YouTube URL");
}

// Fetch with timeout and abort
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// Strategy 1: YouTube API
async function fetchWithAPI(videoId) {
  const apiUrl = "https://www.youtube.com/youtubei/v1/player";
  const key = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  
  const payload = {
    videoId: videoId,
    context: {
      client: {
        clientName: "WEB",
        clientVersion: "2.20241201.00.00",
        hl: "en",
        gl: "US",
        visitorData: `Cgt${btoa(Math.random().toString(36).substring(2, 15))}`,
      },
    },
  };

  const response = await fetchWithTimeout(`${apiUrl}?key=${key}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": getUserAgent(),
      "Accept-Language": "en-US,en;q=0.9",
      "Origin": "https://www.youtube.com",
      "Referer": "https://www.youtube.com/",
    },
    body: JSON.stringify(payload),
  }, 10000);

  if (!response.ok) {
    throw new Error(`API returned ${response.status}`);
  }

  const data = await response.json();
  return data;
}

// Strategy 2: Invidious
async function fetchWithInvidious(videoId) {
  const instances = [
    "https://invidious.io/",
    "https://yewtu.be/",
    "https://inv.riverside.rocks/",
  ];
  
  const shuffled = instances.sort(() => Math.random() - 0.5);
  
  for (const instance of shuffled) {
    try {
      const response = await fetchWithTimeout(`${instance}api/v1/videos/${videoId}`, {
        headers: {
          "User-Agent": getUserAgent(),
          "Accept": "application/json",
        },
      }, 8000);
      
      if (response.ok) {
        const data = await response.json();
        return transformInvidiousData(data);
      }
    } catch (e) {
      continue;
    }
  }
  throw new Error("All Invidious instances failed");
}

function transformInvidiousData(data) {
  const formats = [];
  const adaptiveFormats = [];
  
  if (data.videoStreams) {
    for (const stream of data.videoStreams) {
      formats.push({
        url: stream.url,
        mimeType: `video/mp4; codecs="${stream.encoding || "avc1"}"`,
        height: stream.height,
        width: stream.width,
        bitrate: stream.bitrate || 0,
        qualityLabel: `${stream.height}p`,
      });
    }
  }
  
  if (data.audioStreams) {
    for (const stream of data.audioStreams) {
      adaptiveFormats.push({
        url: stream.url,
        mimeType: `audio/mp4; codecs="${stream.encoding || "mp4a"}"`,
        height: 0,
        width: 0,
        bitrate: stream.bitrate || 0,
        qualityLabel: `audio-${stream.bitrate}`,
      });
    }
  }
  
  return {
    videoDetails: {
      title: data.title || "Video",
      videoId: data.videoId,
    },
    streamingData: {
      formats: formats,
      adaptiveFormats: adaptiveFormats,
    },
  };
}

// Strategy 3: HTML parse
async function fetchWithHTML(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": getUserAgent(),
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Cookie": "VISITOR_INFO1_LIVE=test; PREF=hl=en&gl=US;",
    },
  }, 10000);

  if (!response.ok) {
    throw new Error(`HTML fetch failed: ${response.status}`);
  }

  const html = await response.text();
  const match = html.match(/var ytInitialPlayerResponse = ({.*?});/);
  if (!match) {
    throw new Error("Could not find player response in HTML");
  }

  const data = JSON.parse(match[1]);
  if (data.playabilityStatus?.status !== "OK") {
    throw new Error(`Video unavailable: ${data.playabilityStatus?.reason || "Unknown"}`);
  }

  return data;
}

// Main video info fetcher with cache
async function getVideoInfo(videoId) {
  // Check cache
  const cached = cache.get(videoId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`✓ Cache hit for ${videoId}`);
    return cached.data;
  }

  const errors = [];
  const strategies = [
    { name: "API", fn: () => fetchWithAPI(videoId) },
    { name: "Invidious", fn: () => fetchWithInvidious(videoId) },
    { name: "HTML", fn: () => fetchWithHTML(videoId) },
  ];

  for (const strategy of strategies) {
    try {
      console.log(`Trying strategy: ${strategy.name}`);
      const data = await strategy.fn();
      
      const hasFormats = data.streamingData?.formats?.length > 0 || 
                         data.streamingData?.adaptiveFormats?.length > 0;
      
      if (hasFormats) {
        console.log(`✓ Strategy ${strategy.name} succeeded`);
        // Cache the result
        cache.set(videoId, { data, timestamp: Date.now() });
        return data;
      }
      errors.push(`${strategy.name}: No formats found`);
    } catch (error) {
      errors.push(`${strategy.name}: ${error.message}`);
      console.log(`✗ Strategy ${strategy.name} failed: ${error.message}`);
    }
  }

  throw new Error(`All strategies failed:\n${errors.join("\n")}`);
}

// Select format
function selectFormat(data, quality) {
  const allFormats = [
    ...(data.streamingData?.formats || []),
    ...(data.streamingData?.adaptiveFormats || []),
  ];

  // Filter for video formats with height
  const videoFormats = allFormats
    .filter(f => f.mimeType?.includes("video") && f.height && f.bitrate)
    .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);

  const targetHeight = QUALITY_MAP[quality] || 720;

  // Try to find exact match or closest
  let best = videoFormats.find(f => f.height >= targetHeight);
  if (!best && videoFormats.length > 0) {
    best = videoFormats[0]; // Take highest available
  }

  if (!best) {
    throw new Error(`No video format found for quality: ${quality}`);
  }

  return best;
}

// Stream video with proper pipe
async function streamVideo(videoUrl, rangeHeader) {
  const headers = {
    "User-Agent": getUserAgent(),
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "close", // Prevent hanging
  };
  if (rangeHeader) {
    headers["Range"] = rangeHeader;
  }

  // Use a longer timeout for video streaming
  const response = await fetchWithTimeout(videoUrl, { headers }, 30000);

  if (!response.ok && response.status !== 206) {
    throw new Error(`CDN fetch failed: ${response.status}`);
  }

  return response;
}

// Main handler
async function handleRequest(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  // Health check
  if (path === "/health") {
    return new Response(JSON.stringify({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      cacheSize: cache.size 
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if ((path === "/" || path === "/download") && req.method === "GET") {
    const videoUrl = url.searchParams.get("url");
    const quality = url.searchParams.get("quality") || "medium";

    if (!videoUrl) {
      return new Response(
        JSON.stringify({
          name: "YouTube Video Downloader API",
          usage: "?url=YOUTUBE_URL&quality=high|medium|low",
          example: "/?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&quality=high",
          health: "/health",
        }, null, 2),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    try {
      const videoId = extractVideoId(videoUrl);
      console.log(`Processing: ${videoId}, quality: ${quality}`);

      // Get video info with timeout (15 seconds max)
      const infoPromise = getVideoInfo(videoId);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Video info fetch timeout")), 15000);
      });
      
      const data = await Promise.race([infoPromise, timeoutPromise]);
      const format = selectFormat(data, quality);
      
      const title = data.videoDetails?.title || "video";
      const cleanTitle = title.replace(/[^a-zA-Z0-9 ]/g, "").trim() || "video";
      const filename = `${cleanTitle}_${quality}.mp4`;

      console.log(`Selected format: ${format.height}p, bitrate: ${format.bitrate}`);

      // Handle range request
      const rangeHeader = req.headers.get("range") || undefined;
      
      // Stream the video
      const streamResponse = await streamVideo(format.url, rangeHeader);

      // Build response headers
      const responseHeaders = new Headers({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Connection": "close", // Prevent hanging
      });

      // Forward CDN headers
      const headersToForward = ["content-range", "content-length", "content-type"];
      for (const h of headersToForward) {
        if (streamResponse.headers.has(h)) {
          responseHeaders.set(h, streamResponse.headers.get(h));
        }
      }

      if (!responseHeaders.has("content-type")) {
        responseHeaders.set("content-type", format.mimeType || "video/mp4");
      }

      // Create a response with the stream
      return new Response(streamResponse.body, {
        status: streamResponse.status,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error("Download error:", error);
      return new Response(
        JSON.stringify({
          error: error.message || "Download failed",
          stack: error.stack,
          timestamp: new Date().toISOString(),
        }, null, 2),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: "Not found. Use /?url=YOUR_YOUTUBE_URL" }),
    {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

// Start server with timeout configuration
console.log("🚀 YouTube Downloader API starting...");
console.log(`Cache TTL: ${CACHE_TTL/1000}s`);

// Deno Deploy entry
Deno.serve({
  port: 8000,
  onListen: () => console.log(`✅ Server running on port 8000`),
  onError: (error) => {
    console.error("Server error:", error);
    return new Response("Internal Server Error", { status: 500 });
  },
}, handleRequest);
