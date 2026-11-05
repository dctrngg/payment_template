/**
 * ==============================================================================
 * js/checkout.js - Logic Đặt Vé, Tạo VietQR Động, Nén Ảnh & Lưu Firestore
 * ==============================================================================
 * Tự động đọc cấu hình từ js/config.js. Không cần chỉnh sửa file này khi đổi sự kiện.
 */

import { EVENT_CONFIG, BANK_CONFIG, VOUCHER_CODES, FIREBASE_CONFIG, UPLOAD_CONFIG, EMAIL_CONFIG } from "./config.js";
import { db, collection, addDoc, serverTimestamp, escapeHtml } from "./firebase-core.js";
import { generatePayosOrderCode, createPayosPaymentLink } from "./ticket-service.js";

// Biến trạng thái hiện tại
let currentTotalAmount = EVENT_CONFIG.ticketPrice;
let currentPayosOrderCode = generatePayosOrderCode();
let currentTransferMemo = `HVC ${currentPayosOrderCode} 1 ${BANK_CONFIG.memoUnitLabel}`;
let currentQrUrl = "";
let appliedVoucherCode = "";
let compressedBillBlob = null;

// Tham chiếu DOM
const formElement = document.getElementById("form");
const customerInput = document.getElementById("customer");
const phoneInput = document.getElementById("phone");
const emailInput = document.getElementById("email");
const linkfbInput = document.getElementById("linkfb");
const referrerInput = document.getElementById("referrer");
const quantityInput = document.getElementById("quantity");
const voucherInput = document.getElementById("voucher-input");
const imageInput = document.getElementById("image");

const totalDueElement = document.getElementById("total-due");
const quantityDisplayElement = document.getElementById("quantity-display");
const discountRow = document.getElementById("discount-row");
const discountLabel = document.getElementById("discount-label");
const discountAmountEl = document.getElementById("discount-amount");

const vietqrImg = document.getElementById("vietqr-img");
const qrAmountDisplay = document.getElementById("qr-amount-display");
const qrMemoDisplay = document.getElementById("qr-memo-display");
const draftBadge = document.getElementById("draft-badge");
const btnClearDraft = document.getElementById("btn-clear-draft");
const toastEl = document.getElementById("toast-notify");

// ==============================================================================
// 1. RENDER CẤU HÌNH SỰ KIỆN & NGÂN HÀNG TỪ CONFIG.JS LÊN GIAO DIỆN
// ==============================================================================
function initConfigUI() {
    document.title = `Đặt Vé - ${EVENT_CONFIG.eventName}`;
    const setTxt = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    setTxt("cfg-nav-title", EVENT_CONFIG.eventName);
    setTxt("cfg-event-badge", EVENT_CONFIG.eventBadge);
    setTxt("cfg-status-badge", EVENT_CONFIG.statusBadge);
    setTxt("cfg-event-name", EVENT_CONFIG.eventName);
    setTxt("cfg-ticket-type", EVENT_CONFIG.ticketTypeName);

    const formattedUnit = EVENT_CONFIG.ticketPrice.toLocaleString('vi-VN') + " VNĐ";
    setTxt("cfg-unit-price-top", formattedUnit);
    setTxt("cfg-unit-price", formattedUnit);
    setTxt("cfg-bank-name", BANK_CONFIG.bankDisplayName);
    setTxt("cfg-bank-acc", BANK_CONFIG.accountNo);
    setTxt("cfg-bank-owner", BANK_CONFIG.accountName);

    const landingBrand = document.getElementById("cfg-landing-link-brand");
    const landingBtn = document.getElementById("cfg-landing-link");
    if (landingBrand) landingBrand.href = EVENT_CONFIG.landingPageUrl;
    if (landingBtn) landingBtn.href = EVENT_CONFIG.landingPageUrl;

    if (quantityInput) {
        quantityInput.max = String(EVENT_CONFIG.maxQuantityPerOrder);
    }
    const maxQtyLabel = document.getElementById("cfg-max-qty-label");
    if (maxQtyLabel) {
        maxQtyLabel.innerHTML = `Số lượng vé (Tối đa ${EVENT_CONFIG.maxQuantityPerOrder} vé / lượt) <span class="req">*</span>`;
    }

    // Render nút chọn nhanh số lượng
    const quickContainer = document.getElementById("quick-qty-container");
    if (quickContainer && Array.isArray(EVENT_CONFIG.quickQuantities)) {
        quickContainer.innerHTML = EVENT_CONFIG.quickQuantities.map((q, idx) => `
            <button type="button" class="qty-pill ${idx === 0 ? 'active' : ''}" data-qty="${q}">${q} vé</button>
        `).join('');

        quickContainer.querySelectorAll(".qty-pill").forEach(pill => {
            pill.addEventListener("click", () => {
                const qty = parseInt(pill.dataset.qty, 10);
                if (quantityInput && qty >= 1 && qty <= EVENT_CONFIG.maxQuantityPerOrder) {
                    quantityInput.value = qty;
                    updatePaymentAndVietQR();
                }
            });
        });
    }

    // Render danh sách điều khoản
    const termsContainer = document.getElementById("cfg-terms-list");
    if (termsContainer && Array.isArray(EVENT_CONFIG.termsNotes)) {
        termsContainer.innerHTML = EVENT_CONFIG.termsNotes.map(note => `<p>• ${escapeHtml(note)}</p>`).join('');
    }
}

// ==============================================================================
// 2. TIỆN ÍCH CHUẨN HÓA TIẾNG VIỆT & TOAST COPY
// ==============================================================================
function removeVietnameseTones(str) {
    if (!str) return '';
    str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    str = str.replace(/đ/g, 'd').replace(/Đ/g, 'D');
    str = str.replace(/[^a-zA-Z0-9 ]/g, ' ');
    str = str.replace(/\s+/g, ' ').trim();
    return str;
}

let toastTimeout = null;
function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("show");
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toastEl.classList.remove("show");
    }, 2600);
}

async function copyToClipboard(text, label) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const tempInput = document.createElement("textarea");
            tempInput.value = text;
            tempInput.style.position = "fixed";
            tempInput.style.left = "-9999px";
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand("copy");
            document.body.removeChild(tempInput);
        }
        showToast(`✓ Đã sao chép ${label}: ${text}`);
    } catch (err) {
        showToast("Không thể sao chép tự động, vui lòng bôi đen để copy.");
    }
}

// ==============================================================================
// 3. TÍNH TIỀN & CẬP NHẬT MÃ VIETQR REAL-TIME
// ==============================================================================
function updatePaymentAndVietQR() {
    const maxQty = EVENT_CONFIG.maxQuantityPerOrder || 5;
    let quantity = parseInt(quantityInput ? quantityInput.value : 1, 10);
    if (isNaN(quantity) || quantity < 1) quantity = 1;
    if (quantity > maxQty) quantity = maxQty;
    if (quantityInput) quantityInput.value = quantity;

    document.querySelectorAll(".qty-pill").forEach(pill => {
        pill.classList.toggle("active", parseInt(pill.dataset.qty, 10) === quantity);
    });

    const baseTotal = quantity * EVENT_CONFIG.ticketPrice;
    let discountValue = 0;

    if (appliedVoucherCode && VOUCHER_CODES[appliedVoucherCode]) {
        const rule = VOUCHER_CODES[appliedVoucherCode];
        if (rule.type === 'percent') {
            discountValue = Math.round((baseTotal * rule.value) / 100);
        } else if (rule.type === 'fixed_per_ticket') {
            discountValue = rule.value * quantity;
        }
        if (discountRow) {
            discountRow.style.display = "flex";
            if (discountLabel) discountLabel.textContent = rule.label;
            if (discountAmountEl) discountAmountEl.textContent = `-${discountValue.toLocaleString('vi-VN')} VNĐ`;
        }
    } else {
        if (discountRow) discountRow.style.display = "none";
    }

    currentTotalAmount = Math.max(0, baseTotal - discountValue);
    const formattedPrice = currentTotalAmount.toLocaleString('vi-VN') + ' VNĐ';

    if (totalDueElement) totalDueElement.textContent = formattedPrice;
    if (quantityDisplayElement) quantityDisplayElement.textContent = `${quantity} vé`;
    if (qrAmountDisplay) qrAmountDisplay.textContent = formattedPrice;

    const rawCustomer = customerInput ? customerInput.value.trim() : '';
    const rawPhone = phoneInput ? phoneInput.value.trim() : '';

    const cleanCustomer = removeVietnameseTones(rawCustomer);
    const cleanPhone = rawPhone.replace(/[^0-9]/g, '');

    let memoParts = [`HVC ${currentPayosOrderCode}`, `${quantity} ${BANK_CONFIG.memoUnitLabel || 'VE'}`];
    if (cleanCustomer) memoParts.push(cleanCustomer.toUpperCase());
    if (cleanPhone) memoParts.push(cleanPhone);
    currentTransferMemo = memoParts.join(' ');

    if (qrMemoDisplay) qrMemoDisplay.textContent = currentTransferMemo;

    currentQrUrl = `https://img.vietqr.io/image/${BANK_CONFIG.bankId}-${BANK_CONFIG.accountNo}-${BANK_CONFIG.template}.png?amount=${currentTotalAmount}&addInfo=${encodeURIComponent(currentTransferMemo)}&accountName=${encodeURIComponent(BANK_CONFIG.accountName)}`;

    if (vietqrImg && vietqrImg.src !== currentQrUrl) {
        vietqrImg.src = currentQrUrl;
    }

    saveDraftToLocalStorage();
}

// ==============================================================================
// 4. SỰ KIỆN NÚT CỘNG/TRỪ, VOUCHER, COPY & TẢI ẢNH QR
// ==============================================================================
const btnMinus = document.getElementById("btn-qty-minus");
const btnPlus = document.getElementById("btn-qty-plus");

if (btnMinus && quantityInput) {
    btnMinus.addEventListener("click", () => {
        let current = parseInt(quantityInput.value, 10) || 1;
        if (current > 1) {
            quantityInput.value = current - 1;
            updatePaymentAndVietQR();
        } else {
            showToast("Số lượng tối thiểu là 1 vé.");
        }
    });
}

if (btnPlus && quantityInput) {
    btnPlus.addEventListener("click", () => {
        const maxQty = EVENT_CONFIG.maxQuantityPerOrder || 5;
        let current = parseInt(quantityInput.value, 10) || 1;
        if (current < maxQty) {
            quantityInput.value = current + 1;
            updatePaymentAndVietQR();
        } else {
            showToast(`Mỗi lượt chỉ được đặt tối đa ${maxQty} vé.`);
        }
    });
}

const btnApplyVoucher = document.getElementById("btn-apply-voucher");
const fbVoucher = document.getElementById("fb-voucher");

if (btnApplyVoucher && voucherInput) {
    btnApplyVoucher.addEventListener("click", () => {
        const code = voucherInput.value.trim().toUpperCase();
        if (!code) {
            appliedVoucherCode = "";
            if (fbVoucher) { fbVoucher.className = "field-feedback"; fbVoucher.textContent = ""; }
            updatePaymentAndVietQR();
            return;
        }
        if (VOUCHER_CODES[code]) {
            appliedVoucherCode = code;
            if (fbVoucher) {
                fbVoucher.className = "field-feedback success";
                fbVoucher.textContent = `✓ Đã áp dụng: ${VOUCHER_CODES[code].label}`;
            }
            showToast(`🎉 Áp dụng mã ${code} thành công!`);
        } else {
            appliedVoucherCode = "";
            if (fbVoucher) {
                fbVoucher.className = "field-feedback error";
                fbVoucher.textContent = "Mã giảm giá không tồn tại hoặc đã hết hạn.";
            }
        }
        updatePaymentAndVietQR();
    });
}

const btnCopyAcc = document.getElementById("btn-copy-acc");
if (btnCopyAcc) btnCopyAcc.addEventListener("click", () => copyToClipboard(BANK_CONFIG.accountNo, "Số tài khoản"));

const btnCopyAmount = document.getElementById("btn-copy-amount");
if (btnCopyAmount) btnCopyAmount.addEventListener("click", () => copyToClipboard(String(currentTotalAmount), "Số tiền"));

const btnCopyMemo = document.getElementById("btn-copy-memo");
if (btnCopyMemo) btnCopyMemo.addEventListener("click", () => copyToClipboard(currentTransferMemo, "Nội dung CK"));

const btnDownloadQr = document.getElementById("btn-download-qr");
if (btnDownloadQr) {
    btnDownloadQr.addEventListener("click", async () => {
        if (!currentQrUrl) return;
        try {
            showToast("⏳ Đang tạo ảnh PNG mã QR...");
            const svgUrl = currentQrUrl.replace('.png?', '.svg?');
            const response = await fetch(svgUrl);
            const svgText = await response.text();
            const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
            const domUrl = URL.createObjectURL(svgBlob);

            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement("canvas");
                canvas.width = img.width || 600;
                canvas.height = img.height || 700;
                const ctx = canvas.getContext("2d");
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(domUrl);

                canvas.toBlob((pngBlob) => {
                    if (!pngBlob) return window.open(currentQrUrl, "_blank");
                    const pngUrl = URL.createObjectURL(pngBlob);
                    const link = document.createElement("a");
                    link.href = pngUrl;
                    link.download = `VietQR_${currentTransferMemo.replace(/\s+/g, '_')}.png`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(pngUrl);
                    showToast("✓ Đã tải ảnh QR! Mở App Ngân hàng chọn ảnh để thanh toán.");
                }, "image/png");
            };
            img.onerror = () => { URL.revokeObjectURL(domUrl); window.open(currentQrUrl, "_blank"); };
            img.src = domUrl;
        } catch (err) {
            window.open(currentQrUrl, "_blank");
        }
    });
}

// ==============================================================================
// 5. LƯU NHÁP TỰ ĐỘNG (LOCALSTORAGE AUTO-SAVE)
// ==============================================================================
function saveDraftToLocalStorage() {
    try {
        const draftData = {
            customer: customerInput ? customerInput.value : "",
            phone: phoneInput ? phoneInput.value : "",
            email: emailInput ? emailInput.value : "",
            linkfb: linkfbInput ? linkfbInput.value : "",
            referrer: referrerInput ? referrerInput.value : "",
            quantity: quantityInput ? quantityInput.value : "1",
            voucher: voucherInput ? voucherInput.value : ""
        };
        if (draftData.customer || draftData.phone || draftData.email || draftData.linkfb) {
            localStorage.setItem(UPLOAD_CONFIG.draftStorageKey, JSON.stringify(draftData));
            if (draftBadge) draftBadge.style.display = "inline-flex";
        }
    } catch (e) {}
}

function restoreDraftFromLocalStorage() {
    try {
        const saved = localStorage.getItem(UPLOAD_CONFIG.draftStorageKey);
        if (!saved) return;
        const draft = JSON.parse(saved);
        if (customerInput && draft.customer) customerInput.value = draft.customer;
        if (phoneInput && draft.phone) phoneInput.value = draft.phone;
        if (emailInput && draft.email) emailInput.value = draft.email;
        if (linkfbInput && draft.linkfb) linkfbInput.value = draft.linkfb;
        if (referrerInput && draft.referrer) referrerInput.value = draft.referrer;
        if (quantityInput && draft.quantity) quantityInput.value = draft.quantity;
        if (voucherInput && draft.voucher) {
            voucherInput.value = draft.voucher;
            const upper = draft.voucher.trim().toUpperCase();
            if (VOUCHER_CODES[upper]) appliedVoucherCode = upper;
        }
        if (draft.customer || draft.phone || draft.email) {
            if (draftBadge) draftBadge.style.display = "inline-flex";
        }
    } catch (e) {}
}

function clearDraftStorage() {
    try {
        localStorage.removeItem(UPLOAD_CONFIG.draftStorageKey);
        if (draftBadge) draftBadge.style.display = "none";
    } catch (e) {}
}

if (btnClearDraft) {
    btnClearDraft.addEventListener("click", () => {
        clearDraftStorage();
        if (formElement) formElement.reset();
        appliedVoucherCode = "";
        if (fbVoucher) fbVoucher.className = "field-feedback";
        resetBillPreview();
        document.querySelectorAll(".form-control").forEach(el => el.classList.remove("is-valid", "is-invalid"));
        document.querySelectorAll(".field-feedback").forEach(el => { el.className = "field-feedback"; el.textContent = ""; });
        updatePaymentAndVietQR();
        showToast("Đã xóa dữ liệu nháp.");
    });
}

// ==============================================================================
// 6. INLINE VALIDATION & NÉN ẢNH CANVAS
// ==============================================================================
function setFieldState(inputEl, feedbackId, isValid, message = "") {
    if (!inputEl) return;
    const fbEl = document.getElementById(feedbackId);
    inputEl.classList.remove("is-valid", "is-invalid");
    if (isValid === true) {
        inputEl.classList.add("is-valid");
        if (fbEl) { fbEl.className = "field-feedback success"; fbEl.textContent = message; }
    } else if (isValid === false) {
        inputEl.classList.add("is-invalid");
        if (fbEl) { fbEl.className = "field-feedback error"; fbEl.textContent = message; }
    } else if (fbEl) {
        fbEl.className = "field-feedback";
        fbEl.textContent = "";
    }
}

function validateCustomerField() {
    const val = customerInput.value.trim();
    if (!val || val.length < 2) {
        setFieldState(customerInput, "fb-customer", false, "Vui lòng nhập họ và tên (tối thiểu 2 ký tự).");
        return false;
    }
    setFieldState(customerInput, "fb-customer", true, "");
    return true;
}

function validatePhoneField() {
    const val = phoneInput.value.trim();
    if (!/^0[0-9]{9}$/.test(val)) {
        setFieldState(phoneInput, "fb-phone", false, "SĐT phải gồm 10 chữ số và bắt đầu bằng số 0.");
        return false;
    }
    setFieldState(phoneInput, "fb-phone", true, "");
    return true;
}

function validateEmailField() {
    const val = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        setFieldState(emailInput, "fb-email", false, "Vui lòng nhập đúng định dạng email nhận vé.");
        return false;
    }
    setFieldState(emailInput, "fb-email", true, "");
    return true;
}

function validateFbField() {
    const val = linkfbInput.value.trim();
    if (!/^https?:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.com)\/.+$/i.test(val)) {
        setFieldState(linkfbInput, "fb-linkfb", false, "Link FB cần bắt đầu bằng https://facebook.com/...");
        return false;
    }
    setFieldState(linkfbInput, "fb-linkfb", true, "");
    return true;
}

if (customerInput) {
    customerInput.addEventListener("input", () => { updatePaymentAndVietQR(); if (customerInput.value.trim().length >= 2) validateCustomerField(); });
    customerInput.addEventListener("blur", validateCustomerField);
}
if (phoneInput) {
    phoneInput.addEventListener("input", () => { phoneInput.value = phoneInput.value.replace(/[^0-9]/g, ''); updatePaymentAndVietQR(); if (phoneInput.value.length === 10) validatePhoneField(); });
    phoneInput.addEventListener("blur", validatePhoneField);
}
if (emailInput) {
    emailInput.addEventListener("input", () => { saveDraftToLocalStorage(); if (emailInput.classList.contains("is-invalid")) validateEmailField(); });
    emailInput.addEventListener("blur", validateEmailField);
}
if (linkfbInput) {
    linkfbInput.addEventListener("input", () => { saveDraftToLocalStorage(); if (linkfbInput.classList.contains("is-invalid")) validateFbField(); });
    linkfbInput.addEventListener("blur", validateFbField);
}
if (referrerInput) referrerInput.addEventListener("input", saveDraftToLocalStorage);

const uploadZone = document.getElementById("upload-zone");
const billPreviewBox = document.getElementById("bill-preview-box");
const billPreviewImg = document.getElementById("bill-preview-img");
const billFileName = document.getElementById("bill-file-name");
const billFileSize = document.getElementById("bill-file-size");
const btnRemoveBill = document.getElementById("btn-remove-bill");

function compressImageFile(file, maxDimension = 1200, quality = 0.75) {
    return new Promise((resolve) => {
        if (!file || !file.type.startsWith("image/")) return resolve({ file, base64: "" });
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                let width = img.width;
                let height = img.height;
                if (width > maxDimension || height > maxDimension) {
                    if (width > height) { height = Math.round((height * maxDimension) / width); width = maxDimension; }
                    else { width = Math.round((width * maxDimension) / height); height = maxDimension; }
                }
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                canvas.getContext("2d").drawImage(img, 0, 0, width, height);

                // Tạo data URL Base64 nhỏ gọn lưu trực tiếp vào Firestore phòng khi ImgBB chậm/lỗi
                const base64Data = canvas.toDataURL("image/jpeg", 0.70);

                canvas.toBlob((blob) => {
                    const finalFile = (blob && blob.size < file.size)
                        ? new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), { type: "image/jpeg", lastModified: Date.now() })
                        : file;
                    resolve({ file: finalFile, base64: base64Data });
                }, "image/jpeg", quality);
            };
            img.onerror = () => resolve({ file, base64: "" });
            img.src = e.target.result;
        };
        reader.onerror = () => resolve({ file, base64: "" });
        reader.readAsDataURL(file);
    });
}

let compressedBillBase64 = "";

function resetBillPreview() {
    compressedBillBlob = null;
    compressedBillBase64 = "";
    if (imageInput) imageInput.value = "";
    if (billPreviewBox) billPreviewBox.style.display = "none";
    if (uploadZone) uploadZone.style.display = "block";
}

if (imageInput) {
    imageInput.addEventListener("change", async function () {
        const rawFile = this.files && this.files[0];
        if (!rawFile) return resetBillPreview();

        if (!rawFile.type.startsWith("image/")) {
            resetBillPreview();
            return showPopup("Vui lòng chỉ chọn file hình ảnh (JPG, PNG, WEBP).");
        }
        if (rawFile.size > 12 * 1024 * 1024) {
            resetBillPreview();
            return showPopup("Ảnh quá lớn (>12MB). Vui lòng chọn ảnh chụp màn hình nhẹ hơn.");
        }

        if (billPreviewImg) billPreviewImg.src = URL.createObjectURL(rawFile);
        if (billFileName) billFileName.textContent = rawFile.name;
        if (billFileSize) billFileSize.textContent = "Đang tối ưu dung lượng ảnh...";
        if (uploadZone) uploadZone.style.display = "none";
        if (billPreviewBox) billPreviewBox.style.display = "flex";
        setFieldState(imageInput, "fb-image", null, "");

        const res = await compressImageFile(rawFile);
        compressedBillBlob = res.file;
        compressedBillBase64 = res.base64;
        const kbSize = Math.max(1, Math.round((compressedBillBlob.size || 0) / 1024));
        if (billFileSize) billFileSize.textContent = `✓ Đã tối ưu (${kbSize} KB) - Sẵn sàng gửi nhanh`;
    });
}
if (btnRemoveBill) btnRemoveBill.addEventListener("click", resetBillPreview);

// ==============================================================================
// 7. SUBMIT ĐƠN HÀNG & CHUYỂN SANG CỔNG THANH TOÁN QR TỰ ĐỘNG PAYOS (100% PAYOS)
// ==============================================================================
function showConfirmedPopup(message) {
    return new Promise((resolve) => {
        const popupOverlay = document.getElementById("confirmation-popup");
        const popupMessage = document.getElementById("popup-cf-message");
        const popupConfirmBtn = document.getElementById("popup-confirm-btn");
        const popupCloseBtn = document.getElementById("popup-cf-close");
        if (popupMessage) popupMessage.textContent = message;
        if (popupOverlay) popupOverlay.style.display = 'flex';
        if (popupConfirmBtn) popupConfirmBtn.onclick = () => { resolve('confirmed'); if (popupOverlay) popupOverlay.style.display = 'none'; };
        if (popupCloseBtn) popupCloseBtn.onclick = () => { resolve('canceled'); if (popupOverlay) popupOverlay.style.display = 'none'; };
    });
}

if (formElement) {
    formElement.onsubmit = async function (event) {
        event.preventDefault();

        const cooldownMs = (UPLOAD_CONFIG.submitCooldownSeconds || 30) * 1000;
        const lastSubmitTs = parseInt(localStorage.getItem('ticket_last_submit_ts') || '0', 10);
        const nowTs = Date.now();
        if (nowTs - lastSubmitTs < cooldownMs) {
            const waitSec = Math.ceil((cooldownMs - (nowTs - lastSubmitTs)) / 1000);
            return showPopup(`Bạn vừa tạo một phiên thanh toán. Vui lòng đợi ${waitSec} giây trước khi tạo đơn tiếp theo.`);
        }

        const isCustomerOk = validateCustomerField();
        const isPhoneOk = validatePhoneField();
        const isEmailOk = validateEmailField();
        const isFbOk = validateFbField();

        const termsCheckbox = document.getElementById("terms-agree");
        if (termsCheckbox && !termsCheckbox.checked) {
            return showPopup("Vui lòng tích chọn đồng ý với quy định của sự kiện.");
        }

        if (!isCustomerOk || !isPhoneOk || !isEmailOk || !isFbOk) {
            return showPopup("Vui lòng kiểm tra lại các trường thông tin báo đỏ trên biểu mẫu.");
        }

        const customer = customerInput.value.trim().slice(0, 100);
        const phone = phoneInput.value.trim();
        const email = emailInput.value.trim().slice(0, 120);
        const linkfb = linkfbInput.value.trim().slice(0, 300);
        const referrer = referrerInput ? referrerInput.value.trim().slice(0, 100) : '';
        const quantity = Math.min(EVENT_CONFIG.maxQuantityPerOrder || 5, Math.max(1, parseInt(quantityInput.value, 10) || 1));

        const formattedPrice = currentTotalAmount.toLocaleString('vi-VN');
        const result = await showConfirmedPopup(`Xác nhận đặt ${quantity} vé (Tổng: ${formattedPrice} VNĐ) cho ${customer} - SĐT: ${phone} và chuyển sang cổng quét mã QR PayOS?`);

        if (result === 'confirmed') {
            const submitBtn = document.getElementById("submit-btn");
            if (submitBtn) submitBtn.disabled = true;

            // Sinh mã orderCode mới cho phiên thanh toán này để tránh trùng lặp nếu khách vừa hủy đơn trước
            currentPayosOrderCode = generatePayosOrderCode();
            currentTransferMemo = `HVC ${currentPayosOrderCode}`;
            if (qrMemoDisplay) qrMemoDisplay.textContent = currentTransferMemo;

            showPopup(`
                <div class="css-spinner"></div>
                <p style="font-weight: 700; font-size: 15px; margin: 8px 0 4px 0;">Đang khởi tạo mã VietQR tự động trên PayOS...</p>
                <p style="font-size: 13px; color: #64748b;">Hệ thống sẽ tự động xác nhận ngay sau khi bạn quét mã chuyển khoản</p>
            `, true, true);

            try {
                const orderId = "ORD-" + currentPayosOrderCode;
                const pendingOrderData = {
                    orderId: orderId,
                    customerName: customer,
                    name: customer,
                    phone: phone,
                    email: email,
                    facebook: linkfb,
                    referrer: referrer,
                    voucherCode: appliedVoucherCode || "",
                    quantity: quantity,
                    ticketPrice: EVENT_CONFIG.ticketPrice,
                    totalAmount: currentTotalAmount,
                    transferMemo: currentTransferMemo,
                    payosOrderCode: currentPayosOrderCode,
                    ticketType: "e-ticket",
                    paymentMethod: "payos_qr"
                };

                // Lưu tạm vào bộ nhớ trình duyệt, KHÔNG ghi vào Firebase lúc này
                // Chỉ khi khách thanh toán PayOS thành công 100% thì mới ghi vào Firebase
                try {
                    sessionStorage.setItem('pending_order_' + currentPayosOrderCode, JSON.stringify(pendingOrderData));
                    localStorage.setItem('pending_order_latest', JSON.stringify(pendingOrderData));
                } catch (_) {}

                const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, "");
                const returnParams = new URLSearchParams({
                    orderId: orderId,
                    orderCode: String(currentPayosOrderCode),
                    customer: customer,
                    email: email,
                    phone: phone,
                    facebook: linkfb,
                    referrer: referrer,
                    voucher: appliedVoucherCode || "",
                    quantity: String(quantity),
                    total: String(currentTotalAmount)
                });
                const returnUrl = `${baseUrl}/thanks.html?${returnParams.toString()}`;
                const cancelUrl = `${baseUrl}/index.html`;

                const payosRes = await createPayosPaymentLink({
                    orderCode: currentPayosOrderCode,
                    amount: currentTotalAmount,
                    description: `HVC ${currentPayosOrderCode}`,
                    buyerName: customer,
                    buyerEmail: email,
                    buyerPhone: phone,
                    returnUrl: returnUrl,
                    cancelUrl: cancelUrl
                });

                if (payosRes.success && payosRes.checkoutUrl) {
                    localStorage.setItem('ticket_last_submit_ts', String(Date.now()));
                    clearDraftStorage();
                    window.location.href = payosRes.checkoutUrl;
                } else {
                    if (submitBtn) submitBtn.disabled = false;
                    showPopup(`Không thể khởi tạo cổng PayOS: ${escapeHtml(payosRes.reason || "Vui lòng thử lại sau giây lát.")}`);
                }

            } catch (err) {
                if (submitBtn) submitBtn.disabled = false;
                showPopup(`Đã xảy ra lỗi khi kết nối cổng thanh toán: ${escapeHtml(err.message || err)}`);
            }
        }
    };
}

function showPopup(message, isHtml = false, hideCloseButton = false) {
    const popup = document.getElementById("popup");
    const popupMessage = document.getElementById("popup-message");
    const popupCloseButton = document.getElementById("popup-close");
    if (!popup || !popupMessage) return;
    if (isHtml) popupMessage.innerHTML = message;
    else popupMessage.textContent = message;
    if (popupCloseButton) popupCloseButton.style.display = hideCloseButton ? "none" : "inline-block";
    popup.style.display = "flex";
}

const popupCloseBtn = document.getElementById("popup-close");
if (popupCloseBtn) popupCloseBtn.addEventListener("click", () => { document.getElementById("popup").style.display = "none"; });

// Khởi chạy
initConfigUI();
restoreDraftFromLocalStorage();
updatePaymentAndVietQR();

