/**
 * ==============================================================================
 * ★ FILE CẤU HÌNH TRUNG TÂM (js/config.js) ★
 * ==============================================================================
 * Khi tái sử dụng bộ khung bán vé này cho một sự kiện / dự án mới,
 * bạn CHỈ CẦN SỬA THÔNG TIN TRONG FILE NÀY. Toàn bộ giao diện, mã VietQR,
 * bảng tính tiền, biên nhận và Firebase sẽ tự động cập nhật theo!
 */

// 1. THÔNG TIN SỰ KIỆN & GIÁ VÉ
export const EVENT_CONFIG = {
    eventName: "Hung Vuong Concert: Unfold",           // Tên sự kiện hiển thị trên trang
    eventBadge: "Official E-Ticket",                   // Nhãn góc trên
    statusBadge: "⚡ Cổng vé trực tuyến đang mở",       // Nhãn trạng thái mở bán
    ticketTypeName: "Vé Điện Tử (E-Ticket QR)",        // Tên hạng vé
    ticketPrice: 320000,                               // Đơn giá 1 vé (VNĐ)
    maxQuantityPerOrder: 5,                            // Số vé tối đa mỗi lượt mua
    quickQuantities: [1, 2, 3, 5],                     // Các nút chọn nhanh số lượng vé
    landingPageUrl: "../landing.html",                 // Đường dẫn về trang giới thiệu sự kiện
    termsNotes: [
        "Vé điện tử (E-Ticket) kèm mã QR check-in sẽ được gửi qua Email của bạn.",
        "Mỗi lượt đặt mua từ 1 đến tối đa 5 vé.",
        "Vé đã mua vui lòng không hoàn hoặc đổi trả."
    ],
    thankYouQuote: "Thành công của chương trình là kết tinh từ tình yêu thương, sẻ chia và đoàn kết của tất cả mọi người."
};

// 2. THÔNG TIN TÀI KHOẢN NGÂN HÀNG NHẬN TIỀN (VIETQR)
// Tra cứu mã bankId chuẩn của VietQR: VCB (Vietcombank), MB (MBBank), TCB (Techcombank), ACB, BIDV, ICB (VietinBank), TPB (TPBank)...
export const BANK_CONFIG = {
    bankId: "VCB",                                     // Mã ngân hàng VietQR
    bankDisplayName: "Vietcombank (VCB)",              // Tên hiển thị ngân hàng
    accountNo: "1024521600",                           // Số tài khoản nhận tiền
    accountName: "Nguyen Thi Thu Phuong",              // Tên chủ tài khoản (Không dấu)
    template: "compact2",                              // Mẫu VietQR (compact2, compact, qr_only, print)
    memoUnitLabel: "VE"                                // Hậu tố số lượng trong nội dung CK (VD: "2 VE NGUYEN VAN A 0912345678")
};

// 3. DANH SÁCH MÃ GIẢM GIÁ / VOUCHER (Để trống {} nếu không dùng)
// Hỗ trợ 2 loại:
// - type: 'percent' (Giảm theo %, ví dụ value: 10 là giảm 10%)
// - type: 'fixed_per_ticket' (Giảm số tiền cố định trên mỗi vé, ví dụ value: 20000 là giảm 20k/vé)
export const VOUCHER_CODES = {
    "HVCUNFOLD": { type: "percent", value: 10, label: "Giảm 10% (HVCUNFOLD)" },
    "CHV": { type: "fixed_per_ticket", value: 20000, label: "Ưu đãi học sinh CHV (-20k/vé)" },
    "VIP10": { type: "percent", value: 10, label: "Voucher VIP (-10%)" }
};

// 4. CẤU HÌNH FIREBASE BACKEND (CLOUD FIRESTORE & AUTH)
export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCvT5NakmA7pUla-7vKJCKxg4NBKi8c1P4",
    authDomain: "hungvuongconcert-719d0.firebaseapp.com",
    projectId: "hungvuongconcert-719d0",
    storageBucket: "hungvuongconcert-719d0.firebasestorage.app",
    messagingSenderId: "871800884023",
    appId: "1:871800884023:web:fff03a7a0c08bfd348a8b2",
    ordersCollection: "orders",                        // Tên bảng lưu đơn hàng (Không chứa mã vé thật)
    orderTicketsCollection: "order_tickets",           // Bảng bảo mật lưu mã vé theo đơn (Chỉ Super Admin đọc được)
    ticketsCollection: "tickets",                      // Bảng lưu từng mã vé đã phát hành để quét QR tại cổng
    systemSecretsCollection: "system_secrets",         // Bảng lưu UID Super Admin & Khóa Bí Mật trên Server
    mailCollection: "mail"                             // Bảng dùng cho Firebase Extension Trigger Email
};

// 5. CẤU HÌNH UPLOAD ẢNH BIÊN LAI & BẢO MẬT CHỐNG SPAM
export const UPLOAD_CONFIG = {
    imgbbApiKey: "720f1453f14c2cc6ba0b68214720705f",   // API Key của ImgBB (https://api.imgbb.com/)
    submitCooldownSeconds: 30,                         // Thời gian chờ tối thiểu giữa 2 lần đặt vé (giây)
    draftStorageKey: "ticket_checkout_draft_v1"        // Khóa lưu nháp trên trình duyệt
};

// 6. CẤU HÌNH THUẬT TOÁN SINH MÃ VÉ BẢO MẬT (CSPRNG + CHỮ KÝ SỐ HMAC-SHA256)
// LƯU Ý BẢO MẬT: Không hardcode khóa bí mật hay danh sách Super Admin tại đây!
// Khóa bí mật HMAC và quyền Super Admin được lưu trên Server Firestore (system_secrets)
// và được khóa cứng bằng firestore.rules để chống F12 tuyệt đối.
export const TICKET_SECURITY_CONFIG = {
    ticketPrefix: "HVC",                               // Tiền tố mã vé (VD: HVC-8K4P9X-E3A1)
    randomLength: 6,                                   // Độ dài chuỗi ngẫu nhiên CSPRNG (Base32)
    signatureLength: 4                                 // Độ dài chữ ký số HMAC-SHA256 rút gọn
};

// 7. CẤU HÌNH GỬI EMAIL VÉ ĐIỆN TỬ TỰ ĐỘNG CHO KHÁCH
// Hỗ trợ 3 chế độ gửi tự động:
// - "apps_script": Gửi miễn phí 100% qua Gmail BTC bằng Google Apps Script Webhook (Khuyên dùng)
// - "emailjs": Gửi qua dịch vụ EmailJS (https://www.emailjs.com/)
// - "firestore_mail": Ghi vào collection "mail" của Firebase Extension (Trigger Email)
export const EMAIL_CONFIG = {
    enabled: true,                                     // Tự động gửi mail ngay khi Admin nhấn "Duyệt vé"
    provider: "apps_script",                           // Chọn: "apps_script" | "emailjs" | "firestore_mail"
    appsScriptWebhookUrl: "https://script.google.com/macros/s/AKfycbzp1mZ7AoMcrCm7Agl35v7TF9BAa_HANCtYUuAx21jjMDmA5VpC4op2m2lZ9hYUmw9B/exec",                          // Dán URL Web App của Google Apps Script vào đây (hoặc nhập trên trang Admin)
    emailjs: {
        serviceId: "",                                 // EmailJS Service ID
        templateId: "",                                // EmailJS Template ID
        publicKey: ""                                  // EmailJS Public Key
    },
    eventTimeText: "19:00 - Chủ Nhật, Hùng Vương Concert: Unfold", // Thời gian hiển thị trong Email vé
    eventVenueText: "Hội trường Trung tâm",            // Địa điểm hiển thị trong Email vé
    supportHotline: "Ban Tổ Chức Hung Vuong Concert"   // Thông tin liên hệ hỗ trợ ở chân Email
};


