const express = require('express');
const { chromium } = require('playwright');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

  if (!url) return res.status(400).json({ error: 'URL obrigatória.' });

  let normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith('http')) normalizedUrl = 'https://' + normalizedUrl;

  try { new URL(normalizedUrl); } catch {
    return res.status(400).json({ error: 'URL inválida.' });
  }

  try {
    console.log(`[Sniper] Mirando: ${normalizedUrl}`);
    const screenshot = await captureScreenshot(normalizedUrl);
    console.log(`[Sniper] Print capturado — ${Math.round(screenshot.length / 1024)} KB`);
    const result = await analyzeWithGemini(screenshot, normalizedUrl, mode);
    console.log(`[Sniper] Análise concluída`);
    res.json({ success: true, url: normalizedUrl, ...result });
  } catch (err) {
    console.error('[Sniper] Erro:', err.message);
    res.status(500).json({ error: err.message || 'Erro interno.' });
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

async function analyzeWithGemini(imageBase64, url, mode) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = buildPrompt(mode, url);

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageBase64,
      },
    },
  ]);

  const text = result.response.text();

  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { prompt: text, elements: [], stack: 'React + Tailwind CSS', sections: [] };
  }
}

function buildPrompt(mode, url) {
  const base = `Você é o Site Sniper: especialista em analisar interfaces visuais de sites.
Analise o screenshot do site ${url} com atenção de um designer sênior.
Responda APENAS com JSON válido — sem markdown, sem texto fora do JSON.`;

  if (mode === 'prompt') {
    return `${base}
Retorne: { "prompt": "prompt detalhado em português para recriar o site no Lovable, cobrindo layout, cores hex, tipografia, componentes e espaçamentos." }`;
  }

  return `${base}
Retorne exatamente:
{
  "prompt": "prompt detalhado em português para recriar o site no Lovable ou v0",
  "stack": "stack recomendada ex: Next.js + Tailwind CSS",
  "elements": [
    { "type": "cor primária", "value": "#hex" },
    { "type": "cor de fundo", "value": "#hex" },
    { "type": "cor do texto", "value": "#hex" },
    { "type": "fonte principal", "value": "nome da fonte" }
  ],
  "sections": [
    { "name": "nome da seção", "description": "descrição detalhada" }
  ]
}`;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`[Sniper] Servidor na porta ${PORT}`));
