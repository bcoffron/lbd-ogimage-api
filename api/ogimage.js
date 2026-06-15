// Standalone og:image fetcher for Lunchbox Dad link-in-bio tool
// Fetches a page server-side and extracts its preview image
// No CORS issues since this runs server-side, not in the browser

export default async function handler(req, res) {
  // Allow your link page (and any subdomain) to call this
  const allowedOrigins = [
    'https://links.lunchboxdad.com',
    'https://bcoffron.github.io',
    'https://lunchboxdad.com',
    'https://www.lunchboxdad.com'
  ];
  const origin = req.headers.origin || '';
  if (allowedOrigins.some(o => origin === o)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://links.lunchboxdad.com');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const target = req.query.url;
  if (!target || !/^https?:\/\//i.test(target)) {
    return res.status(400).json({ error: 'Missing or invalid url parameter' });
  }

  try {
    // Fetch the target page with a realistic browser user-agent
    // so sites like Amazon/Walmart serve the full page with og tags
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(target, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(200).json({ image: null, reason: 'fetch failed: ' + response.status });
    }

    const html = await response.text();
    const image = extractImage(html, target);

    // Cache successful results at the edge for 24 hours to reduce repeat fetches
    if (image) {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    }

    return res.status(200).json({ image });
  } catch (err) {
    return res.status(200).json({ image: null, reason: err.name === 'AbortError' ? 'timeout' : 'error' });
  }
}

function extractImage(html, baseUrl) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
    /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']image["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i
  ];

  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) {
      let url = m[1].replace(/&amp;/g, '&').trim();
      if (url.startsWith('//')) url = 'https:' + url;
      if (url.startsWith('/')) {
        try { url = new URL(url, baseUrl).href; } catch (e) {}
      }
      if (url.startsWith('http') && !url.includes('favicon')) {
        return url;
      }
    }
  }

  // Blogger fallback
  const blogger = html.match(/https:\/\/blogger\.googleusercontent\.com\/img\/[^\s"'<>]+/i);
  if (blogger) return blogger[0];

  // Generic: first reasonably large image
  const img = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
  if (img && img[1]) {
    let url = img[1];
    if (url.startsWith('//')) url = 'https:' + url;
    if (url.startsWith('/')) {
      try { url = new URL(url, baseUrl).href; } catch (e) {}
    }
    if (url.startsWith('http') && !url.includes('favicon') && !url.includes('logo')) {
      return url;
    }
  }

  return null;
}
