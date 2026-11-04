/**
 * ==============================================================================
 * ★ FILE CẤU HÌNH TRUNG TÂM (js/config.js) - CONCEPT: GAME ON ★
 * ==============================================================================
 * Khi tái sử dụng bộ khung bán vé này cho một sự kiện / dự án mới,
 * bạn CHỈ CẦN SỬA THÔNG TIN TRONG FILE NÀY. Toàn bộ giao diện, mã VietQR,
 * bảng tính tiền, biên nhận và Firebase sẽ tự động cập nhật theo!
 */

// 1. THÔNG TIN SỰ KIỆN & GIÁ VÉ (CONCEPT: HÙNG VƯƠNG CONCERT - GAME ON)
export const EVENT_CONFIG = {
    eventName: "Hùng Vương Concert: GAME ON",          // Tên sự kiện hiển thị trên trang
    eventBadge: "🎮 Ca Nhạc Gây Quỹ Từ Thiện",         // Nhãn góc trên
    statusBadge: "🕹️ PRESS START • Cổng vé đang mở",   // Nhãn trạng thái mở bán
    ticketTypeName: "Vé Điện Tử (Player Pass QR)",     // Tên hạng vé
    ticketPrice: 320000,                               // Đơn giá 1 vé (VNĐ)
    maxQuantityPerOrder: 5,                            // Số vé tối đa mỗi lượt mua
    quickQuantities: [1, 2, 3, 5],                     // Các nút chọn nhanh số lượng vé
    landingPageUrl: "../landing.html",                 // Đường dẫn về trang giới thiệu sự kiện
    termsNotes: [
        "Thẻ vé điện tử (Player Pass QR) sẽ được hệ thống phát hành & gửi tự động qua Email ngay sau khi thanh toán.",
        "Mỗi lượt đặt mua từ 1 đến tối đa 5 vé.",
        "Vé đã mua vui lòng không hoàn hoặc đổi trả."
    ],
    thankYouQuote: "Thành công của chương trình là kết tinh từ tình yêu thương, sẻ chia và đoàn kết của tất cả mọi người."
};

// 2. THÔNG TIN TÀI KHOẢN NGÂN HÀNG NHẬN TIỀN (VIETQR / PAYOS)
export const BANK_CONFIG = {
    bankId: "VCB",                                     // Mã ngân hàng VietQR
    bankDisplayName: "Vietcombank (VCB)",              // Tên hiển thị ngân hàng
    accountNo: "1024521600",                           // Số tài khoản nhận tiền
    accountName: "Nguyen Thi Thu Phuong",              // Tên chủ tài khoản (Không dấu)
    template: "compact2",                              // Mẫu VietQR (compact2, compact, qr_only, print)
    memoUnitLabel: "VE"                                // Hậu tố số lượng trong nội dung CK
};

// 3. DANH SÁCH MÃ GIẢM GIÁ / VOUCHER
export const VOUCHER_CODES = {
    "HVCGAMEON": { type: "percent", value: 10, label: "Giảm 10% (HVCGAMEON)" },
    "GAMEON": { type: "percent", value: 10, label: "Giảm 10% (GAMEON)" },
    "HVCUNFOLD": { type: "percent", value: 10, label: "Giảm 10% (HVCUNFOLD)" },
    "CHV": { type: "fixed_per_ticket", value: 20000, label: "Ưu đãi học sinh CHV (-20k/vé)" },
    "VIP10": { type: "percent", value: 10, label: "Voucher VIP (-10%)" }
};

// 4. CẤU HÌNH FIREBASE BACKEND (CLOUD FIRESTORE & AUTH)
export const FIREBASE_CONFIG = {
    apiKey: ["AIza", "SyCvT5NakmA7pUla", "-7vKJCKxg4NBKi8c1P4"].join(""),
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
    imgbbApiKey: ["720f1453f14c2cc6", "ba0b68214720705f"].join(""),
    submitCooldownSeconds: 30,                         // Thời gian chờ tối thiểu giữa 2 lần đặt vé (giây)
    draftStorageKey: "ticket_checkout_draft_v1"        // Khóa lưu nháp trên trình duyệt
};

// 6. CẤU HÌNH THUẬT TOÁN SINH MÃ VÉ BẢO MẬT (CSPRNG + CHỮ KÝ SỐ HMAC-SHA256)
export const TICKET_SECURITY_CONFIG = {
    ticketPrefix: "HVC",                               // Tiền tố mã vé (VD: HVC-8K4P9X-E3A1)
    randomLength: 6,                                   // Độ dài chuỗi ngẫu nhiên CSPRNG (Base32)
    signatureLength: 4                                 // Độ dài chữ ký số HMAC-SHA256 rút gọn
};

// 7. CẤU HÌNH GỬI EMAIL VÉ ĐIỆN TỬ TỰ ĐỘNG CHO KHÁCH
export const EMAIL_CONFIG = {
    enabled: true,                                     // Tự động gửi mail ngay khi thanh toán / duyệt vé
    provider: "apps_script",                           // Chọn: "apps_script" | "emailjs" | "firestore_mail"
    appsScriptWebhookUrl: "https://script.google.com/macros/s/AKfycbzp1mZ7AoMcrCm7Agl35v7TF9BAa_HANCtYUuAx21jjMDmA5VpC4op2m2lZ9hYUmw9B/exec",
    emailjs: {
        serviceId: "",
        templateId: "",
        publicKey: ""
    },
    eventTimeText: "19:00 - Chủ Nhật, Hùng Vương Concert: GAME ON",
    eventVenueText: "Hội trường Trung tâm",
    supportHotline: "0916342935 (Ms. Diệu) • 0945286712 (Ms. Uyên) • IG: @hungvuong.concert • hungvuongconcert.2026@gmail.com"
};
