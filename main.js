// Main.js - YouTube Video Downloader API
// Uses public proxy APIs to bypass YouTube bot detection

const QUALITY_MAP = {
  high: '1080',
  medium: '720',
  low: '480'
};

// Extract video ID from URL
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&?#]+)/,
    /youtube\.com\/shorts\/([^&?#]+)/,
    /youtube\.com\/live\/([^&?#]+)/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  throw new Error("Invalid YouTube URL");
}

// Strategy 1: Vevioz API (free, reliable)
async function fetchWithVevioz(videoId) {
  const url = `https://api.vevioz.com/api/button/mp3/${videoId}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Vevioz API returned ${response.status}`);
  }

  const data = await response.json();
  
  // Vevioz returns video and audio links
  if (!data.video || !data.video.length) {
    throw new Error('No video links found');
  }

  // Transform to our format
  const formats = data.video.map(v => ({
    url: v.link,
    height: parseInt(v.quality) || 720,
    qualityLabel: `${v.quality}p`,
    bitrate: 0,
    mimeType: 'video/mp4',
    itag: 0
  }));

  return {
    videoDetails: {
      title: data.title || 'Video',
      videoId: videoId
    },
    streamingData: {
      formats: formats,
      adaptiveFormats: []
    }
  };
}

// Strategy 2: YTDownload API
async function fetchWithYTDownload(videoId) {
  const url = `https://yt-api.com/api/convert?url=https://youtu.be/${videoId}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`YTDownload API returned ${response.status}`);
  }

  const data = await response.json();
  
  if (!data.video) {
    throw new Error('No video data found');
  }

  const formats = data.video.map(v => ({
    url: v.url,
    height: parseInt(v.quality) || 720,
    qualityLabel: v.quality || '720p',
    bitrate: 0,
    mimeType: 'video/mp4',
    itag: 0
  }));

  return {
    videoDetails: {
      title: data.title || 'Video',
      videoId: videoId
    },
    streamingData: {
      formats: formats,
      adaptiveFormats: []
    }
  };
}

// Strategy 3: SaveFrom.net API
async function fetchWithSaveFrom(videoId) {
  const url = `https://en.savefrom.net/api/savefrom/v2?url=https://youtu.be/${videoId}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`SaveFrom API returned ${response.status}`);
  }

  const data = await response.json();
  
  if (!data.success || !data.video) {
    throw new Error('No video data found');
  }

  const formats = data.video.map(v => ({
    url: v.url,
    height: parseInt(v.quality) || 720,
    qualityLabel: v.quality || '720p',
    bitrate: 0,
    mimeType: 'video/mp4',
    itag: 0
  }));

  return {
    videoDetails: {
      title: data.title || 'Video',
      videoId: videoId
    },
    streamingData: {
      formats: formats,
      adaptiveFormats: []
    }
  };
}

// Try all strategies
async function getVideoInfo(videoId) {
  const errors = [];
  const strategies = [
    { name: 'Vevioz', fn: () => fetchWithVevioz(videoId) },
    { name: 'YTDownload', fn: () => fetchWithYTDownload(videoId) },
    { name: 'SaveFrom', fn: () => fetchWithSaveFrom(videoId) }
  ];

  for (const strategy of strategies) {
    try {
      console.log(`🔄 Trying ${strategy.name}...`);
      const data = await strategy.fn();
      
      if (data.streamingData?.formats?.length > 0) {
        console.log(`✅ ${strategy.name} succeeded`);
        return data;
      }
      errors.push(`${strategy.name}: No formats found`);
    } catch (error) {
      errors.push(`${strategy.name}: ${error.message}`);
      console.log(`❌ ${strategy.name} failed: ${error.message}`);
    }
  }

  throw new Error(`All strategies failed:\n${errors.join('\n')}`);
}

// Select format based on quality
function selectFormat(data, quality) {
  const formats = data.streamingData?.formats || [];
  
  if (formats.length === 0) {
    throw new Error('No video formats available');
  }

  // Sort by height descending
  formats.sort((a, b) => b.height - a.height);

  const targetHeight = parseInt(QUALITY_MAP[quality]) || 720;

  // Find best match
  let best = formats.find(f => f.height >= targetHeight);
  if (!best) {
    best = formats[0]; // Take highest available
  }

  console.log(`Selected: ${best.height}p (target: ${targetHeight}p)`);
  return best;
}

// Stream video
async function streamVideo(url, rangeHeader) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'close'
  };
  
  if (rangeHeader) {
    headers['Range'] = rangeHeader;
  }

  const response = await fetch(url, { headers });

  if (!response.ok && response.status !== 206) {
    throw new Error(`Stream fetch failed: ${response.status}`);
  }

  return response;
}

// Main handler
async function handleRequest(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  // Health check
  if (path === '/health') {
    return new Response(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'Using Vevioz, YTDownload, and SaveFrom APIs'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  if ((path === '/' || path === '/download') && req.method === 'GET') {
    const videoUrl = url.searchParams.get('url');
    const quality = url.searchParams.get('quality') || 'medium';

    if (!videoUrl) {
      return new Response(JSON.stringify({
        name: 'YouTube Downloader API',
        version: '3.0 - Proxy Based',
        description: 'Uses public APIs to bypass bot detection',
        usage: '?url=YOUTUBE_URL&quality=high|medium|low',
        example: '/?url=https://youtu.be/dQw4w9WgXcQ&quality=high',
        health: '/health'
      }, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    try {
      const videoId = extractVideoId(videoUrl);
      console.log(`📹 Processing: ${videoId}, quality: ${quality}`);

      const data = await getVideoInfo(videoId);
      const format = selectFormat(data, quality);
      
      const title = data.videoDetails?.title || 'video';
      const cleanTitle = title.replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'video';
      const filename = `${cleanTitle}_${quality}.mp4`;

      console.log(`📤 Streaming: ${filename}`);

      const rangeHeader = req.headers.get('range') || undefined;
      const streamResponse = await streamVideo(format.url, rangeHeader);

      const responseHeaders = new Headers({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'Connection': 'close'
      });

      const headersToForward = ['content-range', 'content-length', 'content-type'];
      for (const h of headersToForward) {
        if (streamResponse.headers.has(h)) {
          responseHeaders.set(h, streamResponse.headers.get(h));
        }
      }

      if (!responseHeaders.has('content-type')) {
        responseHeaders.set('content-type', 'video/mp4');
      }

      return new Response(streamResponse.body, {
        status: streamResponse.status,
        headers: responseHeaders
      });
    } catch (error) {
      console.error('❌ Error:', error);
      return new Response(JSON.stringify({
        error: error.message || 'Download failed',
        stack: error.stack,
        timestamp: new Date().toISOString()
      }, null, 2), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }

  return new Response(JSON.stringify({ 
    error: 'Not found. Use /?url=YOUR_YOUTUBE_URL' 
  }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// Start server
console.log('🚀 YouTube Downloader API v3.0 starting...');
console.log('📡 Using proxy APIs: Vevioz, YTDownload, SaveFrom');

Deno.serve({
  port: 8000,
  onListen: () => console.log('✅ Server running on port 8000'),
  onError: (error) => {
    console.error('🔥 Server error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}, handleRequest);
