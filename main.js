// main.js - YouTube Downloader with Quality Selection Page
// Shows all available download links for different qualities

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

// Get video info with all formats
async function getVideoInfo(videoUrl) {
  const info = await ytdl.getInfo(videoUrl);
  
  // Get all available qualities (combined video+audio)
  const combinedFormats = info.formats
    .filter(f => f.hasVideo && f.hasAudio)
    .map(f => ({
      itag: f.itag,
      quality: f.qualityLabel,
      container: f.container,
      width: f.width,
      height: f.height,
      fps: f.fps,
      bitrate: f.bitrate,
      url: f.url,
    }))
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  // Get video-only formats (for higher quality without audio)
  const videoOnlyFormats = info.formats
    .filter(f => f.hasVideo && !f.hasAudio)
    .map(f => ({
      itag: f.itag,
      quality: f.qualityLabel,
      container: f.container,
      width: f.width,
      height: f.height,
      fps: f.fps,
      url: f.url,
    }))
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  // Get audio-only formats
  const audioFormats = info.formats
    .filter(f => f.hasAudio && !f.hasVideo)
    .map(f => ({
      itag: f.itag,
      quality: f.audioQuality || "medium",
      container: f.container,
      bitrate: f.bitrate,
      url: f.url,
    }))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  return {
    title: info.videoDetails.title,
    duration: info.videoDetails.lengthSeconds,
    thumbnail: info.videoDetails.thumbnails?.[info.videoDetails.thumbnails.length - 1]?.url,
    author: info.videoDetails.author.name,
    views: info.videoDetails.viewCount,
    combinedFormats,
    videoOnlyFormats,
    audioFormats,
  };
}

// Generate HTML page with download links
function generateDownloadPage(videoInfo, videoUrl) {
  const { title, thumbnail, author, combinedFormats, videoOnlyFormats, audioFormats } = videoInfo;
  
  // Quality badge colors
  const qualityColors = {
    '360p': '#4CAF50',
    '480p': '#2196F3',
    '720p': '#FF9800',
    '1080p': '#f44336',
    '1440p': '#9C27B0',
    '2160p': '#000000',
    '4K': '#000000',
  };

  // Generate quality cards
  function generateQualityCards(formats, type = 'video') {
    if (formats.length === 0) return '<p style="color: #999;">No formats available</p>';
    
    return formats.map(f => {
      const quality = f.quality || 'Unknown';
      const color = qualityColors[quality] || '#666';
      const size = f.height ? `${f.height}p` : quality;
      const container = f.container || 'mp4';
      const bitrate = f.bitrate ? `${(f.bitrate / 1000).toFixed(0)} kbps` : '';
      const fps = f.fps ? `${f.fps} fps` : '';
      
      return `
        <div class="quality-card" style="border-left: 4px solid ${color}">
          <div class="quality-label">
            <span class="badge" style="background: ${color}">${quality}</span>
            <span class="details">${container.toUpperCase()} • ${size} • ${fps} ${bitrate}</span>
          </div>
          <div class="download-actions">
            <a href="/download?url=${encodeURIComponent(videoUrl)}&itag=${f.itag}" class="btn-download">
              ⬇ Download
            </a>
            <span class="itag">itag: ${f.itag}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Generate audio cards
  function generateAudioCards(formats) {
    if (formats.length === 0) return '<p style="color: #999;">No audio formats available</p>';
    
    return formats.map(f => {
      const quality = f.quality || 'Medium';
      const bitrate = f.bitrate ? `${(f.bitrate / 1000).toFixed(0)} kbps` : '';
      const container = f.container || 'm4a';
      
      return `
        <div class="quality-card audio-card" style="border-left: 4px solid #1DB954;">
          <div class="quality-label">
            <span class="badge" style="background: #1DB954;">🎵 ${quality}</span>
            <span class="details">${container.toUpperCase()} • ${bitrate}</span>
          </div>
          <div class="download-actions">
            <a href="/download?url=${encodeURIComponent(videoUrl)}&itag=${f.itag}" class="btn-download audio">
              ⬇ Download Audio
            </a>
            <span class="itag">itag: ${f.itag}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Format duration
  function formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Download: ${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      background: #0f0f0f;
      color: #fff;
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: #1a1a1a;
      border-radius: 16px;
      padding: 30px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .header {
      display: flex;
      gap: 20px;
      margin-bottom: 30px;
      flex-wrap: wrap;
    }
    .thumbnail {
      flex-shrink: 0;
      width: 200px;
      height: 112px;
      border-radius: 8px;
      overflow: hidden;
      background: #333;
    }
    .thumbnail img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .video-info {
      flex: 1;
      min-width: 200px;
    }
    .video-info h1 {
      font-size: 20px;
      margin-bottom: 8px;
      line-height: 1.3;
    }
    .video-info .meta {
      color: #aaa;
      font-size: 14px;
    }
    .video-info .meta span {
      margin-right: 15px;
    }
    .back-link {
      display: inline-block;
      margin-top: 10px;
      color: #ff0000;
      text-decoration: none;
      font-size: 14px;
    }
    .back-link:hover { text-decoration: underline; }
    
    .section-title {
      font-size: 18px;
      margin: 25px 0 15px;
      padding-bottom: 10px;
      border-bottom: 2px solid #333;
    }
    .section-title .count {
      color: #666;
      font-size: 14px;
      font-weight: normal;
    }
    
    .quality-card {
      background: #222;
      border-radius: 10px;
      padding: 15px 20px;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: background 0.2s;
      flex-wrap: wrap;
      gap: 10px;
    }
    .quality-card:hover {
      background: #2a2a2a;
    }
    .quality-card.audio-card:hover {
      background: #1a2a1a;
    }
    .quality-label {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
    }
    .details {
      color: #888;
      font-size: 13px;
    }
    .download-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .btn-download {
      padding: 8px 20px;
      background: #ff0000;
      color: #fff;
      border: none;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      transition: background 0.2s, transform 0.1s;
      cursor: pointer;
      display: inline-block;
    }
    .btn-download:hover {
      background: #cc0000;
      transform: scale(1.02);
    }
    .btn-download.audio {
      background: #1DB954;
    }
    .btn-download.audio:hover {
      background: #169c45;
    }
    .itag {
      color: #555;
      font-size: 11px;
      font-family: monospace;
    }
    .footer {
      margin-top: 30px;
      text-align: center;
      color: #555;
      font-size: 13px;
      border-top: 1px solid #222;
      padding-top: 20px;
    }
    .footer a {
      color: #666;
      text-decoration: none;
    }
    .footer a:hover { color: #888; }
    
    @media (max-width: 600px) {
      .container { padding: 15px; }
      .header { flex-direction: column; align-items: center; text-align: center; }
      .thumbnail { width: 100%; height: auto; aspect-ratio: 16/9; max-width: 320px; }
      .quality-card { flex-direction: column; align-items: stretch; }
      .download-actions { justify-content: flex-end; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="thumbnail">
        <img src="${thumbnail || 'https://via.placeholder.com/320x180/333/666?text=No+Thumbnail'}" alt="Thumbnail" loading="lazy">
      </div>
      <div class="video-info">
        <h1>${title}</h1>
        <div class="meta">
          <span>👤 ${author}</span>
          <span>⏱ ${formatDuration(videoInfo.duration)}</span>
          <span>👁 ${parseInt(videoInfo.views).toLocaleString()}</span>
        </div>
        <a href="/" class="back-link">← New Download</a>
      </div>
    </div>

    <div class="section-title">
      📹 Video + Audio (Combined)
      <span class="count">${combinedFormats.length} formats</span>
    </div>
    ${generateQualityCards(combinedFormats)}

    ${videoOnlyFormats.length > 0 ? `
    <div class="section-title">
      🎬 Video Only (No Audio)
      <span class="count">${videoOnlyFormats.length} formats</span>
    </div>
    ${generateQualityCards(videoOnlyFormats)}
    ` : ''}

    ${audioFormats.length > 0 ? `
    <div class="section-title">
      🎵 Audio Only
      <span class="count">${audioFormats.length} formats</span>
    </div>
    ${generateAudioCards(audioFormats)}
    ` : ''}

    <div class="footer">
      <a href="/">YouTube Downloader</a> • 
      <a href="/api/health">Health</a> • 
      <a href="https://github.com" target="_blank">GitHub</a>
    </div>
  </div>
</body>
</html>
  `;
}

// Download handler
async function handleDownload(videoUrl, itag) {
  const info = await ytdl.getInfo(videoUrl);
  const format = info.formats.find(f => f.itag == parseInt(itag));
  
  if (!format) {
    throw new Error('Format not found');
  }

  const title = info.videoDetails.title.replace(/[^\w\s]/gi, "");
  const response = await fetch(format.url);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`);
  }

  const filename = `${title}_${format.qualityLabel || 'default'}.${format.container || 'mp4'}`;
  const contentType = format.hasAudio && format.hasVideo ? 'video/mp4' : 
                     format.hasAudio ? 'audio/mpeg' : 'video/mp4';

  return {
    stream: response.body,
    filename,
    contentType,
  };
}

// Main request handler
async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname;
  const params = parseQuery(req.url);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ============================================================
  // ROOT PATH - Show download page with all quality links
  // ============================================================
  if (path === "/" && req.method === "GET") {
    const videoUrl = params.url;

    // If no URL, show search page
    if (!videoUrl) {
      return new Response(`
<!DOCTYPE html>
<html>
<head>
  <title>YouTube Downloader</title>
  <style>
    body { font-family: Arial; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; background: #0f0f0f; color: #fff; }
    h1 { font-size: 32px; }
    h1 span { color: #ff0000; }
    input, button { padding: 12px 20px; font-size: 16px; border-radius: 8px; border: none; }
    input { width: 70%; background: #222; color: #fff; }
    button { width: 25%; background: #ff0000; color: white; cursor: pointer; font-weight: 600; }
    button:hover { background: #cc0000; }
    .example { margin-top: 30px; color: #555; font-size: 14px; }
    .example code { background: #222; padding: 4px 8px; border-radius: 4px; color: #888; }
    .features { margin-top: 40px; display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; }
    .features div { background: #1a1a1a; padding: 15px 25px; border-radius: 10px; border-left: 3px solid #ff0000; }
    .features div strong { color: #ff0000; }
  </style>
</head>
<body>
  <h1>🎬 YouTube <span>Downloader</span></h1>
  <p style="color: #888; margin-bottom: 30px;">Paste a YouTube URL to get download links for all qualities</p>
  <form action="/" method="get">
    <input type="text" name="url" placeholder="https://www.youtube.com/watch?v=..." required />
    <button type="submit">Get Links</button>
  </form>
  <div class="example">
    Example: <code>https://www.youtube.com/watch?v=dQw4w9WgXcQ</code>
  </div>
  <div class="features">
    <div><strong>🎥 360p</strong> to <strong>4K</strong></div>
    <div><strong>🎵</strong> Audio Only</div>
    <div><strong>⚡</strong> Fast Downloads</div>
  </div>
</body>
</html>
      `, {
        headers: { "Content-Type": "text/html", ...corsHeaders },
      });
    }

    // Get video info and generate download page
    try {
      const videoInfo = await getVideoInfo(videoUrl);
      const html = generateDownloadPage(videoInfo, videoUrl);
      return new Response(html, {
        headers: { "Content-Type": "text/html", ...corsHeaders },
      });
    } catch (err) {
      return new Response(`
<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body style="font-family: Arial; max-width: 600px; margin: 50px auto; text-align: center; background: #0f0f0f; color: #fff;">
  <h2 style="color: #ff0000;">❌ Error</h2>
  <p style="color: #888;">${err.message}</p>
  <a href="/" style="color: #ff0000;">← Try Again</a>
</body>
</html>
      `, {
        status: 500,
        headers: { "Content-Type": "text/html", ...corsHeaders },
      });
    }
  }

  // ============================================================
  // DOWNLOAD ENDPOINT - Handles actual file download
  // ============================================================
  if (path === "/download" && req.method === "GET") {
    const videoUrl = params.url;
    const itag = params.itag;

    if (!videoUrl || !itag) {
      return new Response(JSON.stringify({ error: "Missing url or itag" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    try {
      const { stream, filename, contentType } = await handleDownload(videoUrl, itag);
      const headers = {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": contentType,
        ...corsHeaders,
      };
      return new Response(stream, { headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  }

  // ============================================================
  // API ENDPOINTS
  // ============================================================

  // GET /api/info
  if (path === "/api/info" && req.method === "GET") {
    const videoUrl = params.url;
    if (!videoUrl) {
      return new Response(JSON.stringify({ error: "Missing url" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    try {
      const data = await getVideoInfo(videoUrl);
      return new Response(JSON.stringify(data, null, 2), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  }

  // GET /api/download
  if (path === "/api/download" && req.method === "GET") {
    const videoUrl = params.url;
    const itag = params.itag;
    if (!videoUrl || !itag) {
      return new Response(JSON.stringify({ error: "Missing url or itag" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    try {
      const { stream, filename, contentType } = await handleDownload(videoUrl, itag);
      const headers = {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": contentType,
        ...corsHeaders,
      };
      return new Response(stream, { headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  }

  // GET /api/health
  if (path === "/api/health") {
    return new Response("OK", { headers: corsHeaders });
  }

  // 404
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// Start server
Deno.serve(handler, { port: 8000 });
console.log("✅ YouTube Downloader running on Deno Deploy");
console.log("📌 Usage:");
console.log("   https://your-app.deno.dev/?url=YOUTUBE_URL");
console.log("   → Shows all quality download links");
console.log("📌 API:");
console.log("   /api/info?url=YOUTUBE_URL");
console.log("   /api/download?url=YOUTUBE_URL&itag=XXX");
console.log("   /api/health");
