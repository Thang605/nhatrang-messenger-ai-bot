const http = require('http');
const fs = require('fs');
const path = require('path');
const { generateAIResponse, loadCatalog } = require('./ai_engine');
let brandAssets = { LOGO_BASE64: '', BANNER_BASE64: '' };
try {
  brandAssets = require('./assets');
} catch (_) {}

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'nhatrang_xe_tour_verify_2026';
const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const LEADS_FILE = path.join(__dirname, 'leads.json');
const CATALOG_FILE = path.join(__dirname, 'catalog.json');
const DASHBOARD_FILE = path.join(__dirname, 'public', 'index.html');

// In-memory session map keyed by sender PSID
const sessions = new Map();

function readLeads() {
  if (!fs.existsSync(LEADS_FILE)) {
    fs.writeFileSync(LEADS_FILE, JSON.stringify([], null, 2));
  }
  return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
}

function saveLead(senderId, session, lastMessage) {
  const leads = readLeads();
  const existingIdx = leads.findIndex(l => l.senderId === senderId);
  const record = {
    senderId,
    phone: session.phone || null,
    paxCount: session.paxCount || null,
    flightCode: session.flightCode || null,
    travelDate: session.travelDate || null,
    pickupTime: session.pickupTime || null,
    interests: session.interests || [],
    lastMessage,
    updatedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    leads[existingIdx] = { ...leads[existingIdx], ...record };
  } else {
    leads.unshift(record);
  }
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  return record;
}

/**
 * Optional: Sends an image attachment to Facebook Messenger via Graph API
 */
async function sendFacebookImage(recipientPsid, imageUrl) {
  if (!PAGE_ACCESS_TOKEN || !imageUrl) return;
  try {
    await fetch(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(PAGE_ACCESS_TOKEN)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientPsid },
          messaging_type: 'RESPONSE',
          message: {
            attachment: {
              type: 'image',
              payload: { url: imageUrl, is_reusable: true }
            }
          }
        })
      }
    );
  } catch (err) {
    console.error('Facebook Image Send Error:', err.message);
  }
}

/**
 * Sends a text message + quick replies back to Facebook Messenger via Graph API
 */
async function sendFacebookMessage(recipientPsid, text, quickReplies = []) {
  if (!PAGE_ACCESS_TOKEN) {
    console.log(`[SIMULATION - No FB_PAGE_ACCESS_TOKEN] To ${recipientPsid}:`, text);
    return;
  }

  const messagePayload = { text };
  if (quickReplies && quickReplies.length > 0) {
    messagePayload.quick_replies = quickReplies.slice(0, 10).map(qr => ({
      content_type: 'text',
      title: qr.title.slice(0, 20),
      payload: qr.payload
    }));
  }

  const res = await fetch(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(PAGE_ACCESS_TOKEN)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientPsid },
        messaging_type: 'RESPONSE',
        message: messagePayload
      })
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error('Facebook Send API Error:', errText);
  }
}

/**
 * Optional: Alerts the owner via Telegram when a customer leaves a phone number on Fanpage
 */
async function notifyOwnerNewLead(lead) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !lead.phone) return;
  const msg =
    `🚨 KHÁCH ĐẶT XE / TOUR MỚI TỪ FACEBOOK!\n` +
    `📞 SĐT: ${lead.phone}\n` +
    `👥 Số khách: ${lead.paxCount || 'Chưa rõ'}\n` +
    `✈️ Chuyến bay: ${lead.flightCode || 'Không có'}\n` +
    `📅 Ngày/Giờ: ${lead.travelDate || ''} ${lead.pickupTime || ''}\n` +
    `🌴 Dịch vụ: ${(lead.interests || []).join(', ')}\n` +
    `💬 Tin nhắn: "${lead.lastMessage}"`;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg })
    });
  } catch (err) {
    console.error('Telegram notification error:', err.message);
  }
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0284c7"/>
      <stop offset="55%" stop-color="#0369a1"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="100%" stop-color="#f97316"/>
    </linearGradient>
  </defs>
  <circle cx="200" cy="200" r="192" fill="url(#bg)" stroke="#38bdf8" stroke-width="10"/>
  <circle cx="200" cy="135" r="58" fill="url(#sun)" opacity="0.92"/>
  <path d="M40 235 Q120 205 200 230 T360 225 L360 360 L40 360 Z" fill="#0ea5e9" opacity="0.45"/>
  <path d="M105 225 L145 180 L255 180 L295 225 L325 232 L325 268 L75 268 L75 232 Z" fill="#ffffff"/>
  <path d="M125 220 L152 190 L248 190 L275 220 Z" fill="#0f172a"/>
  <circle cx="130" cy="268" r="24" fill="#0f172a" stroke="#38bdf8" stroke-width="6"/>
  <circle cx="270" cy="268" r="24" fill="#0f172a" stroke="#38bdf8" stroke-width="6"/>
  <text x="200" y="322" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="900" fill="#ffffff" text-anchor="middle">XE &amp; TOUR</text>
  <text x="200" y="352" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="800" fill="#fde047" text-anchor="middle">NHA TRANG</text>
</svg>`;

const BANNER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420" width="1200" height="420">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="50%" stop-color="#0369a1"/>
      <stop offset="100%" stop-color="#0ea5e9"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="100%" stop-color="#fb923c"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="420" fill="url(#sky)"/>
  <circle cx="980" cy="110" r="75" fill="url(#gold)" opacity="0.85"/>
  <path d="M0 290 Q300 240 600 285 T1200 270 L1200 420 L0 420 Z" fill="#0284c7" opacity="0.55"/>
  <path d="M0 330 Q400 290 800 335 T1200 320 L1200 420 L0 420 Z" fill="#0f172a" opacity="0.85"/>
  <g transform="translate(760, 185)">
    <rect x="20" y="45" width="340" height="85" rx="22" fill="#ffffff"/>
    <path d="M65 48 L115 8 L285 8 L330 48 Z" fill="#e2e8f0"/>
    <path d="M80 44 L120 15 L275 15 L312 44 Z" fill="#0f172a"/>
    <circle cx="95" cy="130" r="28" fill="#0f172a" stroke="#38bdf8" stroke-width="7"/>
    <circle cx="290" cy="130" r="28" fill="#0f172a" stroke="#38bdf8" stroke-width="7"/>
  </g>
  <text x="60" y="110" font-family="Segoe UI, Arial, sans-serif" font-size="44" font-weight="900" fill="#ffffff">XE &amp; TOUR DU LỊCH NHA TRANG</text>
  <text x="60" y="165" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700" fill="#fde047">🚖 Xe Hợp Đồng 4 - 7 - 16 Chỗ Đón Tiễn Sân Bay Cam Ranh</text>
  <text x="60" y="212" font-family="Segoe UI, Arial, sans-serif" font-size="26" font-weight="600" fill="#e0f2fe">🏝️ Cano Tour 3 Đảo VIP • Hòn Tằm • VinWonders • City Tour</text>
  <rect x="60" y="245" width="470" height="58" rx="29" fill="#22c55e"/>
  <text x="295" y="283" font-family="Segoe UI, Arial, sans-serif" font-size="26" font-weight="900" fill="#052e16" text-anchor="middle">📞 HOTLINE / ZALO: 0382.883.456</text>
</svg>`;

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Enable CORS for local simulator / dashboard
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // 1. Facebook Webhook Verification (GET /webhook)
  if (pathname === '/webhook' && req.method === 'GET') {
    const mode = parsedUrl.searchParams.get('hub.mode');
    const token = parsedUrl.searchParams.get('hub.verify_token');
    const challenge = parsedUrl.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Facebook Webhook verified successfully!');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(challenge);
    }
    res.writeHead(403);
    return res.end('Forbidden: Invalid verify token');
  }

  // 2. Facebook Webhook Event Receiver (POST /webhook)
  if (pathname === '/webhook' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (body.object === 'page') {
        // Acknowledge immediately as required by Meta
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('EVENT_RECEIVED');

        for (const entry of body.entry || []) {
          const webhookEvent = (entry.messaging || [])[0];
          if (!webhookEvent) continue;

          const senderPsid = webhookEvent.sender?.id;
          let userText = '';

          if (webhookEvent.message && !webhookEvent.message.is_echo) {
            userText = webhookEvent.message.quick_reply?.payload || webhookEvent.message.text || '';
          } else if (webhookEvent.postback) {
            userText = webhookEvent.postback.payload || webhookEvent.postback.title || '';
          }

          if (senderPsid && userText) {
            const prevSession = sessions.get(senderPsid) || {};
            const result = await generateAIResponse(userText, prevSession);
            result.session.sentWelcomeImage = true;
            sessions.set(senderPsid, result.session);

            if (
              result.session.phone ||
              result.session.flightCode ||
              (result.session.interests && result.session.interests.length > 0)
            ) {
              const saved = saveLead(senderPsid, result.session, userText);
              if (result.session.phone && !prevSession.phone) {
                await notifyOwnerNewLead(saved);
              }
            }

            if (!prevSession.sentWelcomeImage) {
              const publicOrigin = `https://${req.headers.host || 'nhatrang-messenger-ai-bot.onrender.com'}`;
              await sendFacebookImage(senderPsid, `${publicOrigin}/banner.png`);
            }
            await sendFacebookMessage(senderPsid, result.reply, result.quickReplies);
          }
        }
        return;
      }
      res.writeHead(404);
      return res.end();
    } catch (err) {
      console.error('Webhook POST error:', err);
      res.writeHead(500);
      return res.end('Internal Server Error');
    }
  }

  // 3. Test / Simulator Chat Endpoint (POST /api/chat)
  if (pathname === '/api/chat' && req.method === 'POST') {
    try {
      const { senderId = 'demo_user', message = '' } = await parseJsonBody(req);
      const prevSession = sessions.get(senderId) || {};
      const result = await generateAIResponse(message, prevSession);
      sessions.set(senderId, result.session);

      let lead = null;
      if (
        result.session.phone ||
        result.session.flightCode ||
        (result.session.interests && result.session.interests.length > 0)
      ) {
        lead = saveLead(senderId, result.session, message);
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ...result, lead }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // 4. Leads API with Search & Filter (GET /api/leads?q=...&hasPhone=1&service=...)
  if (pathname === '/api/leads' && req.method === 'GET') {
    const q = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase();
    const hasPhone = parsedUrl.searchParams.get('hasPhone');
    const serviceFilter = (parsedUrl.searchParams.get('service') || '').trim().toLowerCase();

    let leads = readLeads();
    if (hasPhone === '1' || hasPhone === 'true') {
      leads = leads.filter(l => Boolean(l.phone));
    }
    if (serviceFilter) {
      leads = leads.filter(l =>
        (l.interests || []).some(i => i.toLowerCase().includes(serviceFilter))
      );
    }
    if (q) {
      leads = leads.filter(l => {
        const haystack = [
          l.senderId,
          l.phone,
          l.flightCode,
          l.travelDate,
          l.pickupTime,
          ...(l.interests || []),
          l.lastMessage
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(leads));
  }

  // 4b. Privacy Policy page for Meta App Live Mode (GET /privacy)
  if (pathname === '/privacy' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>Chính sách quyền riêng tư - Xe & Tour Du Lịch Nha Trang</title></head><body style="font-family:sans-serif;max-width:720px;margin:40px auto;line-height:1.6;padding:0 16px;"><h1>Chính sách quyền riêng tư (Privacy Policy)</h1><p>Ứng dụng <strong>Nha Trang Xe Tour AI Bot</strong> hỗ trợ tư vấn tự động dịch vụ xe hợp đồng 4-7-16 chỗ đưa đón sân bay Cam Ranh và Tour đảo Nha Trang trên trang Facebook Fanpage <strong>Xe & Tour Du Lịch Nha Trang</strong>.</p><h2>1. Dữ liệu thu thập</h2><p>Chúng tôi chỉ ghi nhận các thông tin do khách hàng chủ động cung cấp trong cuộc trò chuyện Messenger (Số điện thoại liên hệ, Mã chuyến bay, Ngày giờ đón, Số lượng hành khách và nhu cầu dịch vụ) nhằm mục đích điều phối xe và xác nhận đặt dịch vụ.</p><h2>2. Sử dụng & Bảo mật dữ liệu</h2><p>Thông tin khách hàng chỉ được sử dụng nội bộ bởi bộ phận điều hành xe/tour Nha Trang (Hotline/Zalo: 0382.883.456) và tuyệt đối không chia sẻ hay bán cho bên thứ ba.</p><h2>3. Yêu cầu xóa dữ liệu</h2><p>Khách hàng có thể yêu cầu xóa toàn bộ dữ liệu liên hệ bất cứ lúc nào bằng cách nhắn tin trực tiếp lên Fanpage hoặc liên hệ Hotline/Zalo: <strong>0382.883.456</strong>.</p></body></html>`);
  }

  // 5. Catalog API (GET / PUT /api/catalog)
  if (pathname === '/api/catalog' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(loadCatalog()));
  }

  if (pathname === '/api/catalog' && req.method === 'PUT') {
    try {
      const updatedCatalog = await parseJsonBody(req);
      fs.writeFileSync(CATALOG_FILE, JSON.stringify(updatedCatalog, null, 2));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ status: 'ok', catalog: updatedCatalog }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // 6. Static Assets in /public (logo.png, banner.png, logo.jpg, banner.jpg)
  if (
    req.method === 'GET' &&
    (pathname === '/logo.png' ||
      pathname === '/logo.jpg' ||
      pathname === '/banner.png' ||
      pathname === '/banner.jpg' ||
      pathname === '/public/logo.png' ||
      pathname === '/public/banner.png')
  ) {
    const isLogo = pathname.includes('logo');
    const jpgPath = path.join(__dirname, 'public', isLogo ? 'logo.jpg' : 'banner.jpg');
    const pngPath = path.join(__dirname, 'public', isLogo ? 'logo.png' : 'banner.png');
    if (fs.existsSync(jpgPath)) {
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600'
      });
      return res.end(fs.readFileSync(jpgPath));
    }
    if (fs.existsSync(pngPath)) {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600'
      });
      return res.end(fs.readFileSync(pngPath));
    }
    const b64 = isLogo ? brandAssets.LOGO_BASE64 : brandAssets.BANNER_BASE64;
    if (b64) {
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600'
      });
      return res.end(Buffer.from(b64, 'base64'));
    }
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    });
    return res.end(isLogo ? LOGO_SVG : BANNER_SVG);
  }

  // 6b. Serve server.js for automated sync
  if (req.method === 'GET' && pathname === '/server.js') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'));
  }

  // 7. Web Dashboard & Simulator UI (GET /) when requested by browser
  if (pathname === '/' && req.method === 'GET' && parsedUrl.searchParams.get('format') !== 'json') {
    const accept = req.headers.accept || '';
    if (accept.includes('text/html') && fs.existsSync(DASHBOARD_FILE)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(DASHBOARD_FILE, 'utf8'));
    }
  }

  // 7. Healthcheck JSON (GET /health or GET /?format=json or non-HTML client)
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify({
      service: 'Nha Trang Car (<=16 seats) & Tour AI Messenger Webhook',
      status: 'running',
      webhookEndpoint: '/webhook',
      hasPageAccessToken: Boolean(PAGE_ACCESS_TOKEN),
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY)
    })
  );
});

server.listen(PORT, () => {
  console.log(`🚀 Nha Trang AI Messenger Bot running on http://localhost:${PORT}`);
  console.log(`🔗 Facebook Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`🔑 Verify Token: ${VERIFY_TOKEN}`);
});
