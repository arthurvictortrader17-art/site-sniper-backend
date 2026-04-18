const express = require('express');
const { chromium } = require('playwright');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/snipe', async (req, res) => {
  const { url, mode = 'full' } = req.body;

  if (!url) return res.status(400).json({ error: 'URL is required.' });

  let normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith('http')) normalizedUrl = 'https://' + normalizedUrl;

  try { new URL(normalizedUrl); } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  try {
    console.log(`[Sniper] Targeting: ${normalizedUrl}`);
    const screenshot = await captureScreenshot(normalizedUrl);
    console.log(`[Sniper] Screenshot captured — ${Math.round(screenshot.length / 1024)} KB`);
    const result = await analyzeWithClaude(screenshot, normalizedUrl, mode);
    console.log(`[Sniper] Analysis complete`);
    res.json({ success: true, url: normalizedUrl, ...result });
  } catch (err) {
    console.error('[Sniper] Error:', err.message);
    res.status(500).json({ error: err.message || 'Internal error.' });
  }
});

async function captureScreenshot(url) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    });
    const page = await context.newPage();
    await page.route('**/*.{woff,woff2,ttf,mp4,webm,ogg}', route => route.abort());
    await page.goto(url, { waitUntil: 'networkidle', timeout: 35000 });
    await page.waitForTimeout(2500);
    const buffer = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 80 });
    return buffer.toString('base64');
  } finally {
    await browser.close();
  }
}

async function analyzeWithClaude(imageBase64, url, mode) {
  const response = await client.messages.create({
   model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    system: buildSystemPrompt(mode),
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: `Analyze the screenshot of this site: ${url}. Return the JSON as instructed.` },
      ],
    }],
  });

  const text = response.content.map(c => c.text || '').join('');
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { prompt: text, elements: [], stack: 'React + Tailwind CSS', sections: [] };
  }
}

function buildSystemPrompt(mode) {
  const base = `You are Site Sniper: an AI expert in analyzing website visual interfaces.
Reply ONLY with valid JSON — no markdown, no text outside the JSON.`;

  if (mode === 'prompt') {
    return `${base}\nReturn: { "prompt": "detailed prompt in Portuguese to recreate the site in Lovable, covering layout, hex colors, typography, components and spacing." }`;
  }

  return `${base}
Return exactly:
{
  "prompt": "detailed prompt in Portuguese to recreate the site in Lovable or v0",
  "stack": "recommended stack e.g.: Next.js + Tailwind CSS",
  "elements": [
    { "type": "primary color", "value": "#hex" },
    { "type": "background color", "value": "#hex" },
    { "type": "text color", "value": "#hex" },
    { "type": "main font", "value": "font name" }
  ],
  "sections": [
    { "name": "section name", "description": "detailed description" }
  ]
}`;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`[Sniper] Server running on port ${PORT}`));
