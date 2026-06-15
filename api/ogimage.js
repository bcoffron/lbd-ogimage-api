// Standalone og:image fetcher for Lunchbox Dad link-in-bio tool
// Fetches a page server-side and extracts its preview image
// No CORS issues since this runs server-side, not in the browser

export default async function handler(req, res) {
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

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let target = req.query.url;
  if (!target) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  // Auto-add https:// if missing
  if (!/^https?:\/\//i.test(target)) {
    target = 'https://' + target;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(target, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(200).json({ image: null, reason: 'fetch failed: ' + response.status });
    }

    const html = await response.text();
    const image = extractImage(html, target);

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

  // Amazon-specific: landingImage or main product image
  const amazonImg = html.match(/"(?:hiRes|large)":"(https:\/\/[^"]+\.jpg)"/i) ||
                    html.match(/data-old-hires=["'](https:\/\/[^"']+)["']/i) ||
                    html.match(/id=["']landingImage["'][^>]+src=["'](https:\/\/[^"']+)["']/i);
  if (amazonImg && amazonImg[1]) return amazonImg[1];

  // Walmart-specific: look for og image in JSON
  const walmartImg = html.match(/"image":\s*"(https:\/\/i5\.walmartimages\.com\/[^"]+)"/i);
  if (walmartImg && walmartImg[1]) return walmartImg[1].replace(/\\u002F/g, '/');

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
