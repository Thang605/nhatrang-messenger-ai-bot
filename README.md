# Trợ Lý AI Facebook Messenger: Xe Du Lịch (4 - 7 - 16 Chỗ) & Vé Tour Nha Trang

Hệ thống Backend + Webhook kết nối trực tiếp vào Fanpage Facebook Messenger giúp tự động:
1. **Tư vấn & Báo giá xe 4 - 7 - 16 chỗ:** Đưa đón Sân bay Cam Ranh, City Tour Nha Trang, Vĩnh Hy - Hang Rái, Đà Lạt. Tự động gợi ý cỡ xe theo số lượng khách.
2. **Tư vấn & Báo giá vé Tour Nha Trang:** Tour 3 Đảo VIP Cano, Vé VinWonders QR Code, Tắm bùn Hòn Tằm, Đảo Khỉ - Suối Hoa Lan.
3. **Gợi ý lịch trình & Tính giá Combo:** Tự động tính tổng tiền Xe + Vé Tour và trừ khuyến mãi Combo.
4. **Thu thập thông tin đặt dịch vụ (Lead Capture):** Tự động bóc tách **Số điện thoại, Mã chuyến bay (VJ/VN/QH...), Ngày giờ đón, Số lượng khách** từ tin nhắn của khách và lưu vào `leads.json` (kèm bắn thông báo về Telegram cho điều hành xe).

---

## Cấu trúc thư mục
* `server.js`: Server HTTP xử lý Webhook Facebook (`GET /webhook`, `POST /webhook`) và API quản lý (`POST /api/chat`, `GET /api/leads`, `GET/PUT /api/catalog`). Không cần cài đặt thư viện ngoài (chạy trực tiếp bằng Node.js 18+).
* `ai_engine.js`: Bộ não xử lý ngôn ngữ tự nhiên (hỗ trợ cả **Google Gemini API** và **Bộ quy tắc thông minh tích hợp sẵn**), tự động nhận diện SĐT, mã chuyến bay và tính giá.
* `catalog.json`: Bảng giá xe 4-7-16 chỗ và giá vé các tour Nha Trang (dễ dàng chỉnh sửa bất kỳ lúc nào).

---

## Hướng dẫn kết nối vào Fanpage Facebook (Meta for Developers)

### Bước 1: Triển khai Server lên HTTPS (Miễn phí với Render.com / Railway.app)
Facebook yêu cầu đường dẫn Webhook phải có `https://`.
1. Đẩy thư mục này lên GitHub Repository của bạn.
2. Đăng nhập [Render.com](https://render.com) -> Chọn **New Web Service** -> Kết nối repo GitHub.
3. Điền các biến môi trường (Environment Variables) theo mẫu trong `.env.example`:
   * `FB_VERIFY_TOKEN`: `nhatrang_xe_tour_verify_2026`
   * `FB_PAGE_ACCESS_TOKEN`: *(Lấy ở Bước 2)*
   * `GEMINI_API_KEY`: *(Khóa API Google AI Studio nếu muốn dùng Gemini)*

### Bước 2: Cấp quyền trên Meta for Developers
1. Truy cập [developers.facebook.com](https://developers.facebook.com/apps) -> **Create App** -> Chọn loại **Business (Doanh nghiệp)**.
2. Trong bảng điều khiển App, tìm mục **Messenger** -> Bấm **Set up (Thiết lập)**.
3. Tại phần **Access Tokens (Mã truy cập)**:
   * Bấm **Add or Remove Pages** và chọn Fanpage Xe & Tour Nha Trang của bạn.
   * Bấm **Generate Token**, sao chép mã này dán vào biến `FB_PAGE_ACCESS_TOKEN`.
4. Tại phần **Webhooks**:
   * Bấm **Add Callback URL**:
     * **Callback URL:** `https://<ten-app-cua-ban>.onrender.com/webhook`
     * **Verify Token:** `nhatrang_xe_tour_verify_2026`
   * Bấm **Verify and Save**.
   * Bấm **Add Subscriptions** cho Fanpage và tích chọn: `messages`, `messaging_postbacks`.
