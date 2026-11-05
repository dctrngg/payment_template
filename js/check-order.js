/**
 * ==============================================================================
 * js/check-order.js - Tra cứu trạng thái Đơn Đặt Vé & Mã Vé Điện Tử (QR)
 * ==============================================================================
 * Hỗ trợ tra cứu bằng cả:
 * 1. Mã Đơn Hàng (Order ID): Hiển thị trạng thái thanh toán & mã vé đã che mờ bảo mật.
 * 2. Mã Vé Check-in (VD: HVC-8K4P9X-E3A1 nhận qua Email): Hiển thị mã QR Check-in.
 */

import { EVENT_CONFIG, FIREBASE_CONFIG } from "./config.js";
import { db, doc, getDoc, escapeHtml } from "./firebase-core.js";
import { getTicketQrImageUrl, autoFulfillPayosOrder } from "./ticket-service.js";

const output = document.querySelector('.output');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchButton');

document.title = `Tra Cứu Đơn Vé - ${EVENT_CONFIG.eventName}`;

function renderOrderCard(orderId, data) {
    const rawStatus = String(data.status || '').toUpperCase();
    const isApproved = rawStatus === 'APPROVED' || rawStatus === 'CONFIRMED' || rawStatus === 'PAID';
    const isBillVerified = rawStatus === 'BILL_VERIFIED';

    let statusText = '⏳ Đang chờ BTC đối soát biên lai chuyển khoản';
    let statusColor = '#d97706';

    if (isApproved) {
        statusText = '✓ Đã phát hành Vé Điện Tử & Gửi qua Email của bạn';
        statusColor = '#059669';
    } else if (isBillVerified) {
        statusText = '🛡️ Đã xác nhận biên lai hợp lệ — Đang chờ phát hành mã vé qua Email';
        statusColor = '#0284c7';
    }

    const safeId = escapeHtml(orderId);
    const safeName = escapeHtml(data.customerName || data.name || '---');
    const safePhone = escapeHtml(data.phone || '---');
    const safeEmail = escapeHtml(data.email || '---');
    const safeQty = Number(data.quantity) || 1;
    const safeTotal = (Number(data.totalAmount) || EVENT_CONFIG.ticketPrice).toLocaleString('vi-VN');
    const maskedTickets = Array.isArray(data.maskedTickets) ? data.maskedTickets : [];

    const maskedListHtml = isApproved && maskedTickets.length > 0
        ? `
            <div style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed #cbd5e1;">
                <p style="font-size: 13.5px; font-weight: 800; color: #0f172a; margin-bottom: 6px;">
                    🔒 Danh sách vé đã phát hành (Đã ẩn một phần để bảo mật):
                </p>
                <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;">
                    ${maskedTickets.map(m => `<span style="background: #e2e8f0; color: #0f172a; font-family: Consolas, monospace; font-size: 13px; font-weight: 700; padding: 4px 10px; border-radius: 6px;">${escapeHtml(m)}</span>`).join('')}
                </div>
                <p style="font-size: 12.5px; color: #475569; line-height: 1.45;">
                    📧 Toàn bộ <strong>Mã Vé đầy đủ kèm QR Check-in</strong> đã được gửi riêng tới hộp thư <strong>${safeEmail}</strong> của bạn. Bạn có thể nhập Mã Vé trong email vào ô tìm kiếm phía trên để tải lại mã QR.
                </p>
            </div>
        `
        : '';

    return `
        <div style="background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 14px; padding: 18px; color: #0f172a;">
            <h3 style="font-size: 15px; color: #e11d48; margin-bottom: 10px;">MÃ ĐƠN: ${safeId}</h3>
            <p style="margin: 6px 0; font-size: 14px;"><strong>Sự kiện:</strong> ${escapeHtml(EVENT_CONFIG.eventName)}</p>
            <p style="margin: 6px 0; font-size: 14px;"><strong>Họ và Tên:</strong> ${safeName}</p>
            <p style="margin: 6px 0; font-size: 14px;"><strong>Số điện thoại:</strong> ${safePhone}</p>
            <p style="margin: 6px 0; font-size: 14px;"><strong>Email nhận vé:</strong> ${safeEmail}</p>
            <p style="margin: 6px 0; font-size: 14px;"><strong>Số lượng vé:</strong> ${safeQty} vé (${safeTotal} VNĐ)</p>
            <p style="margin: 10px 0 0 0; font-size: 14px;"><strong>Trạng thái:</strong> <span style="color: ${statusColor}; font-weight: 700;">${statusText}</span></p>
            ${maskedListHtml}
        </div>
    `;
}

function renderSingleTicketCard(ticketCode, data) {
    const isValid = data.status === 'VALID';
    const isCheckedIn = Boolean(data.checkedIn);
    const safeCode = escapeHtml(ticketCode);
    const safeName = escapeHtml(data.customerName || '---');
    const safePhone = escapeHtml(data.phone || '---');
    const safeLabel = escapeHtml(data.ticketLabel || 'Vé sự kiện');
    const qrUrl = getTicketQrImageUrl(ticketCode, 200);
    const fallbackQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=${encodeURIComponent(ticketCode)}`;

    let badgeHtml = `<span style="color: #059669; font-weight: 800;">✓ Vé Hợp Lệ — Chưa sử dụng (Sẵn sàng Check-in)</span>`;
    if (!isValid) {
        badgeHtml = `<span style="color: #dc2626; font-weight: 800;">⚠️ Vé chưa được kích hoạt hoặc đã thu hồi</span>`;
    } else if (isCheckedIn) {
        const timeStr = data.checkedInAt && data.checkedInAt.toDate
            ? data.checkedInAt.toDate().toLocaleString('vi-VN')
            : 'Đã ghi nhận';
        badgeHtml = `<span style="color: #d97706; font-weight: 800;">🔒 Vé đã Check-in vào cổng (${escapeHtml(timeStr)})</span>`;
    }

    return `
        <div style="background: #f8fafc; border: 2px solid #e11d48; border-radius: 14px; padding: 18px; color: #0f172a;">
            <h3 style="font-size: 16px; color: #e11d48; margin-bottom: 10px;">🎟️ MÃ VÉ: ${safeCode}</h3>
            <p style="margin: 6px 0; font-size: 14px;"><strong>Sự kiện:</strong> ${escapeHtml(data.eventName || EVENT_CONFIG.eventName)}</p>
            <p style="margin: 6px 0; font-size: 14px;"><strong>Loại vé:</strong> ${safeLabel}</p>
            <p style="margin: 6px 0; font-size: 14px;"><strong>Khách hàng:</strong> ${safeName} (${safePhone})</p>
            <p style="margin: 10px 0; font-size: 14px;"><strong>Tình trạng vé:</strong> ${badgeHtml}</p>
            ${isValid && !isCheckedIn ? `
                <div style="text-align: center; margin-top: 12px; background: #fff; padding: 12px; border-radius: 12px; border: 1px solid #e2e8f0;">
                    <img src="${qrUrl}" alt="QR ${safeCode}" onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='${fallbackQrUrl}';}" style="width: 155px; height: 155px;" />
                    <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Xuất trình mã QR này tại quầy Check-in</div>
                </div>
            ` : ''}
        </div>
    `;
}

async function lookupOrder(rawKeyword) {
    if (!output) return;
    const safeKeyword = String(rawKeyword).trim().replace(/[^a-zA-Z0-9_-]/g, '');

    if (!safeKeyword || safeKeyword.length < 4) {
        output.innerHTML = `<p style="color: #dc2626; text-align: center;">Vui lòng nhập Mã Đơn Hàng hoặc Mã Vé hợp lệ.</p>`;
        return;
    }

    output.innerHTML = `<p style="text-align: center; color: #64748b;">⏳ Đang kiểm tra dữ liệu trên hệ thống...</p>`;

    try {
        const upperKeyword = safeKeyword.toUpperCase();
        if (upperKeyword.includes('-')) {
            const ticketRef = doc(db, FIREBASE_CONFIG.ticketsCollection || "tickets", upperKeyword);
            const ticketSnap = await getDoc(ticketRef);
            if (ticketSnap.exists()) {
                output.innerHTML = renderSingleTicketCard(ticketSnap.id, ticketSnap.data());
                return;
            }
        }

        const docRef = doc(db, FIREBASE_CONFIG.ordersCollection || "orders", safeKeyword);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            let orderData = docSnap.data();
            const rawSt = String(orderData.status || '').toUpperCase();
            if (rawSt !== 'APPROVED' && orderData.payosOrderCode) {
                try {
                    const autoRes = await autoFulfillPayosOrder(docSnap.id, orderData.payosOrderCode);
                    if (autoRes && autoRes.isPaid) {
                        orderData = {
                            ...orderData,
                            status: 'APPROVED',
                            maskedTickets: autoRes.maskedTickets || orderData.maskedTickets || []
                        };
                    }
                } catch (_) {}
            }
            output.innerHTML = renderOrderCard(docSnap.id, orderData);
            return;
        }

        const fallbackTicketSnap = await getDoc(doc(db, FIREBASE_CONFIG.ticketsCollection || "tickets", upperKeyword));
        if (fallbackTicketSnap.exists()) {
            output.innerHTML = renderSingleTicketCard(fallbackTicketSnap.id, fallbackTicketSnap.data());
            return;
        }

        output.innerHTML = `<p style="color: #dc2626; text-align: center; font-size: 14px;">Không tìm thấy đơn hàng hoặc mã vé <strong>${escapeHtml(safeKeyword)}</strong>. Vui lòng kiểm tra lại.</p>`;
    } catch (err) {
        output.innerHTML = `<p style="color: #dc2626; text-align: center; font-size: 14px;">Không thể tra cứu lúc này (${escapeHtml(err.message)}).</p>`;
    }
}

if (searchBtn) {
    searchBtn.addEventListener('click', () => {
        if (searchInput && searchInput.value.trim()) lookupOrder(searchInput.value);
    });
}

if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && searchInput.value.trim()) lookupOrder(searchInput.value);
    });
}

const urlParams = new URLSearchParams(window.location.search);
const initialCode = urlParams.get('code') || urlParams.get('id');
if (initialCode && searchInput) {
    searchInput.value = initialCode;
    lookupOrder(initialCode);
}
