const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '.env');
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

const CATALOG_PATH = path.join(__dirname, 'catalog.json');

function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

function formatVND(amount) {
  return Number(amount).toLocaleString('vi-VN') + 'đ';
}

/**
 * Recommends vehicle type (4_cho, 7_cho, 16_cho) based on passenger count and luggage
 */
function recommendVehicle(paxCount) {
  if (!paxCount || paxCount <= 3) {
    return { key: '4_cho', label: 'Xe 4 chỗ đời mới (Vios / Accent / Mazda3)' };
  }
  if (paxCount <= 5) {
    return { key: '7_cho', label: 'Xe 7 chỗ rộng rãi (Xpander / Veloz / Fortuner / Carnival)' };
  }
  return { key: '16_cho', label: 'Xe 16 chỗ cao cấp (Ford Transit / Hyundai Solati)' };
}

/**
 * Extracts structured booking info (phone, flight code, pax count, date/time) from customer text
 */
function extractCustomerInfo(text, existingSession = {}) {
  const updated = { ...existingSession };

  // 1. Extract Vietnamese phone number (supports contiguous or dot/space/hyphen-separated digits)
  const phoneMatch = text.match(/(?:\+84|0)[\s.\-]?(?:3|5|7|8|9)(?:[\s.\-]?\d){8}\b/);
  if (phoneMatch) {
    updated.phone = phoneMatch[0].replace(/[\s.\-]/g, '').replace(/^\+84/, '0');
  }

  // 2. Extract Flight Code (VN, VJ, QH, BL, VU + 3-4 digits)
  const flightMatch = text.toUpperCase().match(/\b(VN|VJ|QH|BL|VU|9G)\s*-?\s*\d{2,4}\b/);
  if (flightMatch) {
    updated.flightCode = flightMatch[0].replace(/\s+/g, '');
  }

  // 3. Extract passenger count (e.g. "6 người", "8 khách", "nhà mình 10 người")
  // Strip out "xe 4 chỗ / xe 7 chỗ / xe 16 chỗ" first so vehicle specs aren't mistaken for pax count
  const textWithoutCarSpec = text.replace(/xe\s*(?:du\s*lịch\s*)?\d{1,2}\s*chỗ/gi, '');
  const paxMatch = textWithoutCarSpec.match(/(\d{1,2})\s*(người|khách|ng|pax|vé|chỗ)/i);
  if (paxMatch) {
    const num = parseInt(paxMatch[1], 10);
    if (num >= 1 && num <= 45) {
      updated.paxCount = num;
    }
  }

  // 4. Extract date / time hints
  const dateMatch = text.match(/(?:^|[\s,.;(])(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|ngày mai|hôm nay|ngày kia|cuối tuần|thứ\s*[2-7]|chủ nhật)(?=$|[\s,.;!?)])/i);
  if (dateMatch) {
    updated.travelDate = dateMatch[1].trim();
  }

  const timeMatch = text.match(/\b(\d{1,2}(?:\s*(?:h|:)\s*\d{1,2}|\s*(?:h|giờ)(?:\s+\d{1,2}\s*phút)?)(?:\s*(?:sáng|trưa|chiều|tối|đêm))?)(?=$|[\s,.;!?)])/i);
  if (timeMatch) {
    updated.pickupTime = timeMatch[1].trim().replace(/\s+/g, ' ');
  }

  // 5. Detect service interests
  const lower = text.toLowerCase();
  const interests = new Set(updated.interests || []);
  if (lower.includes('sân bay') || lower.includes('cam ranh') || lower.includes('đón') || lower.includes('tiễn')) {
    interests.add('Xe đưa đón Sân bay Cam Ranh');
  }
  if (lower.includes('vĩnh hy') || lower.includes('hang rái') || lower.includes('đồng cừu')) {
    interests.add('Thuê xe đi Vĩnh Hy - Hang Rái');
  }
  if (lower.includes('đà lạt')) {
    interests.add('Thuê xe Nha Trang - Đà Lạt');
  }
  if (lower.includes('3 đảo') || lower.includes('ba đảo') || lower.includes('cano') || lower.includes('đảo')) {
    interests.add('Tour 3 Đảo VIP Cano');
  }
  if (lower.includes('vinwonder') || lower.includes('vinpearl') || lower.includes('cáp treo')) {
    interests.add('Vé VinWonders Nha Trang');
  }
  if (lower.includes('hòn tằm') || lower.includes('tắm bùn')) {
    interests.add('Vé Hòn Tằm Tắm Bùn');
  }
  if (lower.includes('lịch trình') || lower.includes('tư vấn') || lower.includes('3n2đ') || lower.includes('4n3đ')) {
    interests.add('Tư vấn Lịch trình & Combo');
  }
  updated.interests = Array.from(interests);

  return updated;
}

/**
 * Generates a response using DeepSeek API (DEEPSEEK_API_KEY) or Gemini API (GEMINI_API_KEY) if configured,
 * or falls back to the built-in smart Nha Trang consultant rule engine.
 */
async function generateAIResponse(userText, session = {}) {
  const catalog = loadCatalog();
  const updatedSession = extractCustomerInfo(userText, session);

  // 1. DeepSeek API (OpenAI-compatible endpoint: https://api.deepseek.com/chat/completions)
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const systemInstruction = buildSystemPrompt(catalog, updatedSession);
      const res = await fetch(
        process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
          },
          body: JSON.stringify({
            model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: userText }
            ],
            temperature: 0.4,
            max_tokens: 600
          })
        }
      );
      if (res.ok) {
        const data = await res.json();
        const replyText = data?.choices?.[0]?.message?.content;
        if (replyText) {
          return {
            reply: replyText.replace(/\*\*/g, '').trim(),
            quickReplies: getSuggestedQuickReplies(userText, updatedSession),
            session: updatedSession,
            provider: 'deepseek'
          };
        }
      }
    } catch (err) {
      console.error('DeepSeek API error, falling back:', err.message);
    }
  }

  // 2. Gemini API
  if (process.env.GEMINI_API_KEY) {
    try {
      const systemInstruction = buildSystemPrompt(catalog, updatedSession);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: 'user', parts: [{ text: userText }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 600 }
          })
        }
      );
      if (res.ok) {
        const data = await res.json();
        const replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (replyText) {
          return {
            reply: replyText.replace(/\*\*/g, '').trim(),
            quickReplies: getSuggestedQuickReplies(userText, updatedSession),
            session: updatedSession,
            provider: 'gemini'
          };
        }
      }
    } catch (err) {
      console.error('Gemini API error, using built-in smart engine:', err.message);
    }
  }

  // Built-in smart Nha Trang Car & Tour AI engine
  const reply = buildSmartRuleReply(userText, catalog, updatedSession);
  return {
    reply,
    quickReplies: getSuggestedQuickReplies(userText, updatedSession),
    session: updatedSession,
    provider: 'rules'
  };
}

function buildSystemPrompt(catalog, session) {
  return `Bạn là Trợ lý AI tư vấn & chốt đơn trên Fanpage Facebook của "${catalog.brandName}" (Chuyên xe du lịch 4-7-16 chỗ & Đại lý vé Tour Nha Trang).
Bảng giá chuẩn hiện tại:
${JSON.stringify(catalog, null, 2)}

Thông tin khách hàng đã thu thập được trong hội thoại:
${JSON.stringify(session, null, 2)}

Nguyên tắc trả lời trên Facebook Messenger:
1. Thân thiện, nhiệt tình như người bản địa Nha Trang, ngắn gọn, dễ đọc trên điện thoại (dùng gạch đầu dòng • và emoji hợp lý, KHÔNG dùng ký tự Markdown ** hoặc #).
2. Nếu khách hỏi số lượng người (từ 1-16 người), tự động gợi ý dòng xe phù hợp (1-3 khách: 4 chỗ; 4-5 khách có hành lý: 7 chỗ; 6-15 khách: 16 chỗ) và báo giá chính xác từ bảng giá.
3. Luôn khéo léo giới thiệu ưu đãi COMBO: Đặt xe sân bay/xe riêng kèm Vé Tour (3 đảo VIP, VinWonders, Hòn Tằm) được giảm ngay ${formatVND(catalog.comboFlatDiscountVnd)}/chuyến xe.
4. Để chốt đơn, luôn hỏi xin: Số điện thoại/Zalo, Ngày giờ đón, Mã chuyến bay (nếu đón sân bay Cam Ranh) và Số lượng khách.`;
}

function buildSmartRuleReply(userText, catalog, session) {
  const lower = userText.toLowerCase();
  const pax = session.paxCount || null;
  const recCar = recommendVehicle(pax || 4);

  // Case 1: Customer provides phone number -> Confirm booking immediately!
  if (/(?:\+84|0)[\s.\-]?(?:3|5|7|8|9)(?:[\s.\-]?\d){8}\b/.test(userText)) {
    return (
      `✅ Dạ em đã ghi nhận thông tin đặt dịch vụ của anh/chị:\n` +
      `• 📞 SĐT/Zalo: ${session.phone}\n` +
      (session.paxCount ? `• 👥 Số lượng khách: ${session.paxCount} người (${recCar.label})\n` : '') +
      (session.flightCode ? `• ✈️ Mã chuyến bay: ${session.flightCode}\n` : '') +
      (session.travelDate ? `• 📅 Ngày đi: ${session.travelDate} ${session.pickupTime || ''}\n` : '') +
      (session.interests?.length ? `• 🌴 Dịch vụ quan tâm: ${session.interests.join(', ')}\n` : '') +
      `\nĐiều hành xe & vé bên em sẽ liên hệ qua Zalo/SĐT của mình trong 2 phút nữa để xác nhận biển số xe và gửi mã vé nhé ạ! Cần hỗ trợ gấp anh/chị gọi Hotline ${catalog.hotline} nha!`
    );
  }

  // Case 2: Asking for itinerary / Lịch trình + Combo
  if (lower.includes('lịch trình') || lower.includes('3n2đ') || lower.includes('4n3đ') || lower.includes('combo')) {
    const count = pax || 6;
    const car = recommendVehicle(count);
    const airport2Way = catalog.cars.find(c => c.id === 'cam_ranh_2way').prices[car.key];
    const tour3Dao = catalog.tours.find(t => t.id === 'tour_3_dao_vip').adultPrice;
    const vinPrice = catalog.tours.find(t => t.id === 'vinwonders_nt').adultPrice;
    const comboTotal = airport2Way + (tour3Dao * count) - catalog.comboFlatDiscountVnd;

    return (
      `🌴 GỢI Ý LỊCH TRÌNH NHA TRANG 3N2Đ ĐƯỢC YÊU THÍCH NHẤT (Dành cho đoàn ${count} khách - đi ${car.label}):\n\n` +
      `🔹 Ngày 1: Đón sân bay Cam Ranh về khách sạn → Chiều đi Tháp Bà Ponagar, Nhà Thờ Đá, tắm bùn hoặc dạo biển Trần Phú.\n` +
      `🔹 Ngày 2: Đi Tour 3 Đảo VIP Cano (${formatVND(tour3Dao)}/khách: Ăn trưa hải sản + Tắm bùn Hòn Tằm) hoặc vui chơi trọn gói VinWonders (${formatVND(vinPrice)}/khách).\n` +
      `🔹 Ngày 3: Mua đặc sản Chợ Đầm / Yến Sào → Xe tiễn đoàn ra Sân bay Cam Ranh.\n\n` +
      `🎁 BÁO GIÁ COMBO TIẾT KIỆM (${count} khách):\n` +
      `• Xe riêng ${car.key.replace('_', ' ')} đưa đón sân bay 2 chiều: ${formatVND(airport2Way)}\n` +
      `• Tour 3 Đảo VIP Cano (${count} vé): ${formatVND(tour3Dao * count)}\n` +
      `• Ưu đãi đặt kèm Xe + Tour: Giảm ngay -${formatVND(catalog.comboFlatDiscountVnd)}\n` +
      `👉 Tổng Combo trọn gói: ${formatVND(comboTotal)}\n\n` +
      `Anh/chị dự kiến đi ngày nào và đoàn mình có trẻ em (dưới 1m4) không để em tính giá vé trẻ em ưu đãi hơn ạ?`
    );
  }

  // Case 3: Airport transfer or Car rental
  if (
    lower.includes('sân bay') ||
    lower.includes('cam ranh') ||
    lower.includes('xe') ||
    lower.includes('vĩnh hy') ||
    lower.includes('đà lạt')
  ) {
    const camRanh1 = catalog.cars.find(c => c.id === 'cam_ranh_1way');
    const camRanh2 = catalog.cars.find(c => c.id === 'cam_ranh_2way');
    const vinhHy = catalog.cars.find(c => c.id === 'vinh_hy_day');
    const cityFull = catalog.cars.find(c => c.id === 'city_tour_full');

    let specificNotice = '';
    if (pax) {
      specificNotice = `\n💡 Với đoàn ${pax} người, anh/chị đi ${recCar.label} là thoải mái nhất (Giá đón sân bay chỉ ${formatVND(camRanh1.prices[recCar.key])}/chiều).\n`;
    }

    return (
      `🚖 BẢNG GIÁ XE RIÊNG ĐỜI MỚI NHA TRANG (Trọn gói cầu đường, bến bãi - Không phụ phí):\n` +
      specificNotice +
      `\n1️⃣ Đưa/Đón Sân bay Cam Ranh ⇄ Nha Trang (1 chiều / Khứ hồi):\n` +
      `• Xe 4 chỗ: ${formatVND(camRanh1.prices['4_cho'])} / ${formatVND(camRanh2.prices['4_cho'])}\n` +
      `• Xe 7 chỗ: ${formatVND(camRanh1.prices['7_cho'])} / ${formatVND(camRanh2.prices['7_cho'])}\n` +
      `• Xe 16 chỗ: ${formatVND(camRanh1.prices['16_cho'])} / ${formatVND(camRanh2.prices['16_cho'])}\n\n` +
      `2️⃣ Thuê xe tham quan theo chuyến:\n` +
      `• City Tour Nha Trang (8 tiếng): 4C ${formatVND(cityFull.prices['4_cho'])} | 7C ${formatVND(cityFull.prices['7_cho'])} | 16C ${formatVND(cityFull.prices['16_cho'])}\n` +
      `• Vĩnh Hy - Hang Rái - Đồng Cừu: 4C ${formatVND(vinhHy.prices['4_cho'])} | 7C ${formatVND(vinhHy.prices['7_cho'])} | 16C ${formatVND(vinhHy.prices['16_cho'])}\n\n` +
      `🎁 Đặc biệt: Giảm ngay ${formatVND(catalog.comboFlatDiscountVnd)} tiền xe khi mua kèm vé VinWonders hoặc Tour Đảo!\n` +
      `Anh/chị cho em xin Số lượng người + Mã chuyến bay (hoặc giờ đón) + SĐT Zalo để em xếp xe đón tận sảnh nhé!`
    );
  }

  // Case 4: Tour tickets (3 đảo, VinWonders, Hòn Tằm, Đảo Khỉ)
  if (
    lower.includes('tour') ||
    lower.includes('đảo') ||
    lower.includes('vinwonder') ||
    lower.includes('vinpearl') ||
    lower.includes('hòn tằm') ||
    lower.includes('tắm bùn') ||
    lower.includes('vé')
  ) {
    const t3d = catalog.tours.find(t => t.id === 'tour_3_dao_vip');
    const vin = catalog.tours.find(t => t.id === 'vinwonders_nt');
    const ht = catalog.tours.find(t => t.id === 'hon_tam_seamud');
    const dk = catalog.tours.find(t => t.id === 'dao_khi_suoi_hoa_lan');

    return (
      `🎟️ BẢNG GIÁ VÉ TOUR & VINWONDERS NHA TRANG (Giá đại lý cấp 1 - Xuất vé QR lấy liền):\n\n` +
      `1️⃣ ${t3d.name}:\n` +
      `   • Người lớn: ${formatVND(t3d.adultPrice)} | Trẻ em (1m-1m39): ${formatVND(t3d.childPrice)}\n` +
      `   • Bao gồm: ${t3d.includes}\n\n` +
      `2️⃣ ${vin.name}:\n` +
      `   • Người lớn: ${formatVND(vin.adultPrice)} | Trẻ em: ${formatVND(vin.childPrice)}\n` +
      `   • Ưu điểm: Vé QR vào thẳng cáp treo, không cần xếp hàng tại quầy!\n\n` +
      `3️⃣ ${ht.name}:\n` +
      `   • Người lớn: ${formatVND(ht.adultPrice)} | Trẻ em: ${formatVND(ht.childPrice)}\n\n` +
      `4️⃣ ${dk.name}:\n` +
      `   • Người lớn: ${formatVND(dk.adultPrice)} | Trẻ em: ${formatVND(dk.childPrice)}\n\n` +
      `🔥 Đặt kèm Xe đưa đón sân bay Cam Ranh được giảm thêm ${formatVND(catalog.comboFlatDiscountVnd)}! Đoàn mình đi mấy người lớn, mấy bé và đi ngày nào để em giữ chỗ cano/xuất vé ạ?`
    );
  }

  // Default welcome & menu
  return (
    `👋 Chào anh/chị! Em là Trợ lý AI của ${catalog.brandName}.\n` +
    `Bên em chuyên phục vụ:\n` +
    `🚖 Xe riêng 4 - 7 - 16 chỗ đời mới: Đưa đón Sân bay Cam Ranh (chỉ từ 250k), City Tour, Vĩnh Hy - Hang Rái, Đà Lạt.\n` +
    `🏝️ Vé Tour Nha Trang giá đại lý: Tour 3 Đảo VIP Cano, Vé VinWonders QR Code, Tắm bùn Hòn Tằm, Đảo Khỉ.\n` +
    `🎁 Ưu đãi Combo: Giảm ngay ${formatVND(catalog.comboFlatDiscountVnd)} khi đặt Xe kèm Vé Tour!\n\n` +
    `Anh/chị đang cần báo giá xe, mua vé tour hay muốn em gợi ý lịch trình theo số người của đoàn mình ạ?`
  );
}

function getSuggestedQuickReplies(userText, session) {
  if (!session.phone) {
    return [
      { title: '🚖 Báo giá Xe Sân bay', payload: 'Báo giá xe đưa đón sân bay Cam Ranh 4-7-16 chỗ' },
      { title: '🏝️ Vé Tour 3 Đảo & VinWonders', payload: 'Báo giá vé Tour 3 đảo VIP và VinWonders Nha Trang' },
      { title: '📋 Gợi ý lịch trình 3N2Đ (6 khách)', payload: 'Tư vấn lịch trình 3N2Đ kèm combo xe và vé cho đoàn 6 người' },
      { title: '✅ Đặt xe ngay (Gửi SĐT)', payload: 'Đặt xe 7 chỗ đón sân bay ngày mai chuyến VJ782, SĐT 0912345678' }
    ];
  }
  return [
    { title: '🏝️ Xem thêm Vé Tour Đảo', payload: 'Báo giá vé Tour 3 đảo VIP và Hòn Tằm' },
    { title: '🚐 Báo giá đi Vĩnh Hy', payload: 'Báo giá thuê xe đi Vĩnh Hy Hang Rái trong ngày' }
  ];
}

module.exports = {
  loadCatalog,
  extractCustomerInfo,
  generateAIResponse,
  recommendVehicle
};
