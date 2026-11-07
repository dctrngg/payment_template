/**
 * ==============================================================================
 * js/admin-dashboard.js — LOGIC TRUNG TÂM SUPER DASHBOARD (GAME ON EDITION)
 * Theo dõi Doanh thu, Lượng vé, Dòng tiền theo ngày, Khung giờ vàng, CTV,
 * Voucher, Check-in Real-time, Auto-Pilot PayOS & Phát hành vé nhanh (POS).
 * ==============================================================================
 */

import { EVENT_CONFIG, FIREBASE_CONFIG, EMAIL_CONFIG } from "./config.js";
import {
    db,
    auth,
    collection,
    getDocs,
    getDoc,
    setDoc,
    query,
    where,
    onSnapshot,
    doc,
    deleteDoc,
    serverTimestamp,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    escapeHtml,
    sanitizeUrl
} from "./firebase-core.js";
import {
    checkServerRole,
    claimSuperAdminBootstrap,
    saveSuperAdminEmailsList,
    loadServerSecretConfig,
    saveServerSecretConfig,
    loadAllOrderTicketsForSuperAdmin,
    verifyOrderBillByReviewer,
    approveAndIssueTickets,
    revokeOrderTickets,
    buildTicketEmailHtml,
    sendTicketEmail,
    autoFulfillPayosOrder,
    downloadAllTicketsAsImages
} from "./ticket-service.js";

// Khởi tạo tiêu đề sự kiện
const loginEventNameEl = document.getElementById("login-event-name");
if (loginEventNameEl) loginEventNameEl.textContent = EVENT_CONFIG.eventName;
const dashTitleEl = document.getElementById("dashboard-title");
if (dashTitleEl) dashTitleEl.innerHTML = `<span class="live-dot"></span> ${escapeHtml(EVENT_CONFIG.eventName)} — Super Dashboard`;

// DOM Elements chính
const loginGate = document.getElementById("admin-login-gate");
const dashboardContainer = document.getElementById("admin-dashboard-container");
const loginForm = document.getElementById("admin-login-form");
const loginError = document.getElementById("admin-login-error");
const adminUserBadge = document.getElementById("admin-user-badge");
const roleBadge = document.getElementById("role-badge");
const btnLogout = document.getElementById("btn-logout");
const btnToggleSettings = document.getElementById("btn-toggle-settings");
const btnToggleAnalytics = document.getElementById("btn-toggle-analytics");
const analyticsSection = document.getElementById("analytics-section");
const btnOpenPosModal = document.getElementById("btn-open-pos-modal");

const bootstrapBanner = document.getElementById("bootstrap-banner");
const btnClaimSuper = document.getElementById("btn-claim-super");
const superSecurityPanel = document.getElementById("super-security-panel");
const superBatchBar = document.getElementById("super-batch-bar");
const securitySaveStatus = document.getElementById("security-save-status");

const hmacSecretInput = document.getElementById("hmac-secret-input");
const webhookUrlInput = document.getElementById("webhook-url-input");
const superEmailsInput = document.getElementById("super-emails-input");
const btnToggleSecret = document.getElementById("btn-toggle-secret");
const btnSaveSecurity = document.getElementById("btn-save-security");

const btnBatchVerified = document.getElementById("btn-batch-verified");
const btnBatchStop = document.getElementById("btn-batch-stop");
const batchProgressText = document.getElementById("batch-progress-text");
const verifiedCountLabel = document.getElementById("verified-count-label");

// Modals
const ticketModal = document.getElementById("ticket-modal");
const btnCloseModal = document.getElementById("btn-close-modal");
const btnModalSendEmail = document.getElementById("btn-modal-send-email");
const btnModalDownloadPng = document.getElementById("btn-modal-download-png");
const btnModalCopyHtml = document.getElementById("btn-modal-copy-html");
const btnModalOpenGmail = document.getElementById("btn-modal-open-gmail");
const modalPreviewContainer = document.getElementById("modal-preview-container");
const modalStatusBanner = document.getElementById("modal-status-banner");

const billLightboxModal = document.getElementById("bill-lightbox-modal");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxTitle = document.getElementById("lightbox-title");
const lightboxSubtitle = document.getElementById("lightbox-subtitle");
const btnCloseLightbox = document.getElementById("btn-close-lightbox");
const btnRotateBill = document.getElementById("btn-rotate-bill");
const btnZoomBill = document.getElementById("btn-zoom-bill");
const btnOpenBillTab = document.getElementById("btn-open-bill-tab");
const btnDownloadBill = document.getElementById("btn-download-bill");

const posModal = document.getElementById("pos-modal");
const btnClosePosModal = document.getElementById("btn-close-pos-modal");
const posForm = document.getElementById("pos-order-form");

// Table & Filters
const tbody = document.getElementById("orders-tbody");
const searchInput = document.getElementById("search-input");
const btnClearSearch = document.getElementById("btn-clear-search");
const statusFilter = document.getElementById("status-filter");
const quickFilterTabs = document.getElementById("quick-filter-tabs");
const emailFilterSelect = document.getElementById("email-filter-select");
const checkinFilterSelect = document.getElementById("checkin-filter-select");
const paymentFilterSelect = document.getElementById("payment-filter-select");

const datePresetBtns = document.querySelectorAll(".preset-btn");
const dateFromInput = document.getElementById("date-from-input");
const dateToInput = document.getElementById("date-to-input");
const btnClearDateRange = document.getElementById("btn-clear-date-range");

const activeDrilldownBar = document.getElementById("active-drilldown-bar");
const drilldownText = document.getElementById("drilldown-text");
const btnClearDrilldown = document.getElementById("btn-clear-drilldown");

const btnRefresh = document.getElementById("btn-refresh");
const btnExportCsv = document.getElementById("btn-export-csv");
const btnExportDailyCsv = document.getElementById("btn-export-daily-csv");
const btnExportJson = document.getElementById("btn-export-json");
const copyToast = document.getElementById("copy-toast");

// State
let currentUser = null;
let isSuperAdmin = false;
let realTicketVaultMap = {};
let ticketCheckinMap = {}; // ticketCode -> { checkedIn, checkedInAt, checkedInBy, status }
let allOrders = [];
let dateFilteredOrders = [];
let filteredOrders = [];
let dailyLedgerStats = []; // Lưu thống kê từng ngày để vẽ biểu đồ & xuất CSV

let currentChartMode = "revenue"; // 'revenue' | 'tickets' | 'cumulative'
let activeDateRangePreset = "ALL"; // 'ALL' | 'TODAY' | 'YESTERDAY' | '7D' | '30D' | 'CUSTOM'
let drilldownFilter = null; // { type: 'day' | 'referrer' | 'voucher' | 'qty', value: string, label: string }

let currentModalOrder = null;
let currentLightboxOrder = null;
let currentBillRotation = 0;
let currentBillZoom = 1;
let stopBatchFlag = false;

let unsubscribeOrdersListener = null;
let unsubscribeTicketsListener = null;
let isInitialOrdersLoaded = false;

// ==============================================================================
// 1. TIỆN ÍCH FORMAT & TOAST
// ==============================================================================
let toastTimer = null;
function showCopyToast(text) {
    if (!copyToast) return;
    copyToast.textContent = `✓ ${text}`;
    copyToast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => copyToast.classList.remove("show"), 2400);
}

function formatCurrency(val) {
    return Number(val || 0).toLocaleString("vi-VN") + " ₫";
}

function formatCompactMoney(val) {
    const n = Number(val || 0);
    if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + "tr";
    if (n >= 1000) return Math.round(n / 1000) + "k";
    return String(n);
}

function toDateObj(ts) {
    if (!ts) return null;
    if (ts.toDate) return ts.toDate();
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
}

function formatDate(ts) {
    const d = toDateObj(ts);
    if (!d) return "—";
    return d.toLocaleString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
}

function toLocalDateKey(msOrDate) {
    if (!msOrDate) return "Unknown";
    const d = msOrDate instanceof Date ? msOrDate : new Date(msOrDate);
    if (isNaN(d.getTime())) return "Unknown";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function formatDayKeyVi(dateKey) {
    if (!dateKey || dateKey === "Unknown") return "Chưa rõ ngày";
    const parts = dateKey.split("-");
    if (parts.length !== 3) return dateKey;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatShortDayVi(dateKey) {
    if (!dateKey || dateKey === "Unknown") return "—";
    const parts = dateKey.split("-");
    if (parts.length !== 3) return dateKey;
    return `${parts[2]}/${parts[1]}`;
}

// Phím tắt "/" tìm kiếm, "Esc" đóng modal
document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== searchInput && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
    } else if (e.key === "Escape") {
        if (billLightboxModal) billLightboxModal.style.display = "none";
        if (ticketModal) ticketModal.style.display = "none";
        if (posModal) posModal.style.display = "none";
    }
});

// Ẩn/hiện khu vực Biểu đồ Phân tích
if (btnToggleAnalytics && analyticsSection) {
    btnToggleAnalytics.addEventListener("click", () => {
        const isHidden = analyticsSection.style.display === "none";
        analyticsSection.style.display = isHidden ? "block" : "none";
        btnToggleAnalytics.textContent = isHidden ? "📊 Thu gọn Biểu đồ" : "📊 Mở Biểu đồ Phân tích";
    });
}

// ==============================================================================
// 2. CẤU HÌNH BẢO MẬT SERVER & PAYOS WEBHOOK
// ==============================================================================
if (btnToggleSettings) {
    btnToggleSettings.addEventListener("click", () => {
        if (!isSuperAdmin) return;
        const isHidden = superSecurityPanel.style.display === "none";
        superSecurityPanel.style.display = isHidden ? "block" : "none";
    });
}

if (btnToggleSecret) {
    btnToggleSecret.addEventListener("click", () => {
        const isPwd = hmacSecretInput.type === "password";
        hmacSecretInput.type = isPwd ? "text" : "password";
        btnToggleSecret.textContent = isPwd ? "Ẩn khóa" : "Hiện khóa";
    });
}

if (btnSaveSecurity) {
    btnSaveSecurity.addEventListener("click", async () => {
        if (!isSuperAdmin) return;
        btnSaveSecurity.disabled = true;
        btnSaveSecurity.textContent = "Đang lưu...";
        try {
            await saveServerSecretConfig(hmacSecretInput.value.trim(), webhookUrlInput.value.trim());
            if (superEmailsInput) {
                const updatedEmails = await saveSuperAdminEmailsList(superEmailsInput.value);
                superEmailsInput.value = updatedEmails.join(", ");
            }
            securitySaveStatus.textContent = "✓ Đã lưu lên Server!";
            setTimeout(() => { securitySaveStatus.textContent = ""; }, 3000);
        } catch (err) {
            alert("Không thể lưu cấu hình: " + err.message);
        } finally {
            btnSaveSecurity.disabled = false;
            btnSaveSecurity.textContent = "Lưu cấu hình";
        }
    });
}

const btnConfirmPayosWebhook = document.getElementById("btn-confirm-payos-webhook");
if (btnConfirmPayosWebhook) {
    btnConfirmPayosWebhook.addEventListener("click", async () => {
        const rawUrls = (webhookUrlInput.value || "").trim();
        const webhookUrl = rawUrls.split(",")[0].trim();
        if (!webhookUrl || !webhookUrl.startsWith("https://")) {
            alert("Vui lòng nhập Google Apps Script Webhook URL hợp lệ (bắt đầu bằng https://) vào ô bên cạnh trước!");
            webhookUrlInput.focus();
            return;
        }
        btnConfirmPayosWebhook.disabled = true;
        btnConfirmPayosWebhook.textContent = "⏳ Đang đăng ký với PayOS...";
        try {
            const response = await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({
                    action: "confirm_payos_webhook",
                    webhookUrl: webhookUrl
                })
            });
            const res = await response.json();
            if (res && (res.status === "success" || res.code === "00")) {
                alert("🎉 CHÚC MỪNG!\n\nPayOS đã xác nhận và liên kết Webhook URL thành công!");
            } else {
                alert("⚠️ Không thể kích hoạt Webhook: " + ((res && res.message) || "Kiểm tra lại Client ID & API Key trong Google Apps Script."));
            }
        } catch (err) {
            alert("Lỗi kết nối tới Google Apps Script: " + err.message);
        } finally {
            btnConfirmPayosWebhook.disabled = false;
            btnConfirmPayosWebhook.textContent = "🔗 Kích hoạt Webhook PayOS";
        }
    });
}

if (btnClaimSuper) {
    btnClaimSuper.addEventListener("click", async () => {
        if (!currentUser) return;
        btnClaimSuper.disabled = true;
        btnClaimSuper.textContent = "Đang khóa quyền...";
        try {
            await claimSuperAdminBootstrap(currentUser);
            await setupRoleAndLoadData(currentUser);
        } catch (err) {
            alert("Lỗi khởi tạo Super Admin: " + err.message);
            btnClaimSuper.disabled = false;
            btnClaimSuper.textContent = "Khóa Tài Khoản Này Làm Super Admin";
        }
    });
}

// ==============================================================================
// 3. BỘ LỌC KHOẢNG THỜI GIAN (DATE RANGE) & DRILL-DOWN TƯƠNG TÁC
// ==============================================================================
function isOrderWithinDateRange(order) {
    if (activeDateRangePreset === "ALL") return true;
    if (!order.rawTime) return false;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const tomorrowStart = todayStart + 86400000;

    if (activeDateRangePreset === "TODAY") {
        return order.rawTime >= todayStart && order.rawTime < tomorrowStart;
    }
    if (activeDateRangePreset === "YESTERDAY") {
        const yesterdayStart = todayStart - 86400000;
        return order.rawTime >= yesterdayStart && order.rawTime < todayStart;
    }
    if (activeDateRangePreset === "7D") {
        const sevenDaysAgo = todayStart - (6 * 86400000);
        return order.rawTime >= sevenDaysAgo && order.rawTime < tomorrowStart;
    }
    if (activeDateRangePreset === "30D") {
        const thirtyDaysAgo = todayStart - (29 * 86400000);
        return order.rawTime >= thirtyDaysAgo && order.rawTime < tomorrowStart;
    }
    if (activeDateRangePreset === "CUSTOM") {
        const fromVal = dateFromInput ? dateFromInput.value : "";
        const toVal = dateToInput ? dateToInput.value : "";
        if (fromVal && order.dateKey < fromVal) return false;
        if (toVal && order.dateKey > toVal) return false;
        return true;
    }
    return true;
}

datePresetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
        datePresetBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeDateRangePreset = btn.getAttribute("data-preset") || "ALL";
        if (activeDateRangePreset !== "CUSTOM") {
            if (dateFromInput) dateFromInput.value = "";
            if (dateToInput) dateToInput.value = "";
        }
        if (drilldownFilter && drilldownFilter.type === "day") {
            drilldownFilter = null;
        }
        recomputeDashboardAndTable();
    });
});

function handleCustomDateChange() {
    if ((dateFromInput && dateFromInput.value) || (dateToInput && dateToInput.value)) {
        datePresetBtns.forEach((b) => b.classList.remove("active"));
        activeDateRangePreset = "CUSTOM";
        if (drilldownFilter && drilldownFilter.type === "day") {
            drilldownFilter = null;
        }
        recomputeDashboardAndTable();
    }
}

if (dateFromInput) dateFromInput.addEventListener("change", handleCustomDateChange);
if (dateToInput) dateToInput.addEventListener("change", handleCustomDateChange);

if (btnClearDateRange) {
    btnClearDateRange.addEventListener("click", () => {
        if (dateFromInput) dateFromInput.value = "";
        if (dateToInput) dateToInput.value = "";
        datePresetBtns.forEach((b) => {
            b.classList.toggle("active", b.getAttribute("data-preset") === "ALL");
        });
        activeDateRangePreset = "ALL";
        drilldownFilter = null;
        recomputeDashboardAndTable();
    });
}

function setDrilldownFilter(type, value, label) {
    if (drilldownFilter && drilldownFilter.type === type && drilldownFilter.value === value) {
        drilldownFilter = null;
    } else {
        drilldownFilter = { type, value, label };
    }
    recomputeDashboardAndTable();
}

if (btnClearDrilldown) {
    btnClearDrilldown.addEventListener("click", () => {
        drilldownFilter = null;
        recomputeDashboardAndTable();
    });
}

// Chuyển chế độ xem Biểu đồ Ngày (Doanh thu / Số vé / Lũy kế)
document.querySelectorAll(".chart-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".chart-mode-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentChartMode = btn.getAttribute("data-mode") || "revenue";
        renderDailyChart(dailyLedgerStats);
    });
});

// ==============================================================================
// 4. ĐỘNG CƠ PHÂN TÍCH DÒNG TIỀN, LƯỢNG VÉ THEO NGÀY & CÁC CHỈ SỐ KPI
// ==============================================================================
function recomputeDashboardAndTable() {
    // 1. Lọc theo khoảng thời gian trên thanh Date Control Bar
    dateFilteredOrders = allOrders.filter(isOrderWithinDateRange);

    // 2. Tính toán KPI & Biểu đồ trên tập đơn hàng trong khoảng thời gian đã chọn
    computeAndRenderAnalytics(dateFilteredOrders);

    // 3. Áp dụng thêm bộ lọc Tìm kiếm, Tab trạng thái, Email, Check-in & Drill-down cho Bảng
    applyTableFilters();
}

function computeAndRenderAnalytics(periodOrders) {
    const approvedOrders = periodOrders.filter((o) => o.status === "APPROVED");
    const pendingOrders = periodOrders.filter((o) => o.status === "PENDING");
    const verifiedOrders = periodOrders.filter((o) => o.status === "BILL_VERIFIED");

    // Doanh thu thực nhận (Net Revenue) & Tổng vé đã bán (Chỉ tính đơn APPROVED)
    const netRevenue = approvedOrders.reduce((s, o) => s + o.totalAmount, 0);
    const totalSoldTickets = approvedOrders.reduce((s, o) => s + o.quantity, 0);
    const totalDiscountGiven = approvedOrders.reduce((s, o) => s + o.discountAmount, 0);
    const voucherOrdersCount = approvedOrders.filter((o) => o.voucherCode).length;

    const aov = approvedOrders.length > 0 ? Math.round(netRevenue / approvedOrders.length) : 0;
    const avgTicketsPerOrder = approvedOrders.length > 0 ? (totalSoldTickets / approvedOrders.length).toFixed(1) : "0.0";

    // Tính số liệu HÔM NAY vs HÔM QUA (tính trên toàn bộ allOrders đã APPROVED)
    const now = new Date();
    const todayKey = toLocalDateKey(now);
    const yesterdayKey = toLocalDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

    const allApproved = allOrders.filter((o) => o.status === "APPROVED");
    const todayApproved = allApproved.filter((o) => o.dateKey === todayKey);
    const yesterdayApproved = allApproved.filter((o) => o.dateKey === yesterdayKey);

    const todayRevenue = todayApproved.reduce((s, o) => s + o.totalAmount, 0);
    const todayTickets = todayApproved.reduce((s, o) => s + o.quantity, 0);
    const yesterdayRevenue = yesterdayApproved.reduce((s, o) => s + o.totalAmount, 0);
    const yesterdayTickets = yesterdayApproved.reduce((s, o) => s + o.quantity, 0);

    // Tính tăng trưởng Hôm nay so với Hôm qua
    let todayGrowthHtml = `<span class="trend-pill trend-neutral">Hôm qua: ${formatCurrency(yesterdayRevenue)} (${yesterdayTickets} vé)</span>`;
    if (yesterdayRevenue > 0) {
        const diffPct = Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100);
        if (diffPct >= 0) {
            todayGrowthHtml = `<span class="trend-pill trend-up">▲ +${diffPct}% so với hôm qua</span>`;
        } else {
            todayGrowthHtml = `<span class="trend-pill trend-down">▼ ${diffPct}% so với hôm qua</span>`;
        }
    } else if (todayRevenue > 0) {
        todayGrowthHtml = `<span class="trend-pill trend-up">▲ Mới phát sinh hôm nay</span>`;
    }

    // Gom nhóm theo Ngày (Daily Cashflow & Ticket Tracker)
    const dayMap = {};
    approvedOrders.forEach((o) => {
        const dk = o.dateKey || "Unknown";
        if (!dayMap[dk]) {
            dayMap[dk] = {
                dateKey: dk,
                ordersCount: 0,
                ticketsSold: 0,
                revenue: 0,
                discount: 0
            };
        }
        dayMap[dk].ordersCount += 1;
        dayMap[dk].ticketsSold += o.quantity;
        dayMap[dk].revenue += o.totalAmount;
        dayMap[dk].discount += o.discountAmount;
    });

    const sortedDaysAsc = Object.values(dayMap).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    let cumTickets = 0;
    let cumRevenue = 0;
    sortedDaysAsc.forEach((d, idx) => {
        cumTickets += d.ticketsSold;
        cumRevenue += d.revenue;
        d.cumulativeTickets = cumTickets;
        d.cumulativeRevenue = cumRevenue;
        const prevRev = idx > 0 ? sortedDaysAsc[idx - 1].revenue : 0;
        d.revGrowthPct = prevRev > 0 ? Math.round(((d.revenue - prevRev) / prevRev) * 100) : null;
    });

    dailyLedgerStats = sortedDaysAsc;
    const activeDaysCount = Math.max(1, sortedDaysAsc.length);
    const avgTicketsPerDay = (totalSoldTickets / activeDaysCount).toFixed(1);
    const avgRevenuePerDay = Math.round(netRevenue / activeDaysCount);

    // Thống kê Check-in tại cổng & Trạng thái Email
    let checkedInTicketsCount = 0;
    let totalTrackedValidTickets = 0;
    Object.values(ticketCheckinMap).forEach((t) => {
        if (t.status === "VALID") {
            totalTrackedValidTickets++;
            if (t.checkedIn) checkedInTicketsCount++;
        }
    });
    const effectiveTotalTickets = Math.max(totalSoldTickets, totalTrackedValidTickets);
    const checkinRate = effectiveTotalTickets > 0 ? Math.round((checkedInTicketsCount / effectiveTotalTickets) * 100) : 0;

    const emailSentOrdersCount = approvedOrders.filter((o) => o.emailSent).length;
    const emailMissingCount = approvedOrders.length - emailSentOrdersCount;

    // Cập nhật 6 Thẻ KPI Trung tâm
    const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    const setHtml = (id, html) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    };

    // KPI 1: Doanh thu thực nhận
    setTxt("kpi-net-revenue", formatCurrency(netRevenue));
    setHtml("kpi-net-sub", `<span><strong>${approvedOrders.length}</strong> đơn đã thanh toán</span> <span>TB: ${formatCompactMoney(avgRevenuePerDay)}/ngày</span>`);

    // KPI 2: Dòng tiền & Vé Hôm nay
    setTxt("kpi-today-revenue", `+${formatCurrency(todayRevenue)}`);
    setHtml("kpi-today-sub", `<span>Hôm nay: <strong>+${todayTickets} vé</strong> (${todayApproved.length} đơn)</span> ${todayGrowthHtml}`);

    // KPI 3: Tổng lượng vé đã bán (Không giới hạn chỉ tiêu)
    setTxt("kpi-total-tickets", `${totalSoldTickets.toLocaleString("vi-VN")} vé`);
    setHtml("kpi-tickets-sub", `<span>Tốc độ: <strong>${avgTicketsPerDay} vé/ngày</strong></span> <span><strong>${ sortedDaysAsc.length }</strong> ngày có giao dịch</span>`);

    // KPI 4: Giá trị đơn TB (AOV) & Chiết khấu Voucher
    setTxt("kpi-aov", formatCurrency(aov));
    setHtml("kpi-aov-sub", `<span>TB: <strong>${avgTicketsPerOrder} vé/đơn</strong></span> <span>Giảm giá: <strong>-${formatCompactMoney(totalDiscountGiven)}</strong> (${voucherOrdersCount} đơn)</span>`);

    // KPI 5: Tiến độ Check-in Cổng Soát Vé
    setTxt("kpi-checkin-count", `${checkedInTicketsCount} / ${effectiveTotalTickets} vé`);
    setHtml("kpi-checkin-sub", `<span>Đã vào cổng: <strong>${checkinRate}%</strong></span> <span>Chưa quét: <strong>${Math.max(0, effectiveTotalTickets - checkedInTicketsCount)} vé</strong></span>`);

    // KPI 6: Trạng thái Email & Đơn chờ
    setTxt("kpi-email-status", `${emailSentOrdersCount} / ${approvedOrders.length} đơn`);
    if (emailMissingCount > 0 && isSuperAdmin) {
        setHtml("kpi-email-sub", `<span style="color:#dc2626;font-weight:800;">⚠️ ${emailMissingCount} đơn chưa gửi mail</span> <button type="button" id="btn-kpi-resend-missing" class="btn-solid" style="padding:3px 8px;font-size:11px;">⚡ Gửi bù ngay</button>`);
        const btnResend = document.getElementById("btn-kpi-resend-missing");
        if (btnResend) {
            btnResend.addEventListener("click", () => triggerResendMissingEmails());
        }
    } else {
        setHtml("kpi-email-sub", `<span>✓ Email tự động ổn định</span> <span>Chờ TT: <strong>${pendingOrders.length}</strong> • Đã soi: <strong>${verifiedOrders.length}</strong></span>`);
    }

    // Cập nhật số lượng trên các Tab lọc nhanh
    setTxt("cnt-all", dateFilteredOrders.length);
    setTxt("cnt-pending", pendingOrders.length);
    setTxt("cnt-verified", verifiedOrders.length);
    setTxt("cnt-approved", approvedOrders.length);
    if (verifiedCountLabel) verifiedCountLabel.textContent = verifiedOrders.length;

    // Render Biểu đồ & Bảng Sổ Quỹ Theo Ngày
    renderDailyChart(sortedDaysAsc);
    renderDailyLedgerTable(sortedDaysAsc);

    // Render Phân tích Khung giờ vàng (24h), Bảng xếp hạng CTV, Voucher & Cơ cấu gói vé
    renderHourlyHeatmap(approvedOrders);
    renderReferrerLeaderboard(approvedOrders);
    renderVoucherAndMixBreakdown(approvedOrders);
}

// ==============================================================================
// 5. RENDER BIỂU ĐỒ DÒNG TIỀN & LƯỢNG VÉ THEO NGÀY + SỔ QUỸ NGÀY
// ==============================================================================
function renderDailyChart(daysAsc) {
    const chartContainer = document.getElementById("daily-chart-container");
    const chartSummaryEl = document.getElementById("daily-chart-summary");
    if (!chartContainer) return;

    if (!daysAsc || daysAsc.length === 0) {
        chartContainer.innerHTML = `<div class="status-msg" style="width:100%;">Chưa có dữ liệu đơn đã thanh toán trong khoảng thời gian này.</div>`;
        if (chartSummaryEl) chartSummaryEl.textContent = "0 ngày giao dịch";
        return;
    }

    // Tìm đỉnh cao nhất (Peak Day) để hiển thị thông tin
    let peakDay = daysAsc[0];
    daysAsc.forEach((d) => {
        if (d.revenue > peakDay.revenue) peakDay = d;
    });
    if (chartSummaryEl) {
        chartSummaryEl.innerHTML = `🔥 Ngày cao điểm nhất: <strong>${formatDayKeyVi(peakDay.dateKey)}</strong> (<strong>${formatCurrency(peakDay.revenue)}</strong> • <strong>${peakDay.ticketsSold} vé</strong>)`;
    }

    const maxVal = Math.max(
        1,
        ...daysAsc.map((d) => {
            if (currentChartMode === "revenue") return d.revenue;
            if (currentChartMode === "tickets") return d.ticketsSold;
            return d.cumulativeTickets;
        })
    );

    chartContainer.innerHTML = daysAsc.map((d) => {
        let rawMetric = d.revenue;
        let topText = formatCompactMoney(d.revenue);
        let subText = `${d.ticketsSold}v`;

        if (currentChartMode === "tickets") {
            rawMetric = d.ticketsSold;
            topText = `${d.ticketsSold} vé`;
            subText = formatCompactMoney(d.revenue);
        } else if (currentChartMode === "cumulative") {
            rawMetric = d.cumulativeTickets;
            topText = `${d.cumulativeTickets} vé`;
            subText = formatCompactMoney(d.cumulativeRevenue);
        }

        const heightPct = Math.max(6, Math.round((rawMetric / maxVal) * 155));
        const isSelected = drilldownFilter && drilldownFilter.type === "day" && drilldownFilter.value === d.dateKey;

        return `
            <div class="day-bar-col ${isSelected ? "selected-day" : ""}" data-day="${escapeHtml(d.dateKey)}" title="Ngày ${formatDayKeyVi(d.dateKey)}: ${formatCurrency(d.revenue)} (${d.ticketsSold} vé - ${d.ordersCount} đơn). Bấm để lọc đơn ngày này!">
                <div class="day-bar-val">${escapeHtml(topText)}</div>
                <div class="day-bar-fill" style="height: ${heightPct}px;"></div>
                <div class="day-bar-label">${escapeHtml(formatShortDayVi(d.dateKey))}</div>
                <div class="day-bar-sub">${escapeHtml(subText)}</div>
            </div>
        `;
    }).join("");

    chartContainer.querySelectorAll(".day-bar-col").forEach((col) => {
        col.addEventListener("click", () => {
            const dk = col.getAttribute("data-day");
            setDrilldownFilter("day", dk, `Ngày ${formatDayKeyVi(dk)}`);
        });
    });
}

function renderDailyLedgerTable(daysAsc) {
    const ledgerTbody = document.getElementById("daily-ledger-tbody");
    if (!ledgerTbody) return;

    if (!daysAsc || daysAsc.length === 0) {
        ledgerTbody.innerHTML = `<tr><td colspan="6" class="status-msg" style="padding:20px;">Chưa có dữ liệu dòng tiền theo ngày.</td></tr>`;
        return;
    }

    // Hiển thị ngày mới nhất lên đầu trong bảng Sổ Quỹ
    const daysDesc = [...daysAsc].reverse();

    ledgerTbody.innerHTML = daysDesc.map((d) => {
        const isSelected = drilldownFilter && drilldownFilter.type === "day" && drilldownFilter.value === d.dateKey;
        let growthHtml = `<span style="color:var(--text-muted);">—</span>`;
        if (d.revGrowthPct !== null) {
            if (d.revGrowthPct >= 0) {
                growthHtml = `<span style="color:#059669;font-weight:800;">▲ +${d.revGrowthPct}%</span>`;
            } else {
                growthHtml = `<span style="color:#dc2626;font-weight:800;">▼ ${d.revGrowthPct}%</span>`;
            }
        }

        return `
            <tr class="${isSelected ? "active-row" : ""}" data-day="${escapeHtml(d.dateKey)}" title="Bấm để xem các đơn hàng của ngày ${formatDayKeyVi(d.dateKey)}">
                <td class="mono-num" style="font-weight:800;color:var(--primary-dark);">${escapeHtml(formatDayKeyVi(d.dateKey))}</td>
                <td class="mono-num">${d.ordersCount} đơn</td>
                <td class="mono-num" style="font-weight:800;">+${d.ticketsSold} vé</td>
                <td class="mono-num" style="color:var(--text-muted);">${d.cumulativeTickets} vé</td>
                <td class="mono-num" style="font-weight:800;color:#047857;">+${formatCurrency(d.revenue)}</td>
                <td class="mono-num">${growthHtml}</td>
            </tr>
        `;
    }).join("");

    ledgerTbody.querySelectorAll("tr[data-day]").forEach((row) => {
        row.addEventListener("click", () => {
            const dk = row.getAttribute("data-day");
            setDrilldownFilter("day", dk, `Ngày ${formatDayKeyVi(dk)}`);
        });
    });
}

// ==============================================================================
// 6. HEATMAP KHUNG GIỜ VÀNG (24H), TOP NGƯỜI GIỚI THIỆU & VOUCHER / CƠ CẤU ĐƠN
// ==============================================================================
function renderHourlyHeatmap(approvedOrders) {
    const gridEl = document.getElementById("hourly-heatmap-grid");
    const peakLabelEl = document.getElementById("peak-hour-label");
    if (!gridEl) return;

    const hourBuckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, tickets: 0, orders: 0, revenue: 0 }));
    approvedOrders.forEach((o) => {
        if (typeof o.hourOfDay === "number" && o.hourOfDay >= 0 && o.hourOfDay < 24) {
            hourBuckets[o.hourOfDay].tickets += o.quantity;
            hourBuckets[o.hourOfDay].orders += 1;
            hourBuckets[o.hourOfDay].revenue += o.totalAmount;
        }
    });

    const maxTicketsInHour = Math.max(1, ...hourBuckets.map((b) => b.tickets));
    let bestHour = hourBuckets[0];
    hourBuckets.forEach((b) => {
        if (b.tickets > bestHour.tickets) bestHour = b;
    });

    if (peakLabelEl) {
        if (bestHour.tickets > 0) {
            const hStr = String(bestHour.hour).padStart(2, "0");
            peakLabelEl.innerHTML = `🔥 Giờ cao điểm: <strong>${hStr}:00 - ${hStr}:59</strong> (${bestHour.tickets} vé • ${bestHour.orders} đơn)`;
        } else {
            peakLabelEl.textContent = "Chưa có dữ liệu khung giờ";
        }
    }

    gridEl.innerHTML = hourBuckets.map((b) => {
        const hStr = String(b.hour).padStart(2, "0") + "h";
        const intensity = b.tickets > 0 ? Math.max(0.15, b.tickets / maxTicketsInHour) : 0;
        const bgStyle = b.tickets > 0
            ? `background: rgba(225, 29, 72, ${(intensity * 0.28).toFixed(2)}); border-color: rgba(225, 29, 72, ${(0.3 + intensity * 0.6).toFixed(2)});`
            : "";
        return `
            <div class="hour-cell" style="${bgStyle}" title="Khung ${hStr}: ${b.tickets} vé (${b.orders} đơn) — ${formatCurrency(b.revenue)}">
                <div class="h-time">${hStr}</div>
                <div class="h-count">${b.tickets}v</div>
            </div>
        `;
    }).join("");
}

function renderReferrerLeaderboard(approvedOrders) {
    const container = document.getElementById("referrer-leaderboard-list");
    const summaryEl = document.getElementById("referrer-summary-label");
    if (!container) return;

    const refMap = {};
    let referredTicketsTotal = 0;

    approvedOrders.forEach((o) => {
        const rawRef = (o.referrer || "").trim();
        if (!rawRef) return;
        const normKey = rawRef.toLowerCase();
        if (!refMap[normKey]) {
            refMap[normKey] = {
                displayName: rawRef,
                orders: 0,
                tickets: 0,
                revenue: 0
            };
        }
        refMap[normKey].orders += 1;
        refMap[normKey].tickets += o.quantity;
        refMap[normKey].revenue += o.totalAmount;
        referredTicketsTotal += o.quantity;
    });

    const list = Object.values(refMap).sort((a, b) => b.tickets - a.tickets || b.revenue - a.revenue);
    if (summaryEl) {
        summaryEl.innerHTML = `Có <strong>${list.length}</strong> người giới thiệu • Mang về <strong>${referredTicketsTotal} vé</strong>`;
    }

    if (list.length === 0) {
        container.innerHTML = `<div class="status-msg" style="padding:18px;">Chưa có đơn hàng nào điền mục Người giới thiệu.</div>`;
        return;
    }

    const maxTickets = Math.max(1, list[0].tickets);
    container.innerHTML = list.map((item, idx) => {
        const pct = Math.max(6, Math.round((item.tickets / maxTickets) * 100));
        const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`;
        return `
            <div class="metric-row" data-ref="${escapeHtml(item.displayName.toLowerCase())}" data-ref-label="${escapeHtml(item.displayName)}" title="Bấm để lọc các đơn do ${escapeHtml(item.displayName)} giới thiệu">
                <div class="metric-row-top">
                    <span>${medal} ${escapeHtml(item.displayName)} <small style="color:var(--text-muted);font-weight:600;">(${item.orders} đơn)</small></span>
                    <span class="mono-num" style="color:var(--primary-dark);">${item.tickets} vé • ${formatCompactMoney(item.revenue)}</span>
                </div>
                <div class="metric-bar-track">
                    <div class="metric-bar-fill" style="width: ${pct}%;"></div>
                </div>
            </div>
        `;
    }).join("");

    container.querySelectorAll(".metric-row[data-ref]").forEach((row) => {
        row.addEventListener("click", () => {
            const val = row.getAttribute("data-ref");
            const label = row.getAttribute("data-ref-label");
            setDrilldownFilter("referrer", val, `Người giới thiệu: ${label}`);
        });
    });
}

function renderVoucherAndMixBreakdown(approvedOrders) {
    const container = document.getElementById("voucher-mix-list");
    if (!container) return;

    const totalApprovedTickets = Math.max(1, approvedOrders.reduce((s, o) => s + o.quantity, 0));

    // 1. Thống kê Mã giảm giá (Voucher)
    const voucherMap = {};
    approvedOrders.forEach((o) => {
        const code = (o.voucherCode || "").trim().toUpperCase() || "KHÔNG DÙNG MÃ";
        if (!voucherMap[code]) {
            voucherMap[code] = { code, orders: 0, tickets: 0, revenue: 0, discount: 0 };
        }
        voucherMap[code].orders += 1;
        voucherMap[code].tickets += o.quantity;
        voucherMap[code].revenue += o.totalAmount;
        voucherMap[code].discount += o.discountAmount;
    });

    // 2. Thống kê Cơ cấu Số lượng vé/đơn (1 vé, 2 vé, 3-5 vé)
    const qtyMap = {};
    approvedOrders.forEach((o) => {
        const q = o.quantity || 1;
        if (!qtyMap[q]) qtyMap[q] = { qty: q, orders: 0, tickets: 0, revenue: 0 };
        qtyMap[q].orders += 1;
        qtyMap[q].tickets += q;
        qtyMap[q].revenue += o.totalAmount;
    });

    const voucherHtml = Object.values(voucherMap)
        .sort((a, b) => b.tickets - a.tickets)
        .map((v) => {
            const pct = Math.round((v.tickets / totalApprovedTickets) * 100);
            const discountTag = v.discount > 0 ? `<small style="color:#dc2626;">(-${formatCompactMoney(v.discount)})</small>` : "";
            return `
                <div class="metric-row" data-voucher="${escapeHtml(v.code)}" title="Bấm để lọc các đơn theo mã ${escapeHtml(v.code)}">
                    <div class="metric-row-top">
                        <span>🏷️ ${escapeHtml(v.code)} <small style="color:var(--text-muted);">(${v.orders} đơn)</small></span>
                        <span class="mono-num">${v.tickets} vé (${pct}%) ${discountTag}</span>
                    </div>
                    <div class="metric-bar-track">
                        <div class="metric-bar-fill" style="width: ${Math.max(5, pct)}%;"></div>
                    </div>
                </div>
            `;
        }).join("");

    const mixHtml = Object.values(qtyMap)
        .sort((a, b) => a.qty - b.qty)
        .map((m) => {
            const pct = Math.round((m.tickets / totalApprovedTickets) * 100);
            return `
                <div class="metric-row" data-qty="${m.qty}" title="Bấm để lọc các đơn mua ${m.qty} vé">
                    <div class="metric-row-top">
                        <span>🎟️ Gói ${m.qty} vé/đơn <small style="color:var(--text-muted);">(${m.orders} đơn)</small></span>
                        <span class="mono-num">${m.tickets} vé (${pct}%) • ${formatCompactMoney(m.revenue)}</span>
                    </div>
                    <div class="metric-bar-track">
                        <div class="metric-bar-fill" style="width: ${Math.max(5, pct)}%; background: linear-gradient(90deg, #f59e0b, #e11d48);"></div>
                    </div>
                </div>
            `;
        }).join("");

    container.innerHTML = voucherHtml + mixHtml;

    container.querySelectorAll(".metric-row[data-voucher]").forEach((row) => {
        row.addEventListener("click", () => {
            const code = row.getAttribute("data-voucher");
            setDrilldownFilter("voucher", code, `Mã Voucher: ${code}`);
        });
    });

    container.querySelectorAll(".metric-row[data-qty]").forEach((row) => {
        row.addEventListener("click", () => {
            const q = Number(row.getAttribute("data-qty"));
            setDrilldownFilter("qty", q, `Đơn mua ${q} vé`);
        });
    });
}

// ==============================================================================
// 7. LỌC ĐA CHIỀU & RENDER BẢNG ĐƠN HÀNG
// ==============================================================================
function applyTableFilters() {
    const keyword = (searchInput ? searchInput.value : "").trim().toLowerCase();
    if (btnClearSearch) btnClearSearch.style.display = keyword ? "inline-block" : "none";

    const st = statusFilter ? statusFilter.value : "APPROVED";
    const emailFilter = emailFilterSelect ? emailFilterSelect.value : "ALL";
    const checkinFilter = checkinFilterSelect ? checkinFilterSelect.value : "ALL";
    const paymentFilter = paymentFilterSelect ? paymentFilterSelect.value : "ALL";

    // Hiển thị thanh thông báo nếu đang bật Drill-down (Lọc theo Ngày / CTV / Voucher)
    if (activeDrilldownBar && drilldownText) {
        if (drilldownFilter) {
            activeDrilldownBar.style.display = "flex";
            drilldownText.textContent = `🎯 Đang lọc chuyên sâu: ${drilldownFilter.label}`;
        } else {
            activeDrilldownBar.style.display = "none";
        }
    }

    filteredOrders = dateFilteredOrders.filter((item) => {
        const matchStatus = (st === "ALL") || (item.status === st);

        // Lọc trạng thái Email
        let matchEmail = true;
        if (emailFilter === "SENT") matchEmail = item.emailSent === true;
        else if (emailFilter === "UNSENT") matchEmail = item.status === "APPROVED" && !item.emailSent;

        // Lọc trạng thái Check-in của đơn
        let matchCheckin = true;
        const codes = item.realTicketCodes || [];
        const checkedInCountForOrder = codes.filter((c) => ticketCheckinMap[c] && ticketCheckinMap[c].checkedIn).length;
        if (checkinFilter === "CHECKED_IN") matchCheckin = checkedInCountForOrder > 0;
        else if (checkinFilter === "NOT_CHECKED_IN") matchCheckin = item.status === "APPROVED" && checkedInCountForOrder === 0;

        // Lọc kênh thanh toán
        let matchPayment = true;
        if (paymentFilter === "PAYOS") matchPayment = Boolean(item.payosOrderCode) || item.paymentMethod === "payos_qr";
        else if (paymentFilter === "MANUAL") matchPayment = !item.payosOrderCode && item.paymentMethod !== "pos_manual";
        else if (paymentFilter === "POS") matchPayment = item.paymentMethod === "pos_manual";

        // Lọc Drill-down từ biểu đồ
        let matchDrilldown = true;
        if (drilldownFilter) {
            if (drilldownFilter.type === "day") matchDrilldown = item.dateKey === drilldownFilter.value;
            else if (drilldownFilter.type === "referrer") matchDrilldown = (item.referrer || "").trim().toLowerCase() === drilldownFilter.value;
            else if (drilldownFilter.type === "voucher") {
                const vc = (item.voucherCode || "").trim().toUpperCase() || "KHÔNG DÙNG MÃ";
                matchDrilldown = vc === drilldownFilter.value;
            } else if (drilldownFilter.type === "qty") matchDrilldown = item.quantity === drilldownFilter.value;
        }

        // Lọc từ khóa tìm kiếm đa năng
        const ticketsStr = (item.realTicketCodes || []).join(" ").toLowerCase();
        const matchKeyword = !keyword ||
            item.name.toLowerCase().includes(keyword) ||
            item.phone.toLowerCase().includes(keyword) ||
            item.email.toLowerCase().includes(keyword) ||
            (item.referrer && item.referrer.toLowerCase().includes(keyword)) ||
            (item.voucherCode && item.voucherCode.toLowerCase().includes(keyword)) ||
            item.transferMemo.toLowerCase().includes(keyword) ||
            (item.payosOrderCode && item.payosOrderCode.toLowerCase().includes(keyword)) ||
            ticketsStr.includes(keyword) ||
            item.id.toLowerCase().includes(keyword);

        return matchStatus && matchEmail && matchCheckin && matchPayment && matchDrilldown && matchKeyword;
    });

    renderTable(filteredOrders);
}

if (quickFilterTabs) {
    quickFilterTabs.querySelectorAll(".filter-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            quickFilterTabs.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");
            if (statusFilter) statusFilter.value = tab.getAttribute("data-status");
            applyTableFilters();
        });
    });
}

if (emailFilterSelect) emailFilterSelect.addEventListener("change", applyTableFilters);
if (checkinFilterSelect) checkinFilterSelect.addEventListener("change", applyTableFilters);
if (paymentFilterSelect) paymentFilterSelect.addEventListener("change", applyTableFilters);
if (searchInput) searchInput.addEventListener("input", applyTableFilters);

if (btnClearSearch) {
    btnClearSearch.addEventListener("click", () => {
        searchInput.value = "";
        searchInput.focus();
        applyTableFilters();
    });
}

// ==============================================================================
// 8. KẾT NỐI REAL-TIME FIRESTORE (ORDERS + TICKETS)
// ==============================================================================
async function setupRoleAndLoadData(user) {
    currentUser = user;
    const roleInfo = await checkServerRole(user);
    isSuperAdmin = roleInfo.isSuperAdmin;

    if (bootstrapBanner) bootstrapBanner.style.display = roleInfo.canClaimSuperAdmin ? "flex" : "none";

    if (isSuperAdmin) {
        roleBadge.className = "role-pill role-super";
        roleBadge.textContent = "👑 Super Admin";
        if (btnToggleSettings) btnToggleSettings.style.display = "inline-flex";
        if (btnOpenPosModal) btnOpenPosModal.style.display = "inline-flex";
        if (superSecurityPanel) superSecurityPanel.style.display = "none";
        if (superBatchBar) superBatchBar.style.display = "flex";

        if (superEmailsInput && Array.isArray(roleInfo.superAdminEmails)) {
            superEmailsInput.value = roleInfo.superAdminEmails.join(", ");
        }

        try {
            const secCfg = await loadServerSecretConfig();
            hmacSecretInput.value = secCfg.hmacSecret || "";
            webhookUrlInput.value = secCfg.webhookUrls || EMAIL_CONFIG.appsScriptWebhookUrl || "";
        } catch (e) {
            console.warn("Chưa đọc được system_secrets/config:", e);
        }
    } else {
        roleBadge.className = "role-pill role-reviewer";
        roleBadge.textContent = "Nhân viên đối soát Bill";
        if (btnToggleSettings) btnToggleSettings.style.display = "none";
        if (btnOpenPosModal) btnOpenPosModal.style.display = "none";
        if (superSecurityPanel) superSecurityPanel.style.display = "none";
        if (superBatchBar) superBatchBar.style.display = "none";
        hmacSecretInput.value = "";
        webhookUrlInput.value = "";
        if (superEmailsInput) superEmailsInput.value = "";
    }

    await loadOrdersAndTickets();
}

async function loadOrdersAndTickets() {
    if (unsubscribeOrdersListener) {
        unsubscribeOrdersListener();
        unsubscribeOrdersListener = null;
    }
    if (unsubscribeTicketsListener) {
        unsubscribeTicketsListener();
        unsubscribeTicketsListener = null;
    }

    tbody.innerHTML = `<tr><td colspan="8" class="status-msg">🔄 Đang đồng bộ dữ liệu Real-time từ Firestore...</td></tr>`;

    if (isSuperAdmin) {
        try {
            realTicketVaultMap = await loadAllOrderTicketsForSuperAdmin();
        } catch (e) {
            console.warn("Không thể tải order_tickets:", e);
        }
    }

    // 1. Lắng nghe Real-time Collection 'tickets' để theo dõi Check-in tại cổng
    try {
        const ticketsCol = collection(db, FIREBASE_CONFIG.ticketsCollection || "tickets");
        unsubscribeTicketsListener = onSnapshot(ticketsCol, (snap) => {
            const nextMap = {};
            snap.forEach((docSnap) => {
                const td = docSnap.data();
                const code = td.ticketCode || docSnap.id;
                nextMap[code] = {
                    checkedIn: Boolean(td.checkedIn),
                    checkedInAt: td.checkedInAt,
                    checkedInBy: td.checkedInBy || "",
                    status: td.status || "VALID",
                    orderId: td.orderId || ""
                };
                if (isSuperAdmin && td.orderId && code) {
                    if (!realTicketVaultMap[td.orderId]) realTicketVaultMap[td.orderId] = [];
                    if (!realTicketVaultMap[td.orderId].includes(code)) {
                        realTicketVaultMap[td.orderId].push(code);
                    }
                }
            });
            ticketCheckinMap = nextMap;
            if (isInitialOrdersLoaded) {
                recomputeDashboardAndTable();
            }
        });
    } catch (e) {
        console.warn("Không thể lắng nghe bảng tickets:", e);
    }

    // 2. Lắng nghe Real-time Collection 'orders'
    try {
        const ordersCol = collection(db, FIREBASE_CONFIG.ordersCollection || "orders");
        unsubscribeOrdersListener = onSnapshot(ordersCol, (snapshot) => {
            if (isInitialOrdersLoaded) {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === "added") {
                        const newDoc = change.doc.data();
                        const newName = newDoc.customerName || newDoc.name || "Khách hàng";
                        const amt = Number(newDoc.totalAmount || 0).toLocaleString("vi-VN");
                        showCopyToast(`🔔 Đơn mới: ${newName} (${amt} ₫)`);
                    }
                });
            }

            allOrders = [];
            snapshot.forEach((docSnap) => {
                const d = docSnap.data();
                const qty = Number(d.quantity) || 0;
                const unitPrice = Number(d.ticketPrice) || EVENT_CONFIG.ticketPrice;
                const subtotal = qty * unitPrice;
                const amount = Number(d.totalAmount) !== undefined && d.totalAmount !== null
                    ? Number(d.totalAmount)
                    : subtotal;
                const calcDiscount = Number(d.discountAmount) || Math.max(0, subtotal - amount);

                const tsObj = toDateObj(d.createdAt || d.timestamp || d.approvedAt);
                const rawTime = tsObj ? tsObj.getTime() : 0;
                const dateKey = tsObj ? toLocalDateKey(tsObj) : "Unknown";
                const hourOfDay = tsObj ? tsObj.getHours() : null;

                const rawTicketCodes = Array.isArray(d.ticketCodes) && d.ticketCodes.length > 0 ? d.ticketCodes : [];
                const realCodes = (realTicketVaultMap[docSnap.id] && realTicketVaultMap[docSnap.id].length > 0)
                    ? realTicketVaultMap[docSnap.id]
                    : rawTicketCodes;

                const rawImg = d.billImageBase64 || d.billImage || d.imageUrl || d.image || d.bill || d.billUrl || d.receiptUrl || "";
                let validImg = "";
                if (rawImg && rawImg.startsWith("data:image/")) {
                    validImg = rawImg;
                } else if (rawImg && rawImg.startsWith("http") && !rawImg.includes("local_compressed")) {
                    validImg = rawImg;
                } else if (d.billImageBase64 && d.billImageBase64.startsWith("data:image/")) {
                    validImg = d.billImageBase64;
                } else if (rawImg) {
                    validImg = rawImg;
                }

                allOrders.push({
                    id: docSnap.id,
                    name: d.customerName || d.name || "",
                    phone: d.phone || "",
                    email: d.email || "",
                    facebook: d.facebook || "",
                    referrer: d.referrer || "",
                    quantity: qty,
                    voucherCode: d.voucherCode || "",
                    discountAmount: calcDiscount,
                    totalAmount: amount,
                    transferMemo: d.transferMemo || "",
                    payosOrderCode: d.payosOrderCode ? String(d.payosOrderCode) : "",
                    paymentMethod: d.paymentMethod || "",
                    imageUrl: validImg,
                    status: (d.status || "pending").toUpperCase(),
                    verifiedBy: d.verifiedBy || "",
                    maskedTickets: Array.isArray(d.maskedTickets) ? d.maskedTickets : [],
                    ticketCodes: rawTicketCodes,
                    realTicketCodes: realCodes,
                    emailSent: Boolean(d.emailSent),
                    createdAtText: formatDate(d.createdAt || d.timestamp),
                    rawTime: rawTime,
                    dateKey: dateKey,
                    hourOfDay: hourOfDay
                });
            });

            allOrders.sort((a, b) => b.rawTime - a.rawTime);
            recomputeDashboardAndTable();
            runPayosAutoPilot();
            isInitialOrdersLoaded = true;
        }, (error) => {
            tbody.innerHTML = `<tr><td colspan="8" class="status-msg" style="color:#dc2626;">Lỗi kết nối Real-time: <strong>${escapeHtml(error.message)}</strong></td></tr>`;
        });
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="8" class="status-msg" style="color:#dc2626;">Không thể đọc dữ liệu: <strong>${escapeHtml(error.message)}</strong></td></tr>`;
    }
}

// ==============================================================================
// 9. RENDER BẢNG DỮ LIỆU ĐƠN HÀNG & SỰ KIỆN TƯƠNG TÁC
// ==============================================================================
function renderTable(list) {
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="status-msg">Không tìm thấy đơn đặt vé nào khớp với bộ lọc hiện tại.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((item, idx) => {
        const st = item.status;
        let badgeHtml = `<span class="badge badge-pending">⏳ Chờ TT</span>`;
        if (st === "BILL_VERIFIED") {
            badgeHtml = `<span class="badge badge-verified">✓ Đã soi Bill</span>` +
                (item.verifiedBy ? `<div class="sub-meta">bởi ${escapeHtml(item.verifiedBy)}</div>` : "");
        } else if (st === "APPROVED") {
            badgeHtml = `<span class="badge badge-approved">✓ Đã cấp vé</span>` +
                (item.verifiedBy ? `<div class="sub-meta">${escapeHtml(item.verifiedBy)}</div>` : "");
        }

        let billCellHtml = `<span class="sub-meta">${item.payosOrderCode ? "⚡ PayOS QR" : "—"}</span>`;
        if (item.imageUrl) {
            const isLocalDummy = item.imageUrl.includes("local_compressed");
            if (isLocalDummy) {
                billCellHtml = `<span class="sub-meta" style="color:#dc2626;">Lỗi ảnh</span>`;
            } else {
                billCellHtml = `
                    <div style="display:flex;align-items:center;gap:8px;">
                        <img src="${item.imageUrl}" class="bill-thumb" data-bill-id="${escapeHtml(item.id)}" title="Bấm để xem ảnh biên lai" />
                        <button type="button" class="btn-outline btn-table-action" data-bill-id="${escapeHtml(item.id)}">Xem Bill</button>
                    </div>
                `;
            }
        }

        let ticketColumnHtml = `<span class="sub-meta">Chưa phát hành</span>`;
        if (st === "APPROVED") {
            const validCodes = (item.realTicketCodes && item.realTicketCodes.length > 0 && !item.realTicketCodes[0].includes("*"))
                ? item.realTicketCodes
                : (realTicketVaultMap[item.id] || (Array.isArray(item.ticketCodes) && item.ticketCodes.length > 0 ? item.ticketCodes : []));

            if (validCodes.length > 0 && !validCodes[0].includes("*")) {
                ticketColumnHtml = validCodes.map((c) => {
                    const chk = ticketCheckinMap[c];
                    const isChecked = chk && chk.checkedIn;
                    const chkTitle = isChecked ? `Đã Check-in cổng (${formatDate(chk.checkedInAt)})` : "Chưa Check-in — Bấm để copy mã vé";
                    return `<span class="ticket-code-pill copyable ${isChecked ? "checked-in" : ""}" data-copy="${escapeHtml(c)}" title="${escapeHtml(chkTitle)}">${isChecked ? "🚪✓ " : ""}${escapeHtml(c)}</span>`;
                }).join("") +
                (item.emailSent
                    ? `<div class="sub-meta" style="color:#047857;font-weight:700;">✓ Đã gửi email vé</div>`
                    : `<div class="sub-meta" style="color:#dc2626;font-weight:700;">⚠️ Chưa gửi email</div>`);
            } else {
                const masked = (item.maskedTickets && item.maskedTickets.length > 0)
                    ? item.maskedTickets
                    : Array.from({ length: item.quantity }, () => "HVC-******-****");
                ticketColumnHtml = masked.map((m) => `<span class="ticket-code-pill btn-view-ticket" data-view-id="${escapeHtml(item.id)}" style="border-style:dashed;cursor:pointer;" title="Bấm để mở modal xem mã vé & QR">🎟️ ${escapeHtml(m)}</span>`).join("") +
                    `<div class="sub-meta btn-view-ticket" style="cursor:pointer;" data-view-id="${escapeHtml(item.id)}">Đã cấp vé (Bấm QR/Mail để xem)</div>`;
            }
        }

        let actionButtonsHtml = "";
        const payosQuickBtn = (st === "PENDING" && item.payosOrderCode)
            ? `<button type="button" class="btn-outline btn-table-action btn-check-payos" data-payos-id="${escapeHtml(item.id)}" title="Kiểm tra giao dịch PayOS #${escapeHtml(item.payosOrderCode)}">⚡ PayOS</button>`
            : "";

        if (isSuperAdmin) {
            const isApp = st === "APPROVED";
            const btnLabel = isApp ? "Hoàn tác" : "Cấp vé & Mail";
            const btnClass = isApp ? "btn-outline" : "btn-solid";
            const nextSt = isApp ? "PENDING" : "APPROVED";
            actionButtonsHtml = `
                <div style="display:inline-flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                    ${payosQuickBtn}
                    ${isApp ? `<button class="btn-outline btn-table-action btn-view-ticket" data-view-id="${escapeHtml(item.id)}">🎟️ QR / Mail</button>` : ""}
                    <button class="${btnClass} btn-table-action action-btn" data-id="${escapeHtml(item.id)}" data-next="${nextSt}">${btnLabel}</button>
                </div>
            `;
        } else {
            if (st === "APPROVED") {
                actionButtonsHtml = `<span class="sub-meta">Đã khóa</span>`;
            } else {
                const isVer = st === "BILL_VERIFIED";
                const nextReviewerSt = isVer ? "PENDING" : "BILL_VERIFIED";
                const reviewerLabel = isVer ? "Bỏ xác nhận" : "✓ Xác nhận Bill";
                const btnClass = isVer ? "btn-outline" : "btn-solid";
                actionButtonsHtml = `
                    <div style="display:inline-flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                        ${payosQuickBtn}
                        <button class="${btnClass} btn-table-action action-btn" data-id="${escapeHtml(item.id)}" data-next="${nextReviewerSt}">${reviewerLabel}</button>
                    </div>
                `;
            }
        }

        const fbLinkHtml = item.facebook
            ? `<a href="${sanitizeUrl(item.facebook)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-size:11px;font-weight:700;text-decoration:none;margin-left:6px;" title="Mở Facebook khách hàng">🔗 FB</a>`
            : "";
        const refBadgeHtml = item.referrer
            ? `<div><span class="referrer-pill" title="Người giới thiệu">🤝 CTV: ${escapeHtml(item.referrer)}</span></div>`
            : "";
        const voucherBadgeHtml = item.voucherCode
            ? `<span class="voucher-pill" title="Giảm ${formatCurrency(item.discountAmount)}">🏷️ ${escapeHtml(item.voucherCode)}</span>`
            : "";

        return `
            <tr>
                <td class="mono-num" style="color:var(--text-muted);font-weight:700;">${idx + 1}</td>
                <td>
                    <div class="customer-name">${escapeHtml(item.name)} ${fbLinkHtml}</div>
                    <div class="sub-meta mono-num">
                        <span class="copyable" data-copy="${escapeHtml(item.id)}" title="Bấm để copy Mã đơn">#${escapeHtml(item.id.slice(0, 12))}</span>
                        ${item.payosOrderCode ? `• <span class="copyable" data-copy="${escapeHtml(item.payosOrderCode)}" title="Mã đối soát PayOS">PayOS:${escapeHtml(item.payosOrderCode)}</span>` : ""}
                        • ${escapeHtml(item.createdAtText)}
                    </div>
                    ${refBadgeHtml}
                </td>
                <td>
                    <div class="mono-num" style="font-weight:700;">
                        <span class="copyable" data-copy="${escapeHtml(item.phone)}" title="Bấm để copy SĐT">${escapeHtml(item.phone)}</span>
                    </div>
                    <div class="sub-meta">
                        <span class="copyable" data-copy="${escapeHtml(item.email)}" title="Bấm để copy Email">${escapeHtml(item.email)}</span>
                    </div>
                </td>
                <td>
                    <div>
                        <span class="mono-num" style="font-weight:800;color:var(--primary-dark);">${Number(item.quantity)} vé</span>
                        • <span class="mono-num" style="font-weight:800;">${formatCurrency(item.totalAmount)}</span>
                        ${voucherBadgeHtml}
                    </div>
                    ${item.transferMemo ? `<span class="memo-tag copyable" data-copy="${escapeHtml(item.transferMemo)}" title="Bấm để copy Nội dung CK">${escapeHtml(item.transferMemo)}</span>` : ""}
                </td>
                <td>${billCellHtml}</td>
                <td>${ticketColumnHtml}</td>
                <td>${badgeHtml}</td>
                <td style="text-align:right;">${actionButtonsHtml}</td>
            </tr>
        `;
    }).join("");

    // Gắn sự kiện Copy 1 chạm
    tbody.querySelectorAll(".copyable").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            const text = el.getAttribute("data-copy");
            if (text) {
                navigator.clipboard.writeText(text);
                showCopyToast(`Đã sao chép: ${text}`);
            }
        });
    });

    // Mở Lightbox ảnh Bill
    tbody.querySelectorAll(".bill-thumb, [data-bill-id]").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            const docId = el.getAttribute("data-bill-id");
            const target = allOrders.find((o) => o.id === docId);
            if (target) openBillLightbox(target);
        });
    });

    // Mở Modal xem vé QR / Gửi mail / Tải ảnh PNG
    tbody.querySelectorAll(".btn-view-ticket").forEach((btn) => {
        btn.addEventListener("click", () => {
            const docId = btn.getAttribute("data-view-id");
            const target = allOrders.find((o) => o.id === docId);
            if (target) openTicketModal(target);
        });
    });

    // Kiểm tra PayOS từng đơn
    tbody.querySelectorAll(".btn-check-payos").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const docId = btn.getAttribute("data-payos-id");
            const target = allOrders.find((o) => o.id === docId);
            if (!target || !target.payosOrderCode) return;

            btn.disabled = true;
            btn.textContent = "Đang k.tra...";
            const webhookUrls = webhookUrlInput.value.trim() || EMAIL_CONFIG.appsScriptWebhookUrl || "";

            try {
                const autoRes = await autoFulfillPayosOrder(target.id, target.payosOrderCode, webhookUrls);
                if (autoRes.isPaid) {
                    target.status = "APPROVED";
                    target.verifiedBy = "PayOS Auto (100%)";
                    target.realTicketCodes = autoRes.ticketCodes || [];
                    target.maskedTickets = autoRes.maskedTickets || [];
                    target.emailSent = Boolean(autoRes.emailSent);
                    if (autoRes.ticketCodes) realTicketVaultMap[target.id] = autoRes.ticketCodes;
                    showCopyToast(`Đã duyệt, cấp vé & gửi mail (#${target.payosOrderCode})`);
                    recomputeDashboardAndTable();
                } else {
                    alert(`Trạng thái PayOS cho đơn #${target.payosOrderCode}: ${autoRes.payosStatus || "CHƯA THANH TOÁN"}`);
                    btn.disabled = false;
                    btn.textContent = "⚡ PayOS";
                }
            } catch (err) {
                alert("Lỗi kiểm tra PayOS: " + err.message);
                btn.disabled = false;
                btn.textContent = "⚡ PayOS";
            }
        });
    });

    // Duyệt / Hoàn tác đơn
    tbody.querySelectorAll(".action-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const docId = btn.getAttribute("data-id");
            const nextStatus = btn.getAttribute("data-next");
            const target = allOrders.find((o) => o.id === docId);
            if (!target) return;

            btn.disabled = true;
            btn.textContent = "Đang xử lý...";

            try {
                if (isSuperAdmin) {
                    if (nextStatus === "APPROVED") {
                        const secretKey = hmacSecretInput.value.trim();
                        const webhookUrls = webhookUrlInput.value.trim();
                        if (!secretKey) {
                            superSecurityPanel.style.display = "block";
                            throw new Error("Vui lòng kiểm tra Khóa Bí Mật HMAC trong mục Cấu hình Bảo mật trước khi cấp vé.");
                        }

                        const issuedCodes = await approveAndIssueTickets(target, secretKey, target.realTicketCodes);
                        target.status = "APPROVED";
                        target.realTicketCodes = issuedCodes;
                        realTicketVaultMap[target.id] = issuedCodes;

                        if (EMAIL_CONFIG.enabled) {
                            try {
                                const mailRes = await sendTicketEmail(target, issuedCodes, webhookUrls);
                                if (mailRes.success) target.emailSent = true;
                            } catch (mailErr) {
                                console.warn("Gửi email tự động chưa thành công:", mailErr);
                            }
                        }

                        recomputeDashboardAndTable();
                        openTicketModal(target);
                    } else {
                        await revokeOrderTickets(target, target.realTicketCodes);
                        target.status = "PENDING";
                        recomputeDashboardAndTable();
                    }
                } else {
                    const updatedSt = await verifyOrderBillByReviewer(
                        target.id,
                        nextStatus,
                        currentUser ? currentUser.email : "staff"
                    );
                    target.status = updatedSt;
                    target.verifiedBy = currentUser ? currentUser.email : "staff";
                    recomputeDashboardAndTable();
                }
            } catch (err) {
                alert("Thao tác thất bại: " + err.message);
                recomputeDashboardAndTable();
            }
        });
    });
}

// ==============================================================================
// 10. LIGHTBOX XEM BILL & MODAL XEM VÉ / TẢI ẢNH PNG / GỬI MAIL
// ==============================================================================
function updateLightboxTransform() {
    if (lightboxImg) {
        lightboxImg.style.transform = `rotate(${currentBillRotation}deg) scale(${currentBillZoom})`;
    }
}

function dataUriToBlob(dataUri) {
    try {
        const arr = dataUri.split(",");
        const mimeMatch = arr[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) u8arr[n] = bstr.charCodeAt(n);
        return new Blob([u8arr], { type: mime });
    } catch (e) {
        return null;
    }
}

function openBillLightbox(order) {
    if (!order || !order.imageUrl) return;
    currentLightboxOrder = order;
    currentBillRotation = 0;
    currentBillZoom = 1;
    if (btnZoomBill) btnZoomBill.textContent = "🔍 Phóng to 1.6x";
    updateLightboxTransform();

    lightboxImg.src = order.imageUrl;
    lightboxTitle.textContent = `Biên lai: ${order.name || "Khách hàng"} — ${formatCurrency(order.totalAmount)}`;
    lightboxSubtitle.textContent = `SĐT: ${order.phone || "---"} • Số vé: ${order.quantity} • Nội dung CK: ${order.transferMemo || "---"}`;
    billLightboxModal.style.display = "flex";
}

if (btnCloseLightbox) btnCloseLightbox.addEventListener("click", () => { billLightboxModal.style.display = "none"; });
if (billLightboxModal) billLightboxModal.addEventListener("click", (e) => { if (e.target === billLightboxModal) billLightboxModal.style.display = "none"; });
if (btnRotateBill) btnRotateBill.addEventListener("click", () => { currentBillRotation = (currentBillRotation + 90) % 360; updateLightboxTransform(); });
if (btnZoomBill) btnZoomBill.addEventListener("click", () => {
    currentBillZoom = currentBillZoom === 1 ? 1.6 : 1;
    btnZoomBill.textContent = currentBillZoom === 1 ? "🔍 Phóng to 1.6x" : "🔍 Thu nhỏ 1.0x";
    updateLightboxTransform();
});
if (btnOpenBillTab) btnOpenBillTab.addEventListener("click", () => {
    if (!currentLightboxOrder || !currentLightboxOrder.imageUrl) return;
    const url = currentLightboxOrder.imageUrl;
    if (url.startsWith("data:image/")) {
        const blob = dataUriToBlob(url);
        if (blob) window.open(URL.createObjectURL(blob), "_blank");
    } else {
        window.open(url, "_blank");
    }
});
if (btnDownloadBill) btnDownloadBill.addEventListener("click", () => {
    if (!currentLightboxOrder || !currentLightboxOrder.imageUrl) return;
    const url = currentLightboxOrder.imageUrl;
    const safeName = (currentLightboxOrder.name || "Khach").replace(/[^a-zA-Z0-9]/g, "_");
    const fileName = `Bill_${safeName}_${currentLightboxOrder.id}.jpg`;
    if (url.startsWith("data:image/")) {
        const blob = dataUriToBlob(url);
        if (blob) {
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(blobUrl);
        }
    } else {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.download = fileName;
        a.click();
    }
});

async function openTicketModal(order) {
    currentModalOrder = order;
    let codes = (Array.isArray(order.realTicketCodes) && order.realTicketCodes.length > 0 && !order.realTicketCodes[0].includes("*"))
        ? order.realTicketCodes
        : (realTicketVaultMap[order.id] || (Array.isArray(order.ticketCodes) && order.ticketCodes.length > 0 ? order.ticketCodes : []));

    if (codes.length === 0 || codes.some((c) => typeof c === "string" && c.includes("*"))) {
        try {
            const otSnap = await getDoc(doc(db, FIREBASE_CONFIG.orderTicketsCollection || "order_tickets", order.id));
            if (otSnap.exists() && Array.isArray(otSnap.data().ticketCodes) && otSnap.data().ticketCodes.length > 0) {
                codes = otSnap.data().ticketCodes;
            }
        } catch (e) {}

        if (codes.length === 0 || codes.some((c) => typeof c === "string" && c.includes("*"))) {
            try {
                const q = query(collection(db, FIREBASE_CONFIG.ticketsCollection || "tickets"), where("orderId", "==", order.id));
                const tSnap = await getDocs(q);
                const fetched = [];
                tSnap.forEach((tDoc) => {
                    const td = tDoc.data();
                    if (td.ticketCode && !fetched.includes(td.ticketCode)) fetched.push(td.ticketCode);
                });
                if (fetched.length > 0) codes = fetched;
            } catch (e) {}
        }
    }

    if (codes.length > 0 && !codes[0].includes("*")) {
        order.realTicketCodes = codes;
        realTicketVaultMap[order.id] = codes;
        recomputeDashboardAndTable();
    } else if (Array.isArray(order.maskedTickets) && order.maskedTickets.length > 0) {
        codes = order.maskedTickets;
    }

    currentModalOrder.realTicketCodes = codes;
    modalPreviewContainer.innerHTML = buildTicketEmailHtml(order, codes);
    modalStatusBanner.style.display = "none";

    const subject = `[${EVENT_CONFIG.eventName}] Vé Điện Tử Chính Thức (${codes.length} vé) - Đơn #${order.id}`;
    const plainTextBody = [
        `Xin chào ${order.name},`,
        `Đơn đặt vé #${order.id} của bạn tại sự kiện ${EVENT_CONFIG.eventName} đã được xác nhận thanh toán!`,
        ``,
        `DANH SÁCH MÃ VÉ CHECK-IN CỦA BẠN (${codes.length} vé):`,
        ...codes.map((c, i) => `• Vé ${i + 1}: ${c}`)
    ].join("\n");

    btnModalOpenGmail.href = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(order.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainTextBody)}`;
    ticketModal.style.display = "flex";
}

if (btnCloseModal) btnCloseModal.addEventListener("click", () => { ticketModal.style.display = "none"; });
if (ticketModal) ticketModal.addEventListener("click", (e) => { if (e.target === ticketModal) ticketModal.style.display = "none"; });

if (btnModalSendEmail) {
    btnModalSendEmail.addEventListener("click", async () => {
        if (!currentModalOrder) return;
        const codes = currentModalOrder.realTicketCodes || [];
        const webhookUrls = webhookUrlInput.value.trim() || EMAIL_CONFIG.appsScriptWebhookUrl || "";
        btnModalSendEmail.disabled = true;
        btnModalSendEmail.textContent = "Đang gửi...";
        try {
            const res = await sendTicketEmail(currentModalOrder, codes, webhookUrls);
            modalStatusBanner.style.display = "block";
            if (res.success) {
                currentModalOrder.emailSent = true;
                modalStatusBanner.style.background = "#ecfdf5";
                modalStatusBanner.style.color = "#065f46";
                const quotaNote = typeof res.remainingQuota === "number" ? ` (Webhook #${res.webhookIndex}, còn ${res.remainingQuota} lượt hôm nay)` : "";
                modalStatusBanner.textContent = `✓ Đã gửi email vé tới ${currentModalOrder.email}${quotaNote}`;
                recomputeDashboardAndTable();
            } else {
                modalStatusBanner.textContent = `⚠️ ${res.reason}`;
            }
        } catch (err) {
            modalStatusBanner.style.display = "block";
            modalStatusBanner.textContent = `Lỗi gửi email: ${err.message}`;
        } finally {
            btnModalSendEmail.disabled = false;
            btnModalSendEmail.textContent = "📧 Gửi Email Vé Tự Động";
        }
    });
}

if (btnModalDownloadPng) {
    btnModalDownloadPng.addEventListener("click", async () => {
        if (!currentModalOrder) return;
        const codes = currentModalOrder.realTicketCodes || [];
        if (codes.length === 0) return alert("Đơn này chưa có mã vé.");
        btnModalDownloadPng.disabled = true;
        try {
            await downloadAllTicketsAsImages(codes, currentModalOrder, (curr, total) => {
                btnModalDownloadPng.textContent = `⏳ Đang tạo ảnh ${curr}/${total}...`;
            });
            showCopyToast(`Đã tải ${codes.length} thẻ vé PNG!`);
        } catch (e) {
            alert("Không thể tải ảnh PNG: " + e.message);
        } finally {
            btnModalDownloadPng.disabled = false;
            btnModalDownloadPng.textContent = "💾 Tải Thẻ Vé (.PNG)";
        }
    });
}

if (btnModalCopyHtml) {
    btnModalCopyHtml.addEventListener("click", async () => {
        if (!currentModalOrder || !isSuperAdmin) return;
        try {
            const html = buildTicketEmailHtml(currentModalOrder, currentModalOrder.realTicketCodes || []);
            const blobHtml = new Blob([html], { type: "text/html" });
            const blobText = new Blob([modalPreviewContainer.innerText], { type: "text/plain" });
            if (window.ClipboardItem) {
                await navigator.clipboard.write([new ClipboardItem({ "text/html": blobHtml, "text/plain": blobText })]);
            } else {
                await navigator.clipboard.writeText(html);
            }
            showCopyToast("Đã copy Nội dung Email HTML");
        } catch (e) {
            alert("Không thể copy: " + e.message);
        }
    });
}

// ==============================================================================
// 11. PHÁT HÀNH VÉ NHANH / VÉ MỜI VIP / BÁN TẠI BÀN (POS MODAL - SUPER ADMIN)
// ==============================================================================
if (btnOpenPosModal && posModal) {
    btnOpenPosModal.addEventListener("click", () => {
        if (!isSuperAdmin) return;
        const posPriceInput = document.getElementById("pos-total-amount");
        const posQtyInput = document.getElementById("pos-quantity");
        if (posQtyInput && posPriceInput) {
            posPriceInput.value = Number(posQtyInput.value || 1) * EVENT_CONFIG.ticketPrice;
        }
        posModal.style.display = "flex";
    });
}

if (btnClosePosModal && posModal) {
    btnClosePosModal.addEventListener("click", () => { posModal.style.display = "none"; });
    posModal.addEventListener("click", (e) => { if (e.target === posModal) posModal.style.display = "none"; });
}

const posQtyEl = document.getElementById("pos-quantity");
const posTypeEl = document.getElementById("pos-order-type");
const posAmountEl = document.getElementById("pos-total-amount");
function syncPosPrice() {
    if (!posQtyEl || !posAmountEl || !posTypeEl) return;
    if (posTypeEl.value === "VIP_FREE") {
        posAmountEl.value = 0;
    } else {
        posAmountEl.value = (Number(posQtyEl.value) || 1) * EVENT_CONFIG.ticketPrice;
    }
}
if (posQtyEl) posQtyEl.addEventListener("input", syncPosPrice);
if (posTypeEl) posTypeEl.addEventListener("change", syncPosPrice);

if (posForm) {
    posForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!isSuperAdmin) return;

        const secretKey = hmacSecretInput.value.trim();
        const webhookUrls = webhookUrlInput.value.trim() || EMAIL_CONFIG.appsScriptWebhookUrl || "";
        if (!secretKey) {
            posModal.style.display = "none";
            superSecurityPanel.style.display = "block";
            hmacSecretInput.focus();
            return alert("Vui lòng kiểm tra Khóa Bí Mật HMAC trong mục Cấu hình Bảo mật trước khi phát hành vé.");
        }

        const name = document.getElementById("pos-name").value.trim();
        const phone = document.getElementById("pos-phone").value.trim();
        const email = document.getElementById("pos-email").value.trim();
        const qty = Math.max(1, Math.min(20, parseInt(document.getElementById("pos-quantity").value, 10) || 1));
        const totalAmount = Math.max(0, parseInt(document.getElementById("pos-total-amount").value, 10) || 0);
        const referrer = document.getElementById("pos-referrer").value.trim();
        const orderType = document.getElementById("pos-order-type").value;

        const btnSubmitPos = document.getElementById("btn-submit-pos");
        btnSubmitPos.disabled = true;
        btnSubmitPos.textContent = "⏳ Đang phát hành vé & gửi Email...";

        try {
            const posOrderId = `POS-${Date.now().toString().slice(-7)}`;
            const orderDocRef = doc(db, FIREBASE_CONFIG.ordersCollection || "orders", posOrderId);

            await setDoc(orderDocRef, {
                customerName: name,
                name: name,
                phone: phone,
                email: email,
                facebook: "",
                referrer: referrer || (orderType === "VIP_FREE" ? "Vé Mời BTC" : "Bán Trực Tiếp POS"),
                voucherCode: orderType === "VIP_FREE" ? "VIP_INVITE" : "",
                quantity: qty,
                ticketPrice: EVENT_CONFIG.ticketPrice,
                totalAmount: totalAmount,
                transferMemo: orderType === "VIP_FREE" ? `VE MOI VIP ${posOrderId}` : `POS TIEN MAT ${posOrderId}`,
                ticketType: "e-ticket",
                paymentMethod: "pos_manual",
                status: "PENDING",
                verifiedBy: currentUser ? `POS (${currentUser.email})` : "Super Admin POS",
                createdAt: serverTimestamp()
            });

            const tempOrderObj = {
                id: posOrderId,
                name: name,
                phone: phone,
                email: email,
                quantity: qty,
                totalAmount: totalAmount
            };

            const issuedCodes = await approveAndIssueTickets(tempOrderObj, secretKey, []);
            realTicketVaultMap[posOrderId] = issuedCodes;

            if (email && EMAIL_CONFIG.enabled) {
                const mailRes = await sendTicketEmail(tempOrderObj, issuedCodes, webhookUrls);
                if (mailRes.success) {
                    tempOrderObj.emailSent = true;
                }
            }

            posForm.reset();
            posModal.style.display = "none";
            showCopyToast(`🎉 Đã phát hành ${qty} vé (${posOrderId}) thành công!`);
        } catch (err) {
            alert("Lỗi tạo vé POS: " + err.message);
        } finally {
            btnSubmitPos.disabled = false;
            btnSubmitPos.textContent = "⚡ Phát Hành Vé & Gửi Mail Ngay";
        }
    });
}

// ==============================================================================
// 12. HÀNG ĐỢI DUYỆT HÀNG LOẠT, GỬI BÙ EMAIL & AUTO-PILOT PAYOS
// ==============================================================================
async function triggerResendMissingEmails() {
    if (!isSuperAdmin) return;
    const missingList = allOrders.filter((o) => o.status === "APPROVED" && !o.emailSent);
    if (missingList.length === 0) return alert("Tất cả đơn Đã duyệt đều đã được gửi Email!");
    if (!confirm(`Gửi bù Email vé cho ${missingList.length} đơn đã thanh toán nhưng chưa nhận được mail?`)) return;

    const webhookUrls = webhookUrlInput.value.trim() || EMAIL_CONFIG.appsScriptWebhookUrl || "";
    let sentCount = 0;
    for (const order of missingList) {
        const codes = (order.realTicketCodes && order.realTicketCodes.length > 0)
            ? order.realTicketCodes
            : (realTicketVaultMap[order.id] || []);
        if (codes.length > 0) {
            try {
                const res = await sendTicketEmail(order, codes, webhookUrls);
                if (res.success) {
                    order.emailSent = true;
                    sentCount++;
                }
            } catch (_) {}
            await new Promise((r) => setTimeout(r, 900));
        }
    }
    showCopyToast(`Đã gửi bù thành công ${sentCount}/${missingList.length} email!`);
    recomputeDashboardAndTable();
}

if (btnBatchStop) {
    btnBatchStop.addEventListener("click", () => {
        stopBatchFlag = true;
        btnBatchStop.textContent = "Đang dừng...";
    });
}

if (btnBatchVerified) {
    btnBatchVerified.addEventListener("click", async () => {
        if (!isSuperAdmin) return;
        const queue = allOrders.filter((o) => o.status === "BILL_VERIFIED" || (o.status === "APPROVED" && !o.emailSent));
        if (queue.length === 0) {
            alert('Không có đơn nào ở trạng thái "Đã soi Bill" hoặc chưa gửi mail.');
            return;
        }
        const secretKey = hmacSecretInput.value.trim();
        const webhookUrls = webhookUrlInput.value.trim();
        if (!secretKey) {
            superSecurityPanel.style.display = "block";
            hmacSecretInput.focus();
            alert("Vui lòng kiểm tra Khóa Bí Mật HMAC trong mục Cấu hình Bảo mật trước khi cấp vé.");
            return;
        }
        if (!confirm(`Xác nhận cấp mã vé & gửi Email tự động cho ${queue.length} đơn hàng?`)) return;

        stopBatchFlag = false;
        btnBatchVerified.disabled = true;
        btnBatchStop.style.display = "inline-flex";
        btnBatchStop.textContent = "Dừng hàng đợi";

        let successCount = 0;
        for (let i = 0; i < queue.length; i++) {
            if (stopBatchFlag) break;
            const order = queue[i];
            batchProgressText.innerHTML = `Đang xử lý <strong>${i + 1}/${queue.length}</strong> (${escapeHtml(order.name)})...`;
            try {
                const issuedCodes = await approveAndIssueTickets(order, secretKey, order.realTicketCodes);
                order.status = "APPROVED";
                order.realTicketCodes = issuedCodes;
                realTicketVaultMap[order.id] = issuedCodes;
                if (webhookUrls || EMAIL_CONFIG.provider !== "apps_script") {
                    const mailRes = await sendTicketEmail(order, issuedCodes, webhookUrls);
                    if (mailRes.success) order.emailSent = true;
                }
                successCount++;
                recomputeDashboardAndTable();
            } catch (err) {
                console.error("Lỗi xử lý đơn:", order.id, err);
            }
            await new Promise((r) => setTimeout(r, 1200));
        }
        btnBatchVerified.disabled = false;
        btnBatchStop.style.display = "none";
        batchProgressText.innerHTML = `✓ Đã hoàn tất xử lý <strong>${successCount}/${queue.length}</strong> đơn hàng.`;
    });
}

let isAutoPilotRunning = false;
const btnVerifyPayosBatch = document.getElementById("btn-verify-payos-batch");

async function runPayosAutoPilot(showAlertWhenDone = false) {
    if (isAutoPilotRunning) return;
    const pendingWithCode = allOrders.filter((o) => (o.status === "PENDING" || o.status === "BILL_VERIFIED") && o.payosOrderCode);
    if (pendingWithCode.length === 0) {
        if (showAlertWhenDone) alert("Tất cả các đơn PayOS đều đã được duyệt hoặc hiện không có đơn chờ nào.");
        return;
    }

    const webhookUrls = webhookUrlInput.value.trim() || EMAIL_CONFIG.appsScriptWebhookUrl || "";
    if (!webhookUrls) {
        if (showAlertWhenDone) alert("Vui lòng cấu hình Google Apps Script Webhook URL trong js/config.js.");
        return;
    }

    isAutoPilotRunning = true;
    if (btnVerifyPayosBatch) btnVerifyPayosBatch.disabled = true;
    let approvedCount = 0;

    const BATCH_SIZE = 4;
    for (let i = 0; i < pendingWithCode.length; i += BATCH_SIZE) {
        const chunk = pendingWithCode.slice(i, i + BATCH_SIZE);
        if (btnVerifyPayosBatch) {
            btnVerifyPayosBatch.textContent = `🤖 Đang tự duyệt ${i + 1}-${Math.min(i + chunk.length, pendingWithCode.length)}/${pendingWithCode.length}...`;
        }
        await Promise.allSettled(chunk.map(async (order) => {
            try {
                const autoRes = await autoFulfillPayosOrder(order.id, order.payosOrderCode, webhookUrls);
                if (autoRes && autoRes.isPaid) {
                    order.status = "APPROVED";
                    order.verifiedBy = "PayOS Auto (100%)";
                    order.ticketCodes = autoRes.ticketCodes || [];
                    order.realTicketCodes = autoRes.ticketCodes || [];
                    order.maskedTickets = autoRes.maskedTickets || [];
                    order.emailSent = Boolean(autoRes.emailSent);
                    if (autoRes.ticketCodes) realTicketVaultMap[order.id] = autoRes.ticketCodes;
                    approvedCount++;
                }
            } catch (_) {}
        }));
        recomputeDashboardAndTable();
    }

    if (btnVerifyPayosBatch) {
        btnVerifyPayosBatch.disabled = false;
        btnVerifyPayosBatch.textContent = "⚡ Tự động duyệt PayOS";
    }
    isAutoPilotRunning = false;

    if (approvedCount > 0) {
        showCopyToast(`🤖 Auto-Pilot: Đã tự động duyệt & gửi mail ${approvedCount} đơn PayOS!`);
    }
    if (showAlertWhenDone) {
        alert(`Hoàn tất tự động hóa PayOS: Đã duyệt, cấp vé & gửi Email cho ${approvedCount}/${pendingWithCode.length} đơn thanh toán thành công!`);
    }
}

if (btnVerifyPayosBatch) {
    btnVerifyPayosBatch.addEventListener("click", () => runPayosAutoPilot(true));
}

setInterval(() => {
    if (currentUser && allOrders.length > 0) {
        runPayosAutoPilot(false);
    }
}, 20000);

// ==============================================================================
// 13. XUẤT BÁO CÁO KẾ TOÁN (CSV ĐƠN HÀNG, CSV DÒNG TIỀN THEO NGÀY, JSON)
// ==============================================================================
const escapeCsvCell = (val) => {
    let s = String(val ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
};

if (btnExportCsv) {
    btnExportCsv.addEventListener("click", () => {
        if (filteredOrders.length === 0) return alert("Không có dữ liệu đơn hàng để xuất!");
        const headers = [
            "Mã Đơn",
            "Ngày",
            "Thời gian đặt",
            "Họ và Tên",
            "Số điện thoại",
            "Email",
            "Link Facebook",
            "Người giới thiệu (CTV)",
            "Số lượng vé",
            isSuperAdmin ? "Danh sách Mã Vé" : "Mã Vé (Bảo mật)",
            "Số vé đã Check-in",
            "Mã Voucher",
            "Tiền giảm giá (VNĐ)",
            "Thực thu (VNĐ)",
            "Nội dung CK / Mã PayOS",
            "Đã gửi Email",
            "Người duyệt",
            "Trạng thái"
        ];

        const rows = filteredOrders.map((o) => {
            const codes = o.realTicketCodes || [];
            const checkedInCnt = codes.filter((c) => ticketCheckinMap[c] && ticketCheckinMap[c].checkedIn).length;
            return [
                o.id,
                formatDayKeyVi(o.dateKey),
                o.createdAtText,
                o.name,
                `'${o.phone}`,
                o.email,
                o.facebook || "",
                o.referrer || "",
                o.quantity,
                isSuperAdmin ? codes.join(" | ") : "PROTECTED_BY_SERVER",
                `${checkedInCnt}/${o.quantity}`,
                o.voucherCode || "",
                o.discountAmount || 0,
                o.totalAmount,
                o.transferMemo,
                o.emailSent ? "Đã gửi" : "Chưa gửi",
                o.verifiedBy || "",
                o.status
            ].map(escapeCsvCell).join(",");
        });

        const csvContent = "\uFEFF" + [headers.map(escapeCsvCell).join(","), ...rows].join("\r\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `HVC_GameOn_Don_Ve_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });
}

if (btnExportDailyCsv) {
    btnExportDailyCsv.addEventListener("click", () => {
        if (!dailyLedgerStats || dailyLedgerStats.length === 0) {
            return alert("Chưa có dữ liệu dòng tiền theo ngày để xuất!");
        }
        const headers = [
            "Ngày (DD/MM/YYYY)",
            "Số đơn thành công",
            "Số lượng vé bán ra",
            "Lũy kế tổng vé",
            "Tiền đổ về trong ngày (VNĐ)",
            "Lũy kế tổng doanh thu (VNĐ)",
            "Tổng chiết khấu Voucher (VNĐ)",
            "Tăng trưởng so với ngày trước (%)"
        ];
        const rows = [...dailyLedgerStats].reverse().map((d) => [
            formatDayKeyVi(d.dateKey),
            d.ordersCount,
            d.ticketsSold,
            d.cumulativeTickets,
            d.revenue,
            d.cumulativeRevenue,
            d.discount,
            d.revGrowthPct !== null ? `${d.revGrowthPct}%` : "—"
        ].map(escapeCsvCell).join(","));

        const csvContent = "\uFEFF" + [headers.map(escapeCsvCell).join(","), ...rows].join("\r\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `HVC_GameOn_So_Quy_Theo_Ngay_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });
}

if (btnExportJson) {
    btnExportJson.addEventListener("click", () => {
        if (filteredOrders.length === 0) return alert("Không có dữ liệu để xuất!");
        const safeExport = filteredOrders.map((o) => ({
            ...o,
            realTicketCodes: isSuperAdmin ? o.realTicketCodes : undefined
        }));
        const blob = new Blob([JSON.stringify(safeExport, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `HVC_GameOn_Orders_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });
}

if (btnRefresh) btnRefresh.addEventListener("click", loadOrdersAndTickets);

const btnCleanPending = document.getElementById("btn-clean-pending");
if (btnCleanPending) {
    btnCleanPending.addEventListener("click", async () => {
        if (!isSuperAdmin) return alert("Chỉ Super Admin mới có quyền dọn dẹp dữ liệu.");
        const pendingList = allOrders.filter((o) => o.status === "PENDING" || o.status === "pending");
        if (pendingList.length === 0) return alert("Hiện không có đơn chưa thanh toán (Pending) nào cần dọn dẹp.");
        if (!confirm(`Bạn có chắc chắn muốn xóa ${pendingList.length} đơn chưa thanh toán (Pending) cũ để làm sạch dữ liệu Firebase không?`)) return;

        btnCleanPending.disabled = true;
        btnCleanPending.textContent = "Đang dọn dẹp...";
        try {
            for (const order of pendingList) {
                await deleteDoc(doc(db, FIREBASE_CONFIG.ordersCollection || "orders", order.id));
            }
            alert(`Đã xóa thành công ${pendingList.length} đơn chưa thanh toán cũ.`);
            loadOrdersAndTickets();
        } catch (e) {
            alert("Lỗi khi xóa đơn: " + e.message);
        } finally {
            btnCleanPending.disabled = false;
            btnCleanPending.textContent = "🗑️ Dọn đơn chưa TT";
        }
    });
}

// ==============================================================================
// 14. ĐĂNG NHẬP / ĐĂNG XUẤT FIREBASE AUTH
// ==============================================================================
if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        loginError.style.display = "none";
        const email = document.getElementById("admin-email").value.trim();
        const password = document.getElementById("admin-password").value;
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (err) {
            loginError.textContent = "Sai email hoặc mật khẩu đăng nhập.";
            loginError.style.display = "block";
        }
    });
}

if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
        if (unsubscribeOrdersListener) {
            unsubscribeOrdersListener();
            unsubscribeOrdersListener = null;
        }
        if (unsubscribeTicketsListener) {
            unsubscribeTicketsListener();
            unsubscribeTicketsListener = null;
        }
        await signOut(auth);
    });
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        loginGate.style.display = "none";
        dashboardContainer.style.display = "block";
        adminUserBadge.textContent = user.email;
        await setupRoleAndLoadData(user);
    } else {
        loginGate.style.display = "block";
        dashboardContainer.style.display = "none";
        currentUser = null;
        isSuperAdmin = false;
        realTicketVaultMap = {};
        ticketCheckinMap = {};
        allOrders = [];
        dateFilteredOrders = [];
        filteredOrders = [];
        tbody.innerHTML = "";
    }
});
