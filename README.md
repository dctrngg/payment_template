# 🎟️ Ticket Checkout Template (VietQR + Firebase Cloud Firestore)

Bộ khung (Template) **Hệ Thống Bán Vé Điện Tử & Thanh Toán VietQR Tự Động** độc lập, không phụ thuộc vào bất kỳ tài nguyên bên ngoài nào (0 ảnh nền nặng, 0 thư viện UI ngoài, chạy thuần HTML5/CSS3/ES Modules).

Bạn có thể copy thư mục `ticket-checkout-template` này sang bất kỳ dự án sự kiện, concert, workshop, kịch nghệ hay giải chạy nào và **cấu hình xong chỉ trong 3 phút** thông qua một file duy nhất: [`js/config.js`](./js/config.js).

---

## 📁 Cấu Trúc Thư Mục Đóng Gói

```text
ticket-checkout-template/
├── index.html            # Trang đặt vé & thanh toán VietQR tự động (Trang chính)
├── thanks.html           # Trang Biên nhận vé điện tử (Digital Ticket Receipt) sau khi đặt
├── check-order.html      # Trang Tra cứu trạng thái đơn vé cho khách hàng (theo Mã Đơn)
├── admin-orders.html     # Trang Quản trị, Duyệt vé & Xuất Excel (.CSV/.JSON) cho BTC
├── firestore.rules       # Bộ quy tắc bảo mật Firebase Firestore (Chống giả giá, chống XSS/Spam)
├── README.md             # Tài liệu hướng dẫn tái sử dụng (file này)
├── style/
│   └── checkout.css      # Giao diện Glassmorphism hiện đại, độc lập 100%, chuẩn Mobile/PC
└── js/
    ├── config.js         # ★ FILE CẤU HÌNH DUY NHẤT CẦN SỬA KHI TÁI SỬ DỤNG ★
    ├── firebase-core.js  # Khởi tạo Firebase SDK & Các hàm lọc bảo mật (escapeHtml, sanitizeUrl)
    ├── checkout.js       # Logic tính tiền, VietQR động, nén ảnh Canvas, lưu nháp, gửi đơn
    └── check-order.js    # Logic tra cứu đơn vé theo Mã Đơn (Document ID)
```

---

## 🚀 Hướng Dẫn Tái Sử Dụng Cho Sự Kiện Mới (Chỉ 3 Bước)

### Bước 1: Mở file [`js/config.js`](./js/config.js) và thay đổi thông tin

Mọi thông tin của sự kiện đều nằm gọn trong `js/config.js`:

1. **`EVENT_CONFIG`**:
   - Đổi `eventName` (Tên sự kiện), `ticketTypeName` (Tên hạng vé), `ticketPrice` (Giá 1 vé tính bằng VNĐ), `maxQuantityPerOrder` (Số vé tối đa mỗi đơn).
2. **`BANK_CONFIG`**:
   - Đổi `bankId` (Mã ngân hàng chuẩn VietQR: `VCB`, `MB`, `TCB`, `ACB`, `BIDV`, `ICB`, `TPB`...), `accountNo` (Số tài khoản), `accountName` (Tên chủ tài khoản không dấu).
3. **`VOUCHER_CODES`**:
   - Thêm/xóa các mã giảm giá theo phần trăm (`type: "percent"`) hoặc giảm tiền mặt trên mỗi vé (`type: "fixed_per_ticket"`). Nếu không dùng mã giảm giá, để `export const VOUCHER_CODES = {};`.
4. **`FIREBASE_CONFIG`**:
   - Dán cấu hình Firebase Project mới của bạn vào (`apiKey`, `projectId`...).
5. **`UPLOAD_CONFIG`**:
   - Thay `imgbbApiKey` bằng API Key miễn phí lấy tại [api.imgbb.com](https://api.imgbb.com/).

---

### Bước 2: Cài đặt Bảo mật trên Firebase Console

1. Truy cập [Firebase Console](https://console.firebase.google.com/) của dự án mới.
2. **Bật Cloud Firestore**:
   - Vào **Firestore Database** → tab **Rules**.
   - Copy nội dung file [`firestore.rules`](./firestore.rules) dán vào và nhấn **Publish** (Nhớ đổi biến `let ticketPrice = ...` trong `firestore.rules` khớp với giá vé sự kiện mới).
3. **Bật Firebase Authentication (Dành cho Admin duyệt vé)**:
   - Vào **Authentication** → **Sign-in method** → Bật **Email/Password**.
   - Sang tab **Users** → Nhấn **Add user** để tạo tài khoản Email & Mật khẩu cho Ban Tổ Chức đăng nhập vào trang `admin-orders.html`.

---

### Bước 3: Chạy hoặc Deploy lên Hosting

Bộ mã nguồn này là **Static Web App 100%**, bạn có thể:
- Đưa trực tiếp lên **Firebase Hosting**, **Vercel**, **Netlify**, **GitHub Pages**, hoặc nhúng vào thư mục con (ví dụ `/mua-ve/`) của bất kỳ website nào.
- Khi thử nghiệm trên máy tính cá nhân (Localhost): Mở bằng tiện ích **Live Server** trên VS Code hoặc chạy `npx serve .` để trình duyệt tải các ES Modules (`type="module"`).

---

## ✨ Các Tính Năng Đã Tích Hợp Sẵn Trong Bộ Template

1. **Sinh mã VietQR Động (Dynamic VietQR)**: Tự động điền sẵn Số tiền (đã trừ Voucher) và Nội dung chuyển khoản chuẩn xác theo Số vé + Tên + SĐT khách.
2. **Tải ảnh QR `.png` cho điện thoại**: Tự động chuyển đổi Vector QR sang ảnh `.png` sắc nét để khách lưu vào thư viện ảnh và quét bằng App Ngân hàng.
3. **Copy nhanh 1 chạm**: Sao chép Số tài khoản, Số tiền, Nội dung chuyển khoản kèm thông báo phản hồi tức thì.
4. **Tự động nén ảnh Biên lai trên trình duyệt (HTML5 Canvas)**: Giảm dung lượng ảnh chụp màn hình từ 5–10MB xuống ~200KB giúp upload nhanh gấp 5 lần ngay cả khi mạng 4G yếu.
5. **Lưu nháp tự động (`localStorage`)**: Khách thoát ra vào App Ngân hàng chuyển khoản quay lại không bị mất thông tin đã gõ.
6. **Biên nhận Vé Điện Tử (`thanks.html`)**: Cung cấp thẻ vé kỹ thuật số kèm Mã Đơn (Order ID) để khách lưu lại đối chiếu.
7. **Tra cứu trạng thái đơn vé (`check-order.html`)**: Khách tự kiểm tra đơn của mình đang `PENDING` (Chờ duyệt) hay `APPROVED` (Đã duyệt).
8. **Trang Quản trị & Xuất Excel (`admin-orders.html`)**: Bảo vệ bằng Firebase Auth, hỗ trợ lọc đơn, duyệt vé 1 chạm và xuất file `.CSV` (chuẩn tiếng Việt UTF-8 BOM mở trực tiếp bằng Excel) hoặc `.JSON`.
9. **Bảo mật đa tầng**: Chống XSS (`escapeHtml`, `sanitizeUrl`), chống CSV Injection, chống sửa giá 0đ trên Server (`firestore.rules`), chống cào dữ liệu hàng loạt và giới hạn tần suất gửi đơn (Rate Limit).

