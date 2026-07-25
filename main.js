// Main.js - YouTube Video Downloader API for Deno Deploy
// Usage: https://your-app.deno.dev/?url=YOUTUBE_URL&quality=high|medium|low
// Example: /?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&quality=high

const YT_CLIENT = {
  client: {
    clientName: "WEB",
    clientVersion: "2.20230721.00.00",
  },
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36";

const QUALITY_MAP = {
  high: 1080,
  medium: 720,
  low: 480,
};

// Extract video ID from various YouTube URL formats
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
  throw new Error("Invalid YouTube URL - could not extract video ID");
}

// Fetch video info from YouTube's internal API
async function getVideoInfo(videoId) {
  const apiUrl =
    "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  const payload = {
    ...YT_CLIENT,
    videoId,
    context: {
      client: YT_CLIENT.client,
    },
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`YouTube API returned ${response.status}`);
  }

  const data = await response.json();
  if (data.playabilityStatus?.status !== "OK") {
    const reason = data.playabilityStatus?.reason || "Unknown";
    throw new Error(`Video unavailable: ${reason}`);
  }

  return data;
}

// Select best format based on quality target
function selectFormat(streamingData, quality) {
  const allFormats = [
    ...(streamingData?.formats || []),
    ...(streamingData?.adaptiveFormats || []),
  ];

  // Prefer muxed (video+audio) MP4 formats
  const candidates = allFormats
    .filter(f => f.mimeType?.startsWith("video/mp4") && f.height && f.bitrate)
    .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);

  const targetHeight = QUALITY_MAP[quality] || 720;

  // Find closest format that meets or exceeds target height
  let best = candidates.find(f => f.height >= targetHeight);
  if (!best && candidates.length > 0) {
    // If none meet target, take the highest available
    best = candidates[0];
  }

  if (!best) {
    throw new Error(`No video format found for quality: ${quality}`);
  }

  return best;
}

// Stream video from YouTube CDN
async function fetchVideoStream(videoUrl, rangeHeader) {
  const headers = {
    "User-Agent": USER_AGENT,
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
  };
  if (rangeHeader) {
    headers["Range"] = rangeHeader;
  }

  const response = await fetch(videoUrl, { headers });

  if (!response.ok && response.status !== 206) {
    throw new Error(`CDN fetch failed: ${response.status}`);
  }

  return response;
}

// Main request handler
async function handleRequest(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS preflight
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

  // Handle root or /download
  if ((path === "/" || path === "/download") && req.method === "GET") {
    const videoUrl = url.searchParams.get("url");
    const quality = url.searchParams.get("quality") || "medium";

    // If no URL, show API info
    if (!videoUrl) {
      return new Response(
        JSON.stringify({
          name: "YouTube Video Downloader API",
          usage: "?url=YOUTUBE_URL&quality=high|medium|low",
          example: "/?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&quality=high",
          supported_qualities: ["high (1080p)", "medium (720p)", "low (480p)"],
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
      // Extract video ID
      const videoId = extractVideoId(videoUrl);
      
      // Get video info
      const info = await getVideoInfo(videoId);
      
      // Select format
      const format = selectFormat(info.streamingData, quality);
      
      // Get video title for filename
      const title = info.videoDetails?.title || "video";
      const cleanTitle = title.replace(/[^a-zA-Z0-9 ]/g, "").trim() || "video";

      // Handle range requests
      const rangeHeader = req.headers.get("range") || undefined;
      
      // Fetch video stream
      const streamResponse = await fetchVideoStream(format.url, rangeHeader);

      // Build response headers
      const responseHeaders = new Headers({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
        "Content-Disposition": `attachment; filename="${cleanTitle}_${quality}.mp4"`,
        "Accept-Ranges": "bytes",
      });

      // Forward CDN headers
      const headersToForward = ["content-range", "content-length", "content-type"];
      for (const h of headersToForward) {
        if (streamResponse.headers.has(h)) {
          responseHeaders.set(h, streamResponse.headers.get(h));
        }
      }

      // Ensure content-type is set
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

  // 404 for any other path
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
