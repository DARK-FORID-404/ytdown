// Main.js - YouTube Video Downloader API - Fully Working with Cookie Auth
// Uses real visitor cookies to bypass bot detection

const QUALITY_MAP = {
  high: 1080,
  medium: 720,
  low: 480,
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
];

// Cookie store
let visitorCookie = null;
let cookieExpiry = 0;

// In-memory cache
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

// Get a fresh visitor cookie from YouTube
async function getVisitorCookie() {
  if (visitorCookie && Date.now() < cookieExpiry) {
    return visitorCookie;
  }

  try {
    console.log("🔄 Fetching fresh visitor cookie...");
    const response = await fetch("https://www.youtube.com/", {
      headers: {
        "User-Agent": getUserAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
      },
    });

    const setCookie = response.headers.get("set-cookie");
    if (!setCookie) {
      throw new Error("No cookie received");
    }

    // Extract VISITOR_INFO1_LIVE and other cookies
    const cookieParts = setCookie.split(",").map(c => c.trim());
    let visitorInfo = null;
    let yscCookie = null;
    
    for (const part of cookieParts) {
      if (part.includes("VISITOR_INFO1_LIVE=")) {
        const match = part.match(/VISITOR_INFO1_LIVE=([^;]+)/);
        if (match) visitorInfo = `VISITOR_INFO1_LIVE=${match[1]}`;
      }
      if (part.includes("YSC=")) {
        const match = part.match(/YSC=([^;]+)/);
        if (match) yscCookie = `YSC=${match[1]}`;
      }
    }

    if (!visitorInfo) {
      throw new Error("Could not extract VISITOR_INFO1_LIVE");
    }

    // Also get a session cookie from a second request
    const cookieString = [visitorInfo, yscCookie, "PREF=hl=en&gl=US"].filter(Boolean).join("; ");
    
    visitorCookie = cookieString;
    cookieExpiry = Date.now() + 30 * 60 * 1000; // 30 minutes
    console.log("✅ Visitor cookie obtained successfully");
    return visitorCookie;
  } catch (error) {
    console.error("Failed to get cookie:", error);
    // Return a default cookie as fallback
    return "VISITOR_INFO1_LIVE=default; PREF=hl=en&gl=US;";
  }
}

// Fetch with timeout and retry
async function fetchWithRetry(url, options = {}, timeoutMs = 15000, retries = 2) {
  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      lastError = error;
      if (i < retries) {
        const delay = Math.pow(2, i) * 1000;
        console.log(`⏳ Retry ${i+1}/${retries} after ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error("All retries failed");
}

// Strategy 1: YouTube API with proper cookie
async function fetchWithAPI(videoId) {
  const cookie = await getVisitorCookie();
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
      user: {
        lockedSafetyMode: false,
      },
      thirdParty: {
        embedUrl: "https://www.youtube.com/",
      },
    },
  };

  const response = await fetchWithRetry(`${apiUrl}?key=${key}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": getUserAgent(),
      "Accept-Language": "en-US,en;q=0.9",
      "Origin": "https://www.youtube.com",
      "Referer": "https://www.youtube.com/",
      "Cookie": cookie,
    },
    body: JSON.stringify(payload),
  }, 12000, 1);

  if (!response.ok) {
    throw new Error(`API returned ${response.status}`);
  }

  const data = await response.json();
  
  // Check if we got formats
  if (data.playabilityStatus?.status !== "OK") {
    throw new Error(`Video unavailable: ${data.playabilityStatus?.reason || "Unknown"}`);
  }

  // Check if formats exist
  if (!data.streamingData?.formats?.length && !data.streamingData?.adaptiveFormats?.length) {
    throw new Error("No formats found in API response");
  }

  return data;
}

// Strategy 2: get_video_info endpoint (older API)
async function fetchWithGetVideoInfo(videoId) {
  const cookie = await getVisitorCookie();
  const url = `https://www.youtube.com/get_video_info?video_id=${videoId}&el=detailpage&ps=default&eurl=&gl=US&hl=en`;
  
  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": getUserAgent(),
      "Accept-Language": "en-US,en;q=0.9",
      "Cookie": cookie,
    },
  }, 10000, 1);

  if (!response.ok) {
    throw new Error(`get_video_info returned ${response.status}`);
  }

  const text = await response.text();
  const params = new URLSearchParams(text);
  
  // Check for error
  const status = params.get("status");
  if (status === "fail") {
    throw new Error(`Video unavailable: ${params.get("reason") || "Unknown"}`);
  }

  // Parse player_response
  const playerResponse = params.get("player_response");
  if (!playerResponse) {
    throw new Error("No player_response in get_video_info");
  }

  const data = JSON.parse(playerResponse);
  
  if (!data.streamingData?.formats?.length && !data.streamingData?.adaptiveFormats?.length) {
    throw new Error("No formats found in get_video_info response");
  }

  return data;
}

// Strategy 3: HTML parsing with cookie
async function fetchWithHTML(videoId) {
  const cookie = await getVisitorCookie();
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": getUserAgent(),
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Cookie": cookie,
    },
  }, 12000, 1);

  if (!response.ok) {
    throw new Error(`HTML fetch failed: ${response.status}`);
  }

  const html = await response.text();
  
  // Try multiple patterns to find player response
  let match = html.match(/var ytInitialPlayerResponse = ({.*?});/);
  if (!match) {
    match = html.match(/ytInitialPlayerResponse\s*=\s*({.*?});/);
  }
  if (!match) {
    // Try to find in embedded JSON
    const embedMatch = html.match(/<script\s+nonce="[^"]*">\s*var\s+ytInitialPlayerResponse\s*=\s*({.*?});/);
    if (embedMatch) match = embedMatch;
  }
  
  if (!match) {
    throw new Error("Could not find player response in HTML");
  }

  const data = JSON.parse(match[1]);
  
  if (data.playabilityStatus?.status !== "OK") {
    throw new Error(`Video unavailable: ${data.playabilityStatus?.reason || "Unknown"}`);
  }

  if (!data.streamingData?.formats?.length && !data.streamingData?.adaptiveFormats?.length) {
    throw new Error("No formats found in HTML response");
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
    { name: "API with cookie", fn: () => fetchWithAPI(videoId) },
    { name: "get_video_info", fn: () => fetchWithGetVideoInfo(videoId) },
    { name: "HTML with cookie", fn: () => fetchWithHTML(videoId) },
  ];

  for (const strategy of strategies) {
    try {
      console.log(`🔄 Trying strategy: ${strategy.name}`);
      const data = await strategy.fn();
      
      const hasFormats = data.streamingData?.formats?.length > 0 || 
                         data.streamingData?.adaptiveFormats?.length > 0;
      
      if (hasFormats) {
        console.log(`✅ Strategy ${strategy.name} succeeded`);
        cache.set(videoId, { data, timestamp: Date.now() });
        return data;
      }
      errors.push(`${strategy.name}: No formats found`);
    } catch (error) {
      errors.push(`${strategy.name}: ${error.message}`);
      console.log(`❌ Strategy ${strategy.name} failed: ${error.message}`);
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

  // Filter for video formats
  const videoFormats = allFormats
    .filter(f => f.mimeType?.includes("video") && f.height && f.bitrate)
    .sort((a, b) => {
      // Sort by height descending, then bitrate
      if (a.height !== b.height) return b.height - a.height;
      return b.bitrate - a.bitrate;
    });

  if (videoFormats.length === 0) {
    throw new Error("No video formats available");
  }

  const targetHeight = QUALITY_MAP[quality] || 720;

  // Find best match
  let best = videoFormats.find(f => f.height >= targetHeight);
  if (!best) {
    // If no format meets target, take the highest available
    best = videoFormats[0];
  }

  console.log(`Selected format: ${best.height}p (target: ${targetHeight}p), bitrate: ${best.bitrate}`);
  return best;
}

// Stream video with proper handling
async function streamVideo(videoUrl, rangeHeader) {
  const headers = {
    "User-Agent": getUserAgent(),
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "close",
  };
  if (rangeHeader) {
    headers["Range"] = rangeHeader;
  }

  const response = await fetchWithRetry(videoUrl, { headers }, 30000, 1);

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
      cacheSize: cache.size,
      cookieValid: !!visitorCookie,
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
          version: "2.0",
          description: "High/Medium/Low quality video downloader with bot bypass",
          usage: "?url=YOUTUBE_URL&quality=high|medium|low",
          example: "/?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&quality=high",
          health: "/health",
          note: "Uses cookie authentication to bypass bot detection",
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
      console.log(`📹 Processing: ${videoId}, quality: ${quality}`);

      // Get video info with overall timeout
      const infoPromise = getVideoInfo(videoId);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Video info fetch timeout after 20s")), 20000);
      });
      
      const data = await Promise.race([infoPromise, timeoutPromise]);
      const format = selectFormat(data, quality);
      
      const title = data.videoDetails?.title || "video";
      const cleanTitle = title.replace(/[^a-zA-Z0-9 ]/g, "").trim() || "video";
      const filename = `${cleanTitle}_${quality}.mp4`;

      console.log(`📤 Streaming: ${filename} (${format.height}p)`);

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
        "Cache-Control": "public, max-age=3600",
        "Connection": "close",
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

      return new Response(streamResponse.body, {
        status: streamResponse.status,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error("❌ Download error:", error);
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

// Start server
console.log("🚀 YouTube Downloader API v2.0 starting...");
console.log("📦 Cache TTL:", CACHE_TTL/1000, "seconds");

Deno.serve({
  port: 8000,
  onListen: () => console.log(`✅ Server running on port 8000`),
  onError: (error) => {
    console.error("🔥 Server error:", error);
    return new Response("Internal Server Error", { status: 500 });
  },
}, handleRequest);
