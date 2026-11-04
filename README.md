# 🎮 Hùng Vương Concert: GAME ON — E-Ticket & PayOS System

Hệ thống bán vé điện tử trực tuyến, thanh toán tự động qua **VietQR (PayOS Napas247)**, phát hành vé mã QR ký số **HMAC-SHA256**, tự động gửi Email và quét mã soát vé tại cổng đêm diễn.

> 📖 **Xem tài liệu giải thích chi tiết toàn bộ luồng hoạt động tại đây:**  
> 👉 [**LUONG_HE_THONG.md**](./LUONG_HE_THONG.md) (Có sơ đồ tuần tự Mermaid, giải thích từng mắt xích và cơ chế bảo mật)

---

## ⚡ Điểm Nổi Bật Của Hệ Thống

1. **Tự động hóa 100% (Zero-Touch Fulfillment)**:
   - Khách quét VietQR chuyển tiền $\rightarrow$ PayOS xác nhận trong 2–3 giây $\rightarrow$ Hệ thống tự động chuyển trạng thái `APPROVED`, tự sinh mã vé QR bảo mật và tự động gửi Email cho khách.
   - Ban Tổ Chức không cần thức đêm trực duyệt bill chuyển khoản.
2. **Chi phí vận hành 0đ (100% Serverless)**:
   - Không cần thuê máy chủ riêng (VPS/Cloud Server).
   - Cơ sở dữ liệu: **Google Cloud Firestore** (Hạn mức miễn phí 50.000 đọc / 20.000 ghi mỗi ngày).
   - Backend Bridge & Gửi Mail: **Google Apps Script** chạy trên đám mây của Google.
   - Cổng thanh toán: **PayOS (VietQR Napas247)** miễn phí cho tài khoản cá nhân và tổ chức.
3. **Bảo mật mã vé cấp độ mật mã học (HMAC-SHA256 + CSPRNG Base32)**:
   - Không gian mã vé hơn 70 nghìn tỷ tổ hợp, xác suất đoán mò trúng vé thật là $0,0000000028\%$.
   - Cơ chế **Zero-Knowledge**: Tình nguyện viên duyệt đơn không thể thấy mã vé thật của khách kể cả khi mở F12 DevTools.
4. **Ứng dụng soát vé tại cổng đêm diễn (`checkin.html`)**:
   - Quét camera trực tiếp từ điện thoại.
   - Khóa vé ngay tức thì khi qua cổng, cảnh báo màu đỏ nếu phát hiện vé giả hoặc vé đã được quét trước đó.
5. **Theme Concept Độc Quyền: GAME ON**:
   - Thiết kế chuẩn phong cách **Night Crimson & Star Gold** kết hợp Key Visual Poster chính thức.

---

## 📁 Cấu Trúc Dự Án

```text
payment_template/
├── index.html                 # Trang đặt vé & giao diện PayOS concept GAME ON
├── thanks.html                # Trang biên nhận & tự động kích hoạt cấp vé 100%
├── check-order.html           # Trang tra cứu đơn hàng & kích hoạt cấp vé bù
├── checkin.html               # Ứng dụng quét camera soát vé tại cổng đêm diễn
├── admin-orders.html          # Bảng điều khiển quản trị, đối soát PayOS & xuất Excel
├── firestore.rules            # Quy tắc bảo mật dữ liệu Cloud Firestore cấp Server
├── google-apps-script-mailer.gs # Cầu nối bảo mật PayOS & hệ thống gửi Email Gmail
├── LUONG_HE_THONG.md          # ★ TÀI LIỆU CHI TIẾT LUỒNG VẬN HÀNH & KIẾN TRÚC ★
├── README.md                  # Tài liệu giới thiệu nhanh (file này)
├── style/
│   ├── checkout.css           # Bộ CSS theme Night Crimson & Star Gold
│   └── game-on-banner.jpg     # Ảnh Poster Key Visual chính thức GAME ON
└── js/
    ├── config.js              # ★ FILE CẤU HÌNH DUY NHẤT CẦN SỬA KHI TÁI SỬ DỤNG ★
    ├── firebase-core.js       # Khởi tạo Firebase SDK Web Modular
    ├── ticket-service.js      # Thuật toán mã vé HMAC, API PayOS & gửi email xoay vòng
    ├── checkout.js            # Xử lý logic đặt vé trang index.html
    └── check-order.js         # Xử lý tra cứu đơn hàng trang check-order.html
```

---

## 🚀 Hướng Dẫn Triển Khai (3 Bước)

### Bước 1: Cấu hình sự kiện trong [`js/config.js`](./js/config.js)
Mọi thông số (Tên sự kiện, giá vé, voucher, cấu hình ngân hàng, link Webhook) đều được quản lý tập trung trong file này.

### Bước 2: Cài đặt Cloud Firestore Rules
Truy cập [Firebase Console](https://console.firebase.google.com/) $\rightarrow$ **Firestore Database** $\rightarrow$ **Rules** $\rightarrow$ Dán toàn bộ nội dung file [`firestore.rules`](./firestore.rules) và bấm **Publish**.

### Bước 3: Triển khai Webhook Google Apps Script
1. Truy cập [script.google.com](https://script.google.com) $\rightarrow$ Tạo dự án mới.
2. Dán nội dung [`google-apps-script-mailer.gs`](./google-apps-script-mailer.gs) vào.
3. Điền các khóa PayOS (`PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`).
4. Bấm **Deploy** $\rightarrow$ **New deployment** $\rightarrow$ Chọn loại **Web app**, quyền truy cập **Anyone**.
5. Copy URL Web app dán vào `appsScriptWebhookUrl` trong `js/config.js`.

---

© Ban Tổ Chức **Hùng Vương Concert**
