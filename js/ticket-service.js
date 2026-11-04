/**
 * ==============================================================================
 * js/ticket-service.js - Bảo Mật Mã Vé (CSPRNG + HMAC-SHA256), Phân Quyền
 * Server-Side (Zero-Knowledge) & Hàng Đợi Gửi Mail Xoay Vòng Cho 2.000 Vé
 * ==============================================================================
 */

import { EVENT_CONFIG, FIREBASE_CONFIG, TICKET_SECURITY_CONFIG, EMAIL_CONFIG } from "./config.js";
import {
    db,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    deleteField,
    serverTimestamp,
    escapeHtml
} from "./firebase-core.js";

// Bảng chữ cái Crockford Base32 (Loại bỏ I, L, O, U để tránh nhầm với 1, 0, V)
const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// Biến theo dõi vị trí Webhook đang hoạt động (dùng cho xoay vòng nhiều Gmail BTC)
let currentWebhookIndex = 0;

/**
 * ============================================================================
 * PHẦN 1: THUẬT TOÁN MẬT MÃ HỌC SINH & XÁC THỰC MÃ VÉ (CSPRNG + HMAC-SHA256)
 * ============================================================================
 */

export function generateSecureRandomBase32(length = TICKET_SECURITY_CONFIG.randomLength || 6) {
    const randomBytes = new Uint8Array(length);
    window.crypto.getRandomValues(randomBytes);
    let result = "";
    for (let i = 0; i < length; i++) {
        result += BASE32_ALPHABET[randomBytes[i] % BASE32_ALPHABET.length];
    }
    return result;
}

export async function computeHmacSignature(payload, secretKey, sigLength = TICKET_SECURITY_CONFIG.signatureLength || 4) {
    const cleanSecret = String(secretKey || "").trim();
    if (!cleanSecret) {
        throw new Error("Thiếu Khóa Bí Mật (HMAC Secret Key) của Super Admin để ký số mã vé.");
    }
    const encoder = new TextEncoder();
    const cryptoKey = await window.crypto.subtle.importKey(
        "raw",
        encoder.encode(cleanSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signatureBuffer = await window.crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(payload));
    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    const hexHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    return hexHash.slice(0, sigLength);
}

export async function generateTicketCode(orderId, ticketNumber, secretKey) {
    const prefix = (TICKET_SECURITY_CONFIG.ticketPrefix || "HVC").toUpperCase();
    const randomPart = generateSecureRandomBase32(TICKET_SECURITY_CONFIG.randomLength || 6);
    const payloadToSign = `${prefix}:${orderId}:${ticketNumber}:${randomPart}`;
    const signaturePart = await computeHmacSignature(
        payloadToSign,
        secretKey,
        TICKET_SECURITY_CONFIG.signatureLength || 4
    );
    return `${prefix}-${randomPart}-${signaturePart}`;
}

export async function verifyTicketCodeSignature(ticketCode, orderId, ticketNumber, secretKey) {
    if (!ticketCode || typeof ticketCode !== "string") return false;
    const parts = ticketCode.trim().toUpperCase().split("-");
    if (parts.length !== 3) return false;
    const [prefix, randomPart, providedSig] = parts;
    const payloadToSign = `${prefix}:${orderId}:${ticketNumber}:${randomPart}`;
    const expectedSig = await computeHmacSignature(
        payloadToSign,
        secretKey,
        providedSig.length
    );
    return providedSig === expectedSig;
}

/**
 * Che mờ mã vé (VD: HVC-8K4P9X-E3A1 -> HVC-8K****-****)
 * Lưu vào bảng orders để nhân viên đối soát Bill không bao giờ biết mã vé thật kể cả khi mở F12
 */
export function maskTicketCode(code) {
    if (!code || typeof code !== "string") return "HVC-******-****";
    const parts = code.split("-");
    if (parts.length !== 3) return "HVC-******-****";
    return `${parts[0]}-${parts[1].slice(0, 2)}****-****`;
}

export function getTicketQrImageUrl(ticketCode, size = 220) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(ticketCode)}`;
}

/**
 * ============================================================================
 * PHẦN 2: QUẢN LÝ PHÂN QUYỀN SERVER-SIDE (SUPER ADMIN VS NHÂN VIÊN ĐỐI SOÁT)
 * ============================================================================
 */

export async function checkServerRole(user) {
    if (!user) return { role: "GUEST", isSuperAdmin: false, canClaimSuperAdmin: false };
    const secretsCol = FIREBASE_CONFIG.systemSecretsCollection || "system_secrets";
    const bootstrapRef = doc(db, secretsCol, "bootstrap");

    try {
        const snap = await getDoc(bootstrapRef);
        if (!snap.exists()) {
            return {
                role: "UNINITIALIZED",
                isSuperAdmin: false,
                canClaimSuperAdmin: true,
                superAdminEmail: null
            };
        }
        const data = snap.data();
        const emailList = Array.isArray(data.superAdminEmails)
            ? data.superAdminEmails.map(e => String(e).trim().toLowerCase())
            : (data.superAdminEmail ? [String(data.superAdminEmail).trim().toLowerCase()] : []);

        const currentEmail = String(user.email || "").trim().toLowerCase();
        const isSuper = (data.superAdminUid === user.uid) || (currentEmail && emailList.includes(currentEmail));

        return {
            role: isSuper ? "SUPER_ADMIN" : "REVIEWER",
            isSuperAdmin: isSuper,
            canClaimSuperAdmin: false,
            superAdminEmail: data.superAdminEmail || "Super Admin",
            superAdminEmails: emailList
        };
    } catch (err) {
        console.warn("Không thể kiểm tra bootstrap document:", err);
        return {
            role: "REVIEWER",
            isSuperAdmin: false,
            canClaimSuperAdmin: false,
            superAdminEmails: [],
            error: err.message
        };
    }
}

/**
 * Khóa cứng tài khoản hiện tại làm Super Admin gốc trên Server (Chỉ thực hiện được 1 lần duy nhất)
 */
export async function claimSuperAdminBootstrap(user) {
    if (!user) throw new Error("Bạn chưa đăng nhập.");
    const secretsCol = FIREBASE_CONFIG.systemSecretsCollection || "system_secrets";
    const bootstrapRef = doc(db, secretsCol, "bootstrap");
    const cleanEmail = String(user.email || "").trim().toLowerCase();

    await setDoc(bootstrapRef, {
        superAdminUid: user.uid,
        superAdminEmail: cleanEmail,
        superAdminEmails: cleanEmail ? [cleanEmail] : [],
        lockedAt: serverTimestamp()
    });

    // Tự động khởi tạo Khóa Bí Mật HMAC-SHA256 ngẫu nhiên 24 ký tự lưu trên Server (Không lưu ở code JS)
    const configRef = doc(db, secretsCol, "config");
    const cfgSnap = await getDoc(configRef);
    if (!cfgSnap.exists()) {
        const autoSecret = `HVC-KEY-${generateSecureRandomBase32(8)}-${generateSecureRandomBase32(8)}`;
        await setDoc(configRef, {
            hmacSecret: autoSecret,
            webhookUrls: EMAIL_CONFIG.appsScriptWebhookUrl || "",
            updatedAt: serverTimestamp()
        });
    }
}

/**
 * Cập nhật danh sách các Email đồng Super Admin (VD: 3 tài khoản) trên Server Firestore
 */
export async function saveSuperAdminEmailsList(rawEmailsInput) {
    const secretsCol = FIREBASE_CONFIG.systemSecretsCollection || "system_secrets";
    const bootstrapRef = doc(db, secretsCol, "bootstrap");
    const snap = await getDoc(bootstrapRef);
    if (!snap.exists()) {
        throw new Error("Chưa khởi tạo Super Admin gốc.");
    }
    const data = snap.data();
    const ownerEmail = String(data.superAdminEmail || "").trim().toLowerCase();

    const parsed = String(rawEmailsInput || "")
        .split(/[\n,;]+/)
        .map(s => s.trim().toLowerCase())
        .filter(s => s.includes("@"));

    if (ownerEmail && !parsed.includes(ownerEmail)) {
        parsed.unshift(ownerEmail);
    }

    const uniqueEmails = Array.from(new Set(parsed));
    await updateDoc(bootstrapRef, {
        superAdminEmails: uniqueEmails
    });
    return uniqueEmails;
}

/**
 * Tải cấu hình Khóa Bí Mật & Danh sách Webhook từ Server (Chỉ Super Admin đọc được)
 */
export async function loadServerSecretConfig() {
    const secretsCol = FIREBASE_CONFIG.systemSecretsCollection || "system_secrets";
    const configRef = doc(db, secretsCol, "config");
    const snap = await getDoc(configRef);
    if (snap.exists()) {
        const d = snap.data();
        return {
            hmacSecret: d.hmacSecret || "",
            webhookUrls: d.webhookUrls || EMAIL_CONFIG.appsScriptWebhookUrl || ""
        };
    }
    const fallbackSecret = `HVC-KEY-${generateSecureRandomBase32(8)}-${generateSecureRandomBase32(8)}`;
    return { hmacSecret: fallbackSecret, webhookUrls: EMAIL_CONFIG.appsScriptWebhookUrl || "" };
}

/**
 * Lưu Khóa Bí Mật & Danh sách Webhook lên Server Firestore (Chỉ Super Admin ghi được)
 */
export async function saveServerSecretConfig(hmacSecret, webhookUrls) {
    const secretsCol = FIREBASE_CONFIG.systemSecretsCollection || "system_secrets";
    const configRef = doc(db, secretsCol, "config");
    await setDoc(configRef, {
        hmacSecret: String(hmacSecret || "").trim(),
        webhookUrls: String(webhookUrls || "").trim(),
        updatedAt: serverTimestamp()
    }, { merge: true });
}

/**
 * Tải toàn bộ bảng ánh xạ orderId -> ticketCodes thật (Chỉ Super Admin được phép gọi)
 */
export async function loadAllOrderTicketsForSuperAdmin() {
    const orderTicketsCol = FIREBASE_CONFIG.orderTicketsCollection || "order_tickets";
    const snap = await getDocs(collection(db, orderTicketsCol));
    const map = {};
    snap.forEach(docSnap => {
        const d = docSnap.data();
        if (Array.isArray(d.ticketCodes)) {
            map[docSnap.id] = d.ticketCodes;
        }
    });
    return map;
}

/**
 * ============================================================================
 * PHẦN 3: QUY TRÌNH DUYỆT 2 BƯỚC (NHÂN VIÊN SOI BILL -> SUPER ADMIN CẤP VÉ)
 * ============================================================================
 */

/**
 * BƯỚC 1 (Dành cho Nhân viên Reviewer): Xác nhận ảnh Bill chuyển khoản hợp lệ
 * Nhân viên chỉ đổi trạng thái sang BILL_VERIFIED, không sinh vé, không thấy mã vé.
 */
export async function verifyOrderBillByReviewer(orderId, nextStatus, staffEmail) {
    const ordersColName = FIREBASE_CONFIG.ordersCollection || "orders";
    const targetStatus = nextStatus === "BILL_VERIFIED" ? "BILL_VERIFIED" : "PENDING";
    await updateDoc(doc(db, ordersColName, orderId), {
        status: targetStatus,
        verifiedBy: staffEmail || "staff",
        verifiedAt: serverTimestamp()
    });
    return targetStatus;
}

/**
 * BƯỚC 2 (Dành riêng cho Super Admin): Phát hành mã vé HMAC-SHA256 & lưu vào bảng bảo mật
 */
export async function approveAndIssueTickets(order, secretKey, existingRealCodes = []) {
    const qty = Math.max(1, Number(order.quantity) || 1);
    const ticketsColName = FIREBASE_CONFIG.ticketsCollection || "tickets";
    const orderTicketsColName = FIREBASE_CONFIG.orderTicketsCollection || "order_tickets";
    const ordersColName = FIREBASE_CONFIG.ordersCollection || "orders";

    let ticketCodes = Array.isArray(existingRealCodes) && existingRealCodes.length === qty
        ? [...existingRealCodes]
        : [];

    if (ticketCodes.length === 0) {
        const prevVaultSnap = await getDoc(doc(db, orderTicketsColName, order.id));
        if (prevVaultSnap.exists() && Array.isArray(prevVaultSnap.data().ticketCodes) && prevVaultSnap.data().ticketCodes.length === qty) {
            ticketCodes = [...prevVaultSnap.data().ticketCodes];
        }
    }

    if (ticketCodes.length === 0) {
        for (let i = 1; i <= qty; i++) {
            const code = await generateTicketCode(order.id, i, secretKey);
            ticketCodes.push(code);
        }
    }

    // 1. Lưu từng vé vào collection "tickets/{ticketCode}" (Nhân viên bị chặn quyền list trên Server)
    for (let i = 0; i < ticketCodes.length; i++) {
        const code = ticketCodes[i];
        const ticketNumber = i + 1;
        await setDoc(doc(db, ticketsColName, code), {
            ticketCode: code,
            orderId: order.id,
            ticketNumber: ticketNumber,
            ticketLabel: `Vé ${ticketNumber}/${qty}`,
            customerName: order.name || "Khách hàng",
            phone: order.phone || "",
            email: order.email || "",
            eventName: EVENT_CONFIG.eventName,
            ticketTypeName: EVENT_CONFIG.ticketTypeName,
            unitPrice: EVENT_CONFIG.ticketPrice,
            status: "VALID",
            checkedIn: false,
            checkedInAt: null,
            issuedAt: serverTimestamp()
        }, { merge: true });
    }

    // 2. Lưu mã vé thật vào bảng "order_tickets/{orderId}" (Chỉ Super Admin đọc được)
    await setDoc(doc(db, orderTicketsColName, order.id), {
        orderId: order.id,
        customerName: order.name || "",
        email: order.email || "",
        quantity: qty,
        ticketCodes: ticketCodes,
        issuedAt: serverTimestamp()
    }, { merge: true });

    // 3. Cập nhật bảng "orders/{orderId}": Chỉ lưu mã đã che mờ (maskedTickets) và xóa ticketCodes thật (nếu có từ bản cũ)
    const maskedList = ticketCodes.map(maskTicketCode);
    await updateDoc(doc(db, ordersColName, order.id), {
        status: "APPROVED",
        maskedTickets: maskedList,
        issuedTicketCount: ticketCodes.length,
        ticketCodes: deleteField(),
        approvedAt: serverTimestamp()
    });

    return ticketCodes;
}

/**
 * Thu hồi hiệu lực vé khi Super Admin hoàn tác đơn về PENDING
 */
export async function revokeOrderTickets(order, realTicketCodes = []) {
    const ticketsColName = FIREBASE_CONFIG.ticketsCollection || "tickets";
    const ordersColName = FIREBASE_CONFIG.ordersCollection || "orders";

    if (Array.isArray(realTicketCodes)) {
        for (const code of realTicketCodes) {
            try {
                await updateDoc(doc(db, ticketsColName, code), {
                    status: "PENDING_APPROVAL"
                });
            } catch (e) {
                console.warn("Không thể cập nhật trạng thái thu hồi cho vé:", code, e);
            }
        }
    }

    await updateDoc(doc(db, ordersColName, order.id), {
        status: "PENDING"
    });
}

/**
 * ============================================================================
 * PHẦN 4: MẪU EMAIL VÉ HTML & GỬI MAIL XOAY VÒNG CHO QUY MÔ 2.000 VÉ
 * ============================================================================
 */

export function buildTicketEmailHtml(order, ticketCodes = []) {
    const safeName = escapeHtml(order.name || "Quý khách");
    const safeOrderId = escapeHtml(order.id);
    const safePhone = escapeHtml(order.phone || "---");
    const safeEmail = escapeHtml(order.email || "---");
    const safeEventName = escapeHtml(EVENT_CONFIG.eventName);
    const safeTicketType = escapeHtml(EVENT_CONFIG.ticketTypeName);
    const formattedTotal = Number(order.totalAmount || 0).toLocaleString("vi-VN") + " VNĐ";

    const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, "");

    const ticketsHtml = ticketCodes.map((code, idx) => {
        const safeCode = escapeHtml(code);
        const qrUrl = getTicketQrImageUrl(code, 220);
        const singleTicketCheckUrl = `${baseUrl}/check-order.html?code=${encodeURIComponent(code)}`;
        return `
            <div style="border: 2px solid #0066ff; border-radius: 16px; background: #ffffff; margin-bottom: 18px; overflow: hidden;">
                <div style="background: linear-gradient(135deg, #0b132b, #00509d); color: #ffffff; padding: 12px 18px; display: flex; justify-content: space-between; align-items: center;">
                    <strong style="font-size: 14px; letter-spacing: 0.5px;">🎟️ THẺ VÉ ĐIỆN TỬ #${idx + 1}/${ticketCodes.length}</strong>
                    <span style="font-size: 12px; background: rgba(16,185,129,0.25); color: #6ee7b7; padding: 3px 10px; border-radius: 12px; font-weight: bold;">✓ CHÍNH THỨC</span>
                </div>
                <div style="padding: 20px; text-align: center;">
                    <img src="${qrUrl}" alt="QR ${safeCode}" width="180" height="180" style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px; background: #fff; display: block; margin: 0 auto 12px auto;" />
                    <div style="font-size: 12px; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">Mã Vé Check-in (Ký số bảo mật)</div>
                    <div style="display: inline-block; background: #f1f5f9; border: 1px dashed #0066ff; color: #0066ff; font-family: Consolas, monospace; font-size: 20px; font-weight: 800; padding: 8px 18px; border-radius: 10px; letter-spacing: 1.5px;">
                        ${safeCode}
                    </div>
                    <p style="font-size: 12.5px; color: #475569; margin: 10px 0 8px 0;">
                        Xuất trình mã QR này tại cổng soát vé. Mỗi mã vé chỉ có hiệu lực quét <strong>01 lần duy nhất</strong>.
                    </p>
                    <a href="${singleTicketCheckUrl}" target="_blank" style="font-size: 12px; color: #0066ff; text-decoration: underline;">Kiểm tra trạng thái vé #${idx + 1} trực tuyến</a>
                </div>
            </div>
        `;
    }).join("");

    return `
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
</head>
<body style="margin: 0; padding: 20px; background-color: #f1f5f9; font-family: 'Segoe UI', Roboto, Arial, sans-serif; color: #0f172a;">
    <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
        <div style="background: linear-gradient(135deg, #090d16, #1e3a8a); color: #ffffff; padding: 28px 24px; text-align: center;">
            <div style="display: inline-block; background: rgba(56,189,248,0.2); color: #38bdf8; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 99px; margin-bottom: 10px; text-transform: uppercase;">
                Official E-Ticket Confirmation
            </div>
            <h1 style="margin: 0; font-size: 24px; font-weight: 800;">${safeEventName}</h1>
            <p style="margin: 8px 0 0 0; color: #cbd5e1; font-size: 14px;">Vé điện tử của bạn đã được phát hành chính thức!</p>
        </div>

        <div style="padding: 24px;">
            <p style="font-size: 15px; line-height: 1.6; margin-top: 0;">
                Xin chào <strong>${safeName}</strong>,<br/>
                Ban Tổ Chức <strong>${safeEventName}</strong> xác nhận đã nhận được khoản thanh toán của bạn. Dưới đây là <strong>${ticketCodes.length} Mã Vé Điện Tử (QR)</strong> bảo mật của riêng bạn:
            </p>

            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; margin: 18px 0; font-size: 14px;">
                <p style="margin: 6px 0;"><strong>• Mã Đơn Hàng:</strong> <code style="color: #0066ff; font-weight: bold;">${safeOrderId}</code></p>
                <p style="margin: 6px 0;"><strong>• Khách hàng:</strong> ${safeName} (${safePhone})</p>
                <p style="margin: 6px 0;"><strong>• Email nhận vé:</strong> ${safeEmail}</p>
                <p style="margin: 6px 0;"><strong>• Hạng vé:</strong> ${safeTicketType}</p>
                <p style="margin: 6px 0;"><strong>• Số lượng:</strong> ${ticketCodes.length} vé — <strong>Tổng đã TT:</strong> <span style="color: #059669; font-weight: bold;">${formattedTotal}</span></p>
            </div>

            <h3 style="font-size: 16px; color: #0f172a; margin: 22px 0 12px 0; text-align: center;">
                🎫 DANH SÁCH THẺ VÉ CHECK-IN CỦA BẠN
            </h3>

            ${ticketsHtml}

            <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 8px; font-size: 13px; color: #92400e; line-height: 1.5;">
                <strong>⚠️ Lưu ý bảo mật quan trọng:</strong><br/>
                • Mã vé này chỉ được gửi duy nhất vào Email của bạn (Nhân viên đối soát cũng không thể xem mã vé của bạn).<br/>
                • Vui lòng tuyệt đối không chia sẻ ảnh mã QR lên mạng xã hội để tránh bị người khác quét mã vào cổng trước.
            </div>
        </div>

        <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 24px; text-align: center; font-size: 12.5px; color: #64748b;">
            <p style="margin: 0;">"${escapeHtml(EVENT_CONFIG.thankYouQuote || "")}"</p>
            <p style="margin: 6px 0 0 0;">© ${new Date().getFullYear()} ${safeEventName}</p>
        </div>
    </div>
</body>
</html>`.trim();
}

/**
 * Tách danh sách nhiều Webhook URL (phân tách bởi dấu phẩy, chấm phẩy hoặc xuống dòng)
 */
export function parseWebhookUrlList(rawInput) {
    if (!rawInput) return [];
    return String(rawInput)
        .split(/[\n,;]+/)
        .map(s => s.trim())
        .filter(s => /^https:\/\/script\.google\.com\//i.test(s) || /^https?:\/\//i.test(s));
}

/**
 * Gửi Email Vé với cơ chế Xoay Vòng Nhiều Webhook (Multi-Webhook Failover cho 2.000 vé)
 */
export async function sendTicketEmail(order, ticketCodes = [], rawWebhookUrls = "") {
    if (!order || !order.email) {
        throw new Error("Đơn hàng không có địa chỉ Email hợp lệ.");
    }

    const subject = `[${EVENT_CONFIG.eventName}] Vé Điện Tử Chính Thức (${ticketCodes.length} vé) - Đơn #${order.id}`;
    const htmlBody = buildTicketEmailHtml(order, ticketCodes);
    const webhookList = parseWebhookUrlList(rawWebhookUrls || EMAIL_CONFIG.appsScriptWebhookUrl || "");

    // Phương thức 1: Xoay vòng qua danh sách Google Apps Script Webhooks (Hỗ trợ quy mô 2.000 vé)
    if (webhookList.length > 0) {
        let lastError = null;
        for (let attempt = 0; attempt < webhookList.length; attempt++) {
            const idx = (currentWebhookIndex + attempt) % webhookList.length;
            const targetUrl = webhookList[idx];

            try {
                const response = await fetch(targetUrl, {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify({
                        action: "send_email",
                        to: order.email,
                        subject: subject,
                        htmlBody: htmlBody,
                        customerName: order.name,
                        orderId: order.id,
                        ticketCodes: ticketCodes
                    })
                });

                let result = {};
                try {
                    result = await response.json();
                } catch (_) {}

                if (response.ok && result.status !== "error") {
                    // Nếu tài khoản Gmail này sắp hết hạn mức (remainingQuota <= 2), chuyển sẵn sang link Gmail tiếp theo cho đơn sau
                    if (typeof result.remainingQuota === "number" && result.remainingQuota <= 2) {
                        currentWebhookIndex = (idx + 1) % webhookList.length;
                    } else {
                        currentWebhookIndex = idx;
                    }

                    await updateDoc(doc(db, FIREBASE_CONFIG.ordersCollection || "orders", order.id), {
                        emailSent: true,
                        emailSentAt: serverTimestamp()
                    });

                    return {
                        method: "apps_script",
                        success: true,
                        webhookIndex: idx + 1,
                        totalWebhooks: webhookList.length,
                        remainingQuota: result.remainingQuota
                    };
                } else {
                    lastError = new Error(result.message || `Webhook #${idx + 1} trả về lỗi (${response.status})`);
                }
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError || new Error("Tất cả các Google Apps Script Webhook đều hết hạn mức hoặc lỗi kết nối.");
    }

    // Phương thức 2: EmailJS
    if (EMAIL_CONFIG.provider === "emailjs" && EMAIL_CONFIG.emailjs && EMAIL_CONFIG.emailjs.serviceId) {
        const { serviceId, templateId, publicKey } = EMAIL_CONFIG.emailjs;
        const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                service_id: serviceId,
                template_id: templateId,
                user_id: publicKey,
                template_params: {
                    to_email: order.email,
                    to_name: order.name,
                    subject: subject,
                    order_id: order.id,
                    ticket_codes: ticketCodes.join(", "),
                    quantity: ticketCodes.length,
                    total_amount: Number(order.totalAmount || 0).toLocaleString("vi-VN") + " VNĐ",
                    message_html: htmlBody
                }
            })
        });

        if (!response.ok) {
            throw new Error(`EmailJS Error: ${await response.text()}`);
        }

        await updateDoc(doc(db, FIREBASE_CONFIG.ordersCollection || "orders", order.id), {
            emailSent: true,
            emailSentAt: serverTimestamp()
        });

        return { method: "emailjs", success: true };
    }

    // Phương thức 3: Firebase Extension Trigger Email
    if (EMAIL_CONFIG.provider === "firestore_mail") {
        await addDoc(collection(db, FIREBASE_CONFIG.mailCollection || "mail"), {
            to: [order.email],
            message: { subject: subject, html: htmlBody },
            orderId: order.id,
            createdAt: serverTimestamp()
        });

        await updateDoc(doc(db, FIREBASE_CONFIG.ordersCollection || "orders", order.id), {
            emailSent: true,
            emailSentAt: serverTimestamp()
        });

        return { method: "firestore_mail", success: true };
    }

    return {
        method: "none",
        success: false,
        reason: "Chưa cấu hình Google Apps Script Webhook URL trên Server."
    };
}

/**
 * ============================================================================
 * PHẦN 5: TÍCH HỢP PAYOS TỰ ĐỘNG QUA GOOGLE APPS SCRIPT BRIDGE (BẢO MẬT KEY)
 * ============================================================================
 * Client ID, API Key & Checksum Key được giấu kín 100% trong Google Apps Script.
 */

/**
 * Sinh mã số đơn hàng nguyên dương 9 chữ số duy nhất cho PayOS (orderCode)
 */
export function generatePayosOrderCode() {
    const timePart = String(Date.now()).slice(-7);
    const randArray = new Uint8Array(1);
    window.crypto.getRandomValues(randArray);
    const randPart = String(10 + (randArray[0] % 89));
    return Number(timePart + randPart);
}

/**
 * Gọi Google Apps Script để khởi tạo Link Thanh Toán & Mã VietQR Động của PayOS
 */
export async function createPayosPaymentLink(orderPayload, rawWebhookUrls = "") {
    const webhookList = parseWebhookUrlList(rawWebhookUrls || EMAIL_CONFIG.appsScriptWebhookUrl || "");
    if (webhookList.length === 0) {
        return {
            success: false,
            reason: "Chưa cấu hình URL Google Apps Script trong js/config.js (appsScriptWebhookUrl)."
        };
    }

    const targetUrl = webhookList[0];
    const response = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
            action: "create_payos_link",
            orderCode: Number(orderPayload.orderCode),
            amount: Number(orderPayload.amount),
            description: String(orderPayload.description || `HVC ${orderPayload.orderCode}`).slice(0, 25),
            buyerName: orderPayload.buyerName || "",
            buyerEmail: orderPayload.buyerEmail || "",
            buyerPhone: orderPayload.buyerPhone || "",
            returnUrl: orderPayload.returnUrl || window.location.href,
            cancelUrl: orderPayload.cancelUrl || window.location.href
        })
    });

    const result = await response.json();
    if (result && result.status === "success" && result.data) {
        return {
            success: true,
            checkoutUrl: result.data.checkoutUrl,
            qrCode: result.data.qrCode,
            orderCode: result.data.orderCode,
            paymentLinkId: result.data.paymentLinkId,
            accountNumber: result.data.accountNumber,
            accountName: result.data.accountName
        };
    }

    return {
        success: false,
        reason: (result && result.message) || "Không thể khởi tạo link thanh toán PayOS."
    };
}

/**
 * Gọi Google Apps Script để đối soát trạng thái thanh toán của đơn hàng trên PayOS
 */
export async function verifyPayosOrderPayment(orderCode, rawWebhookUrls = "") {
    if (!orderCode) {
        throw new Error("Đơn hàng chưa có mã đối soát PayOS (payosOrderCode).");
    }

    const webhookList = parseWebhookUrlList(rawWebhookUrls || EMAIL_CONFIG.appsScriptWebhookUrl || "");
    if (webhookList.length === 0) {
        throw new Error("Chưa cấu hình Google Apps Script Webhook URL để kết nối PayOS.");
    }

    const targetUrl = webhookList[0];
    const response = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
            action: "check_payos_status",
            orderCode: Number(orderCode)
        })
    });

    const result = await response.json();
    if (!result || result.status !== "success") {
        throw new Error((result && result.message) || "Lỗi kiểm tra trạng thái PayOS.");
    }

    return {
        success: true,
        orderCode: result.orderCode,
        payosStatus: result.payosStatus,
        isPaid: Boolean(result.isPaid),
        amount: result.amount,
        amountPaid: result.amountPaid
    };
}
