// Main.js - YouTube Video Downloader API with Bot Bypass
// Uses multiple strategies to overcome "Sign in to confirm you're not a bot"

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

const QUALITY_MAP = {
  high: 1080,
  medium: 720,
  low: 480,
};

// Rotate user agent
function getUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Extract video ID
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

// Strategy 1: YouTube API with proper client and visitor data
async function fetchWithAPI(videoId) {
  const apiUrl = "https://www.youtube.com/youtubei/v1/player";
  const key = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  
  // Generate a visitor data token (random)
  const visitorData = `Cgt${btoa(Math.random().toString(36).substring(2, 15))}`;
  
  const payload = {
    videoId: videoId,
    context: {
      client: {
        clientName: "WEB",
        clientVersion: "2.20241201.00.00",
        hl: "en",
        gl: "US",
        visitorData: visitorData,
      },
      thirdParty: {
        embedUrl: "https://www.youtube.com/",
      },
    },
  };

  const response = await fetch(`${apiUrl}?key=${key}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": getUserAgent(),
      "Accept-Language": "en-US,en;q=0.9",
      "Origin": "https://www.youtube.com",
      "Referer": "https://www.youtube.com/",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`API returned ${response.status}`);
  }

  const data = await response.json();
  return data;
}

// Strategy 2: Invidious instance (public proxy)
async function fetchWithInvidious(videoId) {
  const instances = [
    "https://invidious.io/",
    "https://invidious.snopyta.org/",
    "https://yewtu.be/",
    "https://inv.riverside.rocks/",
  ];
  
  // Shuffle instances
  const shuffled = instances.sort(() => Math.random() - 0.5);
  
  for (const instance of shuffled) {
    try {
      const response = await fetch(`${instance}api/v1/videos/${videoId}`, {
        headers: {
          "User-Agent": getUserAgent(),
          "Accept": "application/json",
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        // Transform invidious format to YouTube-like format
        return transformInvidiousData(data);
      }
    } catch (e) {
      continue; // Try next instance
    }
  }
  throw new Error("All Invidious instances failed");
}

// Transform Invidious data to match YouTube API format
function transformInvidiousData(invidiousData) {
  const formats = [];
  const adaptiveFormats = [];
  
  // Invidious format: video/audio streams
  if (invidiousData.videoStreams) {
    for (const stream of invidiousData.videoStreams) {
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
  
  if (invidiousData.audioStreams) {
    for (const stream of invidiousData.audioStreams) {
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
      title: invidiousData.title || "Video",
      videoId: invidiousData.videoId,
    },
    streamingData: {
      formats: formats,
      adaptiveFormats: adaptiveFormats,
    },
  };
}

// Strategy 3: Parse watch page HTML (fallback)
async function fetchWithHTML(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": getUserAgent(),
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Cookie": "VISITOR_INFO1_LIVE=test; PREF=hl=en&gl=US;",
    },
  });

  if (!response.ok) {
    throw new Error(`HTML fetch failed: ${response.status}`);
  }

  const html = await response.text();
  
  // Extract initial player response
  const playerResponseMatch = html.match(/var ytInitialPlayerResponse = ({.*?});/);
  if (!playerResponseMatch) {
    throw new Error("Could not find player response in HTML");
  }

  const data = JSON.parse(playerResponseMatch[1]);
  
  if (data.playabilityStatus?.status !== "OK") {
    throw new Error(`Video unavailable: ${data.playabilityStatus?.reason || "Unknown"}`);
  }

  return data;
}

// Main function to get video info with fallbacks
async function getVideoInfo(videoId) {
  const errors = [];
  
  // Try strategies in order
  const strategies = [
    { name: "API", fn: () => fetchWithAPI(videoId) },
    { name: "Invidious", fn: () => fetchWithInvidious(videoId) },
    { name: "HTML", fn: () => fetchWithHTML(videoId) },
  ];

  for (const strategy of strategies) {
    try {
      console.log(`Trying strategy: ${strategy.name}`);
      const data = await strategy.fn();
      
      // Validate data
      if (data.streamingData?.formats?.length > 0 || data.streamingData?.adaptiveFormats?.length > 0) {
        console.log(`✓ Strategy ${strategy.name} succeeded`);
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

// Select best format
function selectFormat(data, quality) {
  const allFormats = [
    ...(data.streamingData?.formats || []),
    ...(data.streamingData?.adaptiveFormats || []),
  ];

  // Prefer video+audio muxed
  const candidates = allFormats
    .filter(f => f.mimeType?.includes("video") && f.height && f.bitrate)
    .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);

  const targetHeight = QUALITY_MAP[quality] || 720;

  let best = candidates.find(f => f.height >= targetHeight);
  if (!best && candidates.length > 0) {
    best = candidates[0];
  }

  if (!best) {
    throw new Error(`No video format found for quality: ${quality}`);
  }

  return best;
}

// Stream video from CDN
async function fetchVideoStream(videoUrl, rangeHeader) {
  const headers = {
    "User-Agent": getUserAgent(),
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Range": rangeHeader || "bytes=0-",
  };

  const response = await fetch(videoUrl, { headers });

  if (!response.ok && response.status !== 206) {
    throw new Error(`CDN fetch failed: ${response.status}`);
  }

  return response;
}

// Main handler
async function handleRequest(req) {
  const url = new URL(req.url);
  const path = url.pathname;

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
          supported_qualities: ["high (1080p)", "medium (720p)", "low (480p)"],
          note: "Uses multiple strategies to bypass bot detection",
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
      const data = await getVideoInfo(videoId);
      const format = selectFormat(data, quality);
      
      const title = data.videoDetails?.title || "video";
      const cleanTitle = title.replace(/[^a-zA-Z0-9 ]/g, "").trim() || "video";

      const rangeHeader = req.headers.get("range") || undefined;
      const streamResponse = await fetchVideoStream(format.url, rangeHeader);

      const responseHeaders = new Headers({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
        "Content-Disposition": `attachment; filename="${cleanTitle}_${quality}.mp4"`,
        "Accept-Ranges": "bytes",
      });

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
      return new Response(
        JSON.stringify({
          error: error.message || "Download failed",
          stack: error.stack,
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
Deno.serve(handleRequest);
