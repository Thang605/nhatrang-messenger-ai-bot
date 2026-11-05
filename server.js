const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { generateAIResponse, loadCatalog } = require('./ai_engine');

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'nhatrang_xe_tour_verify_2026';
const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const LEADS_FILE = path.join(__dirname, 'leads.json');
const CATALOG_FILE = path.join(__dirname, 'catalog.json');

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

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
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
    const mode = parsedUrl.query['hub.mode'];
    const token = parsedUrl.query['hub.verify_token'];
    const challenge = parsedUrl.query['hub.challenge'];

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

  // 4. Leads API (GET /api/leads)
  if (pathname === '/api/leads' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(readLeads()));
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

  // Healthcheck
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify({
      service: 'Nha Trang Car (<=16 seats) & Tour AI Messenger Webhook',
      status: 'running',
      webhookEndpoint: '/webhook'
    })
  );
});

server.listen(PORT, () => {
  console.log(`🚀 Nha Trang AI Messenger Bot running on http://localhost:${PORT}`);
  console.log(`🔗 Facebook Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`🔑 Verify Token: ${VERIFY_TOKEN}`);
});
