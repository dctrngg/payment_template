/**
 * ==============================================================================
 * GOOGLE APPS SCRIPT - CẦU NỐI BẢO MẬT PAYOS & MÁY CHỦ WEBHOOK TỰ ĐỘNG 100%
 *                      + TẠO VIETQR ĐỘNG & TỰ ĐỘNG CẤP VÉ / GỬI EMAIL GMAIL
 *                      + BẢN VÁ BẢO MẬT CHỐNG GIAN LẬN SỐ LƯỢNG & CHỐNG SPAM QUOTA
 * ==============================================================================
 */

// 1. KHÓA BÍ MẬT PAYOS (Điền trực tiếp trên https://script.google.com, KHÔNG lưu khóa thật lên GitHub công khai)
const PAYOS_CLIENT_ID = "YOUR_PAYOS_CLIENT_ID";
const PAYOS_API_KEY = "YOUR_PAYOS_API_KEY";
const PAYOS_CHECKSUM_KEY = "YOUR_PAYOS_CHECKSUM_KEY";

// 2. ID DỰ ÁN CLOUD FIRESTORE CỦA BẠN
const FIRESTORE_PROJECT_ID = "hungvuongconcert-719d0";

// 3. URL WEB APP CỦA BẠN ĐỂ ĐĂNG KÝ VỚI PAYOS
const WEBHOOK_URL_TO_CONFIRM = "https://script.google.com/macros/s/AKfycbzp1mZ7AoMcrCm7Agl35v7TF9BAa_HANCtYUuAx21jjMDmA5VpC4op2m2lZ9hYUmw9B/exec";

/**
 * Cổng tiếp nhận toàn bộ Request (HTTP POST)
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ status: "error", message: "Không nhận được dữ liệu JSON." });
    }

    var payload = JSON.parse(e.postData.contents);

    // ==========================================================================
    // TRƯỜNG HỢP 1: WEBHOOK TRỰC TIẾP TỪ PAYOS (Server-to-Server)
    // ==========================================================================
    if (payload.data !== undefined && payload.signature && !payload.action) {
      return handlePayosWebhook(payload);
    }

    var action = payload.action || "send_email";

    // ==========================================================================
    // TRƯỜNG HỢP 2: TẠO LINK & MÃ VIETQR ĐỊNH DANH PAYOS (action: "create_payos_link")
    // ==========================================================================
    if (action === "create_payos_link") {
      return handleCreatePayosLink(payload);
    }

    // ==========================================================================
    // TRƯỜNG HỢP 3: KIỂM TRA TRẠNG THÁI GIAO DỊCH PAYOS (action: "check_payos_status")
    // ==========================================================================
    if (action === "check_payos_status") {
      return handleCheckPayosStatus(payload.orderCode);
    }

    // ==========================================================================
    // TRƯỜNG HỢP 4: XÁC NHẬN WEBHOOK URL VỚI PAYOS TỪ ADMIN (action: "confirm_payos_webhook")
    // ==========================================================================
    if (action === "confirm_payos_webhook") {
      return handleApiConfirmWebhook(payload.webhookUrl || WEBHOOK_URL_TO_CONFIRM);
    }

    // ==========================================================================
    // TRƯỜNG HỢP 5: GỬI EMAIL VÉ ĐIỆN TỬ QUA GMAIL (action: "send_email")
    // ==========================================================================
    return handleSendTicketEmail(payload);

  } catch (err) {
    console.error("Lỗi doPost:", err);
    return createJsonResponse({
      status: "error",
      message: err.toString()
    });
  }
}

/**
 * Cổng tiếp nhận HTTP GET (Dùng để kiểm tra nhanh Webhook trên trình duyệt)
 */
function doGet(e) {
  return createJsonResponse({
    status: "online",
    service: "PayOS Webhook & Ticket Mailer Bridge (Hardened Security v2)",
    time: new Date().toISOString()
  });
}

/**
 * Hàm tính đơn giá 1 vé hợp lệ (Hỗ trợ cả chế độ Test 1.000đ và Chính thức 320.000đ + Voucher)
 * Chống kẻ xấu truyền quantity = 5 nhưng chỉ trả tiền 1 vé
 */
function computeVerifiedTicketQuantity(paidAmount, requestedQty, rawUnitPrice, voucherCode) {
  var paid = Math.max(0, Number(paidAmount) || 0);
  var reqQty = Math.max(1, Math.min(5, Number(requestedQty) || 1));
  var basePrice = Number(rawUnitPrice) || 1000;
  if (basePrice !== 500 && basePrice !== 1000 && basePrice !== 2000 && basePrice !== 320000) {
    basePrice = 320000;
  }

  var effectiveUnit = basePrice;
  var code = String(voucherCode || "").trim().toUpperCase();
  if (code === "HVCGAMEON" || code === "GAMEON" || code === "HVCUNFOLD" || code === "VIP10") {
    effectiveUnit = Math.round((basePrice * 90) / 100);
  } else if (code === "CHV" && basePrice >= 30000) {
    effectiveUnit = basePrice - 20000;
  }

  var maxQtyByMoney = Math.max(1, Math.min(5, Math.floor(paid / Math.max(500, effectiveUnit))));
  return Math.min(reqQty, maxQtyByMoney);
}

// ==============================================================================
// 1. XỬ LÝ PAYOS WEBHOOK TỰ ĐỘNG (BẢO MẬT & TỨC THÌ 100%)
// ==============================================================================
function handlePayosWebhook(payload) {
  // A. Phản hồi xác nhận khi PayOS gửi ping kiểm tra kết nối Webhook URL (hoặc đơn test orderCode == 123)
  if (!payload || !payload.data || !payload.data.orderCode || payload.data.orderCode === 123 || payload.data.description === "VQRIO123") {
    return createJsonResponse({ code: "00", desc: "success", data: null });
  }

  var data = payload.data;
  var orderCode = Number(data.orderCode);
  var paidAmount = Number(data.amount) || 0;

  // B. Xác thực chữ ký số HMAC-SHA256 của PayOS
  var isValidSig = verifyPayosWebhookSignature(data, payload.signature, PAYOS_CHECKSUM_KEY);
  if (!isValidSig) {
    console.warn("Chữ ký Webhook PayOS không khớp:", payload.signature);
    return createJsonResponse({ status: "error", message: "Chữ ký PayOS không hợp lệ." });
  }

  // C. Chống xử lý trùng lặp (Idempotency) nếu PayOS gửi lại cùng 1 giao dịch
  var props = PropertiesService.getScriptProperties();
  var processedKey = "processed_" + orderCode;
  if (props.getProperty(processedKey)) {
    return createJsonResponse({ code: "00", desc: "success", data: null });
  }

  // D. Lấy thông tin đơn hàng đã lưu từ bước tạo link thanh toán
  var pendingKey = "pending_" + orderCode;
  var rawMeta = props.getProperty(pendingKey);
  var orderMeta = null;
  if (rawMeta) {
    try { orderMeta = JSON.parse(rawMeta); } catch (_) {}
  }

  // Nếu không tìm thấy nháp trong Properties, truy vấn thông tin trực tiếp từ PayOS API (dùng hàm raw JSON)
  if (!orderMeta) {
    var customer = "Khách hàng";
    var buyerEmail = "";
    var buyerPhone = "";
    try {
      var payosRaw = fetchPayosOrderRawData(orderCode);
      if (payosRaw) {
        customer = payosRaw.buyerName || customer;
        buyerEmail = payosRaw.buyerEmail || buyerEmail;
        buyerPhone = payosRaw.buyerPhone || buyerPhone;
      }
    } catch (_) {}

    orderMeta = {
      orderId: "ORD-" + orderCode,
      customerName: customer,
      name: customer,
      email: buyerEmail,
      phone: buyerPhone,
      facebook: "",
      referrer: "",
      voucherCode: "",
      quantity: 1,
      totalAmount: paidAmount || 1000,
      ticketPrice: 1000,
      payosOrderCode: orderCode
    };
  }

  // Khóa cứng số lượng vé theo đúng số tiền thực nhận trên PayOS (chống sửa quantity=5 trả tiền 1 vé)
  var verifiedQty = computeVerifiedTicketQuantity(
    paidAmount,
    orderMeta.quantity,
    orderMeta.ticketPrice,
    orderMeta.voucherCode
  );
  orderMeta.quantity = verifiedQty;
  orderMeta.totalAmount = paidAmount;

  var txRef = String(data.reference || "PAID").trim();

  // E. Sinh mã vé chuẩn tất định: HVC-XXXXXX-XXXX (Trùng khớp 100% với js/ticket-service.js)
  var ticketCodes = [];
  var maskedCodes = [];
  for (var i = 1; i <= verifiedQty; i++) {
    var code = generateDeterministicTicketCode(orderMeta.orderId, i, orderCode, txRef);
    ticketCodes.push(code);
    maskedCodes.push(maskTicket(code));
  }

  // F. Tự động ghi đơn hàng APPROVED và mã vé vào Cloud Firestore qua REST API
  var firestoreSynced = syncOrderAndTicketsToFirestore(orderMeta, ticketCodes, maskedCodes);

  // G. Tự động gửi Email vé kèm mã QR trực tiếp qua Gmail cho khách hàng
  var emailSent = false;
  if (orderMeta.email) {
    try {
      var mailResObj = sendTicketEmailInternal(orderMeta, ticketCodes);
      if (mailResObj && mailResObj.status === "success") {
        emailSent = true;
        updateFirestoreOrderEmailSent(orderMeta.orderId);
      }
    } catch (mailErr) {
      console.warn("Lỗi gửi mail qua Webhook:", mailErr);
    }
  }

  // H. Đánh dấu đã hoàn thành đơn này để tránh xử lý trùng
  try {
    props.setProperty(processedKey, "1");
    props.deleteProperty(pendingKey);
  } catch (_) {}

  return createJsonResponse({
    code: "00",
    desc: "success",
    data: {
      orderCode: orderCode,
      ticketCodes: ticketCodes,
      firestoreSynced: firestoreSynced,
      emailSent: emailSent
    }
  });
}

/**
 * Xác thực chữ ký số HMAC-SHA256 theo chuẩn Webhook của PayOS
 */
function verifyPayosWebhookSignature(data, signature, checksumKey) {
  if (!data || !signature || !checksumKey) return false;
  var keys = Object.keys(data).sort();
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var val = data[k];
    if (val !== null && val !== undefined) {
      parts.push(k + "=" + val);
    }
  }
  var dataStr = parts.join("&");
  var rawSig = Utilities.computeHmacSha256Signature(dataStr, checksumKey);
  var computedSig = rawSig.map(function(b) {
    var v = (b < 0) ? b + 256 : b;
    return ("0" + v.toString(16)).slice(-2);
  }).join("");
  return computedSig.toLowerCase() === String(signature).toLowerCase();
}

/**
 * Sinh mã vé chuẩn định dạng HVC-XXXXXX-XXXX (Chữ ký tất định chống làm giả)
 */
function generateDeterministicTicketCode(orderId, index, payosOrderCode, txRef) {
  var seed = String(orderId).trim() + "#" + (Number(index) || 1) + "#" + Number(payosOrderCode) + "#" + String(txRef || "PAID").trim();
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
  var base32Alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  var body = "";
  for (var i = 0; i < 6; i++) {
    var b = (rawHash[i] < 0) ? rawHash[i] + 256 : rawHash[i];
    body += base32Alphabet[b % 32];
  }
  var sig = "";
  for (var j = 6; j < 10; j++) {
    var b2 = (rawHash[j] < 0) ? rawHash[j] + 256 : rawHash[j];
    sig += base32Alphabet[b2 % 32];
  }
  return "HVC-" + body + "-" + sig;
}

function maskTicket(code) {
  if (!code || code.length < 8) return "HVC-******-****";
  var parts = code.split("-");
  if (parts.length === 3) {
    return parts[0] + "-" + parts[1].slice(0, 2) + "****-****";
  }
  return code.slice(0, 4) + "******";
}

// ==============================================================================
// 2. ĐỒNG BỘ FIRESTORE QUA REST API (BẢO MẬT MÃ VÉ TRONG ORDER_TICKETS)
// ==============================================================================
function syncOrderAndTicketsToFirestore(orderMeta, ticketCodes, maskedCodes) {
  try {
    var nowIso = new Date().toISOString();
    var orderId = orderMeta.orderId;
    var qty = Math.max(1, Number(orderMeta.quantity) || 1);

    // 1. Ghi đơn hàng APPROVED vào collection 'orders' (KHÔNG lưu ticketCodes thật vào bảng orders công khai)
    var orderUrl = "https://firestore.googleapis.com/v1/projects/" + FIRESTORE_PROJECT_ID + "/databases/(default)/documents/orders/" + encodeURIComponent(orderId);
    var orderBody = {
      fields: {
        customerName: { stringValue: String(orderMeta.customerName || "Khách hàng") },
        name: { stringValue: String(orderMeta.name || "Khách hàng") },
        phone: { stringValue: String(orderMeta.phone || "") },
        email: { stringValue: String(orderMeta.email || "") },
        facebook: { stringValue: String(orderMeta.facebook || "") },
        referrer: { stringValue: String(orderMeta.referrer || "") },
        voucherCode: { stringValue: String(orderMeta.voucherCode || "") },
        quantity: { integerValue: String(qty) },
        totalAmount: { integerValue: String(orderMeta.totalAmount || (qty * 1000)) },
        ticketPrice: { integerValue: String(orderMeta.ticketPrice || 1000) },
        payosOrderCode: { integerValue: String(orderMeta.payosOrderCode) },
        ticketType: { stringValue: "e-ticket" },
        paymentMethod: { stringValue: "payos_qr" },
        status: { stringValue: "APPROVED" },
        verifiedBy: { stringValue: "PayOS Webhook (100%)" },
        approvedBy: { stringValue: "PayOS Webhook (100%)" },
        maskedTickets: {
          arrayValue: {
            values: maskedCodes.map(function(m) { return { stringValue: m }; })
          }
        },
        issuedTicketCount: { integerValue: String(ticketCodes.length) },
        emailSent: { booleanValue: false },
        approvedAt: { timestampValue: nowIso },
        createdAt: { timestampValue: nowIso }
      }
    };

    UrlFetchApp.fetch(orderUrl, {
      method: "patch",
      contentType: "application/json",
      payload: JSON.stringify(orderBody),
      muteHttpExceptions: true
    });

    // 2. Ghi từng vé vào collection 'tickets'
    for (var i = 0; i < ticketCodes.length; i++) {
      var tCode = ticketCodes[i];
      var tUrl = "https://firestore.googleapis.com/v1/projects/" + FIRESTORE_PROJECT_ID + "/databases/(default)/documents/tickets/" + encodeURIComponent(tCode);
      var tBody = {
        fields: {
          ticketCode: { stringValue: tCode },
          orderId: { stringValue: orderId },
          ticketNumber: { integerValue: String(i + 1) },
          ticketLabel: { stringValue: "Vé " + (i + 1) + "/" + qty },
          customerName: { stringValue: String(orderMeta.name || "Khách hàng") },
          phone: { stringValue: String(orderMeta.phone || "") },
          email: { stringValue: String(orderMeta.email || "") },
          eventName: { stringValue: "Hùng Vương Concert: GAME ON" },
          ticketTypeName: { stringValue: "Vé Điện Tử (Player Pass QR)" },
          unitPrice: { integerValue: String(orderMeta.ticketPrice || 1000) },
          status: { stringValue: "VALID" },
          checkedIn: { booleanValue: false },
          issuedBy: { stringValue: "PAYOS_AUTO" },
          payosOrderCode: { integerValue: String(orderMeta.payosOrderCode) },
          issuedAt: { timestampValue: nowIso }
        }
      };
      UrlFetchApp.fetch(tUrl, {
        method: "patch",
        contentType: "application/json",
        payload: JSON.stringify(tBody),
        muteHttpExceptions: true
      });
    }

    // 3. Ghi mã vé thật vào collection bảo mật 'order_tickets' (Chỉ Super Admin đọc được)
    var otUrl = "https://firestore.googleapis.com/v1/projects/" + FIRESTORE_PROJECT_ID + "/databases/(default)/documents/order_tickets/" + encodeURIComponent(orderId);
    var otBody = {
      fields: {
        orderId: { stringValue: orderId },
        customerName: { stringValue: String(orderMeta.name || "Khách hàng") },
        email: { stringValue: String(orderMeta.email || "") },
        quantity: { integerValue: String(qty) },
        ticketCodes: {
          arrayValue: {
            values: ticketCodes.map(function(c) { return { stringValue: c }; })
          }
        },
        issuedBy: { stringValue: "PAYOS_AUTO" },
        issuedAt: { timestampValue: nowIso }
      }
    };
    UrlFetchApp.fetch(otUrl, {
      method: "patch",
      contentType: "application/json",
      payload: JSON.stringify(otBody),
      muteHttpExceptions: true
    });

    return true;
  } catch (err) {
    console.warn("Lỗi ghi Firestore REST qua Webhook:", err);
    return false;
  }
}

function updateFirestoreOrderEmailSent(orderId) {
  try {
    var updateUrl = "https://firestore.googleapis.com/v1/projects/" + FIRESTORE_PROJECT_ID + "/databases/(default)/documents/orders/" + encodeURIComponent(orderId) + "?updateMask.fieldPaths=emailSent&updateMask.fieldPaths=emailSentAt";
    var body = {
      fields: {
        emailSent: { booleanValue: true },
        emailSentAt: { timestampValue: new Date().toISOString() }
      }
    };
    UrlFetchApp.fetch(updateUrl, {
      method: "patch",
      contentType: "application/json",
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
  } catch (_) {}
}

// ==============================================================================
// 3. TẠO PHIÊN THANH TOÁN PAYOS (POST /v2/payment-requests)
// ==============================================================================
function handleCreatePayosLink(payload) {
  var orderCode = Number(payload.orderCode);
  var amount = Number(payload.amount);
  var rawDesc = String(payload.description || ("HVC " + orderCode)).replace(/[^a-zA-Z0-9 ]/g, "").trim();
  var description = rawDesc.slice(0, 25) || ("HVC " + orderCode);
  var returnUrl = String(payload.returnUrl || "https://hungvuongconcert.web.app/thanks.html");
  var cancelUrl = String(payload.cancelUrl || "https://hungvuongconcert.web.app/index.html");

  if (!orderCode || !amount || amount < 500) {
    return createJsonResponse({ status: "error", message: "Thiếu orderCode hoặc amount hợp lệ." });
  }

  var verifiedQty = computeVerifiedTicketQuantity(
    amount,
    payload.quantity,
    payload.ticketPrice,
    payload.voucherCode
  );

  // Lưu thông tin đơn chờ vào ScriptProperties để khi Webhook PayOS gọi tới có dữ liệu xuất vé
  try {
    var orderMeta = {
      orderId: payload.orderId || ("ORD-" + orderCode),
      customerName: payload.buyerName || "Khách hàng",
      name: payload.buyerName || "Khách hàng",
      email: payload.buyerEmail || "",
      phone: payload.buyerPhone || "",
      facebook: payload.facebook || "",
      referrer: payload.referrer || "",
      voucherCode: payload.voucherCode || "",
      quantity: verifiedQty,
      totalAmount: amount,
      ticketPrice: Number(payload.ticketPrice) || 1000,
      payosOrderCode: orderCode,
      createdAt: new Date().toISOString()
    };
    PropertiesService.getScriptProperties().setProperty("pending_" + orderCode, JSON.stringify(orderMeta));
  } catch (propErr) {
    console.warn("Lỗi lưu pending order:", propErr);
  }

  var signature = createPayosSignature(orderCode, amount, description, cancelUrl, returnUrl);

  var requestBody = {
    orderCode: orderCode,
    amount: amount,
    description: description,
    buyerName: payload.buyerName || "",
    buyerEmail: payload.buyerEmail || "",
    buyerPhone: payload.buyerPhone || "",
    cancelUrl: cancelUrl,
    returnUrl: returnUrl,
    signature: signature
  };

  var response = UrlFetchApp.fetch("https://api-merchant.payos.vn/v2/payment-requests", {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-client-id": PAYOS_CLIENT_ID,
      "x-api-key": PAYOS_API_KEY
    },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });

  var resJson = JSON.parse(response.getContentText());
  if (resJson.code === "00" && resJson.data) {
    return createJsonResponse({
      status: "success",
      payosCode: resJson.code,
      data: resJson.data
    });
  }

  return createJsonResponse({
    status: "error",
    payosCode: resJson.code,
    message: resJson.desc || "Không thể khởi tạo thanh toán PayOS."
  });
}

// ==============================================================================
// 4. KIỂM TRA TRẠNG THÁI GIAO DỊCH PAYOS (GET /v2/payment-requests/{orderCode})
// ==============================================================================
function fetchPayosOrderRawData(orderCode) {
  if (!orderCode) return null;
  var url = "https://api-merchant.payos.vn/v2/payment-requests/" + encodeURIComponent(orderCode);
  var response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      "x-client-id": PAYOS_CLIENT_ID,
      "x-api-key": PAYOS_API_KEY
    },
    muteHttpExceptions: true
  });
  var resJson = JSON.parse(response.getContentText());
  if (resJson && resJson.code === "00" && resJson.data) {
    return resJson.data;
  }
  return null;
}

function handleCheckPayosStatus(orderCode) {
  if (!orderCode) {
    return createJsonResponse({ status: "error", message: "Thiếu mã orderCode cần kiểm tra." });
  }

  var d = fetchPayosOrderRawData(orderCode);
  if (d) {
    var isPaid = (d.status === "PAID" && Number(d.amountPaid) >= Number(d.amount));
    return createJsonResponse({
      status: "success",
      isPaid: isPaid,
      payosStatus: d.status,
      orderCode: d.orderCode,
      amount: d.amount,
      amountPaid: d.amountPaid,
      amountRemaining: d.amountRemaining,
      transactions: d.transactions || []
    });
  }

  return createJsonResponse({
    status: "error",
    isPaid: false,
    message: "Không tìm thấy giao dịch trên PayOS."
  });
}

// ==============================================================================
// 5. GỬI EMAIL VÉ ĐIỆN TỬ QUA GMAIL (INLINE CID QR + CHỐNG SPAM QUOTA)
// ==============================================================================
function sendTicketEmailInternal(orderMeta, ticketCodes) {
  var recipient = orderMeta.email;
  var customerName = orderMeta.customerName || orderMeta.name || "Khách hàng";
  var orderId = orderMeta.orderId;
  var eventName = "Hùng Vương Concert: GAME ON";
  var eventDate = "19:00 - Chủ Nhật, Hùng Vương Concert: GAME ON";
  var eventVenue = "Hội trường Trung tâm";
  var subject = "[" + eventName + "] Vé Điện Tử Chính Thức (" + ticketCodes.length + " vé) - Đơn #" + orderId;

  var cardsHtml = ticketCodes.map(function(code, idx) {
    var qrUrl = "https://quickchart.io/qr?size=320&margin=2&text=" + encodeURIComponent(code);
    return '<div style="margin-bottom: 24px; padding: 20px; border: 2px solid #e11d48; border-radius: 16px; background-color: #ffffff; text-align: center;">' +
      '<div style="font-size: 13px; font-weight: 800; color: #9f1239; margin-bottom: 8px;">🕹️ PLAYER PASS #' + (idx + 1) + '/' + ticketCodes.length + ' — CHÍNH THỨC</div>' +
      '<div style="margin: 12px auto; display: inline-block; padding: 10px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px;">' +
        '<img src="' + qrUrl + '" alt="QR ' + code + '" width="200" height="200" style="display: block; margin: 0 auto; border: 0;" />' +
      '</div>' +
      '<div style="font-family: Consolas, monospace; font-size: 18px; font-weight: 800; color: #be123c; background: #fff1f2; border: 1.5px dashed #e11d48; padding: 8px 16px; border-radius: 8px; margin: 10px auto; display: inline-block; letter-spacing: 1px;">' +
        code +
      '</div>' +
      '<div style="font-size: 12px; color: #64748b; margin-top: 6px;">Vui lòng xuất trình mã QR này tại quầy Check-in để vào cổng (01 lần quét duy nhất).</div>' +
    '</div>';
  }).join("");

  var htmlBody = '<div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; background-color: #f8fafc; padding: 24px; border-radius: 20px; color: #0f172a;">' +
    '<div style="text-align: center; margin-bottom: 24px;">' +
      '<h2 style="margin: 0; color: #e11d48; font-size: 22px; font-weight: 800;">' + eventName + '</h2>' +
      '<p style="margin: 4px 0 0; color: #64748b; font-size: 14px;">XÁC NHẬN THANH TOÁN & THẺ VÉ ĐIỆN TỬ</p>' +
    '</div>' +
    '<div style="background: #ffffff; padding: 20px; border-radius: 16px; margin-bottom: 24px; border: 1px solid #e2e8f0;">' +
      '<p style="margin: 0 0 10px; font-size: 15px;">Xin chào <strong>' + customerName + '</strong>,</p>' +
      '<p style="margin: 0; font-size: 14px; color: #334155; line-height: 1.6;">Đơn đặt vé <strong>#' + orderId + '</strong> của bạn đã được hệ thống PayOS tự động xác thực thanh toán thành công. Dưới đây là thẻ vé điện tử (Player Pass QR) chính thức của bạn:</p>' +
    '</div>' +
    cardsHtml +
    '<div style="text-align: center; font-size: 12px; color: #94a3b8; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px;">' +
      '<p style="margin: 0;">Thời gian: ' + eventDate + ' • Địa điểm: ' + eventVenue + '</p>' +
      '<p style="margin: 4px 0 0;">Cảm ơn bạn đã đồng hành cùng chương trình gây quỹ từ thiện!</p>' +
    '</div>' +
  '</div>';

  return executeSendEmailCore({
    to: recipient,
    subject: subject,
    htmlBody: htmlBody,
    orderId: orderId,
    payosOrderCode: orderMeta.payosOrderCode,
    ticketCodes: ticketCodes,
    isInternalWebhook: true
  });
}

function handleSendTicketEmail(payload) {
  var resObj = executeSendEmailCore(payload);
  return createJsonResponse(resObj);
}

function executeSendEmailCore(payload) {
  var recipient = String(payload.to || "").trim();
  var subject = String(payload.subject || "Vé Điện Tử Sự Kiện").trim();
  var htmlBody = String(payload.htmlBody || "");
  var orderId = String(payload.orderId || "").trim();
  var payosOrderCode = payload.payosOrderCode ? String(payload.payosOrderCode).trim() : "";
  var ticketCodes = Array.isArray(payload.ticketCodes) ? payload.ticketCodes : [];

  if (!recipient || recipient.indexOf("@") === -1) {
    return { status: "error", message: "Địa chỉ email người nhận không hợp lệ." };
  }

  // BẢO MẬT 1: Bắt buộc phải có orderId hợp lệ và danh sách mã vé đúng chuẩn HVC-XXXXXX-XXXX
  if (!orderId || ticketCodes.length === 0 || ticketCodes.length > 20) {
    return { status: "error", message: "Từ chối gửi mail: Thiếu mã đơn hàng hoặc danh sách mã vé hợp lệ." };
  }

  var validTicketRegex = /^HVC-[A-Z0-9]{6}-[A-Z0-9]{4}$/;
  for (var k = 0; k < ticketCodes.length; k++) {
    if (!validTicketRegex.test(String(ticketCodes[k]).trim())) {
      return { status: "error", message: "Mã vé không đúng định dạng chữ ký bảo mật HVC." };
    }
  }

  // BẢO MẬT 2: Chống gửi trùng lặp & chống đốt Quota Gmail bằng CacheService
  // Nếu Webhook vừa gửi xong thì khi khách mở thanks.html sẽ không gửi trùng lần 2
  try {
    var cache = CacheService.getScriptCache();
    var cacheKey = "hvc_mail_count_" + orderId.replace(/[^a-zA-Z0-9_-]/g, "_");
    var sentCount = Number(cache.get(cacheKey) || "0");
    if (sentCount >= 1 && !payload.forceAdminResend) {
      return {
        status: "success",
        alreadySentCached: true,
        message: "Email cho đơn " + orderId + " đã được gửi tự động trước đó.",
        remainingQuota: MailApp.getRemainingDailyQuota()
      };
    }
    cache.put(cacheKey, String(sentCount + 1), 21600); // Lưu khóa 6 tiếng
  } catch (_) {}

  // BẢO MẬT 3: Nếu gọi từ bên ngoài (không phải từ Webhook nội bộ) và có payosOrderCode, đối chiếu trạng thái PAID trên PayOS
  if (!payload.isInternalWebhook && payosOrderCode && PAYOS_API_KEY && PAYOS_API_KEY !== "YOUR_PAYOS_API_KEY") {
    try {
      var rawOrder = fetchPayosOrderRawData(payosOrderCode);
      if (rawOrder && rawOrder.status !== "PAID") {
        return {
          status: "error",
          message: "Từ chối gửi email: Đơn PayOS #" + payosOrderCode + " chưa thanh toán (status: " + rawOrder.status + ")."
        };
      }
    } catch (_) {}
  }

  var inlineImages = {};
  if (ticketCodes.length > 0) {
    for (var i = 0; i < ticketCodes.length; i++) {
      var code = String(ticketCodes[i]).trim();
      if (!code) continue;

      var cidKey = "ticket_qr_" + i;
      var qrBlob = fetchQrBlobWithFallback(code);
      if (qrBlob) {
        inlineImages[cidKey] = qrBlob;
        var safeCodePattern = escapeRegexForAppsScript(code);
        var qrImgRegex = new RegExp('https?:\\/\\/[^"\'\\s]*(?:quickchart\\.io|qrserver\\.com)[^"\'\\s]*' + safeCodePattern + '[^"\'\\s]*', 'g');
        htmlBody = htmlBody.replace(qrImgRegex, "cid:" + cidKey);
      }
    }
  }

  var mailOptions = {
    to: recipient,
    subject: subject,
    htmlBody: htmlBody,
    name: "Ban Tổ Chức Sự Kiện"
  };

  if (Object.keys(inlineImages).length > 0) {
    mailOptions.inlineImages = inlineImages;
  }

  MailApp.sendEmail(mailOptions);

  return {
    status: "success",
    message: "Đã gửi email vé thành công tới " + recipient,
    inlineCount: Object.keys(inlineImages).length,
    remainingQuota: MailApp.getRemainingDailyQuota()
  };
}

function fetchQrBlobWithFallback(ticketCode) {
  var encoded = encodeURIComponent(ticketCode);
  var sources = [
    "https://quickchart.io/qr?size=320&margin=2&text=" + encoded,
    "https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=" + encoded
  ];

  for (var i = 0; i < sources.length; i++) {
    try {
      var resp = UrlFetchApp.fetch(sources[i], { muteHttpExceptions: true });
      if (resp.getResponseCode() === 200) {
        var blob = resp.getBlob();
        blob.setName("ticket_qr_" + ticketCode.replace(/[^a-zA-Z0-9_-]/g, "_") + ".png");
        blob.setContentType("image/png");
        return blob;
      }
    } catch (_) {}
  }
  return null;
}

// ==============================================================================
// 6. XÁC NHẬN & LIÊN KẾT WEBHOOK VỚI MÁY CHỦ PAYOS (CÓ WARM-UP CHỐNG TIMEOUT 10S)
// ==============================================================================
function confirmPayosWebhook() {
  var url = String(WEBHOOK_URL_TO_CONFIRM || "").trim();
  if (!url || url.indexOf("https://script.google.com/macros/s/") !== 0) {
    Logger.log("❌ LỖI: Vui lòng điền đúng URL Web App Google Apps Script vào WEBHOOK_URL_TO_CONFIRM!");
    return;
  }

  // BƯỚC 1: Ping khởi động làm nóng máy chủ Apps Script (Warm-up) để tránh lỗi PayOS timeout 10000ms
  // đồng thời kiểm tra xem URL đã được cập nhật lên Phiên bản mới (New version) hay chưa.
  try {
    var warmResp = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        code: "00",
        desc: "success",
        data: { orderCode: 123, amount: 3000, description: "VQRIO123" },
        signature: "warmup_ping"
      }),
      muteHttpExceptions: true
    });
    var warmText = warmResp.getContentText();
    Logger.log("⚡ Kết quả Warm-up kiểm tra URL (" + warmResp.getResponseCode() + "): " + warmText);

    if (warmText.indexOf('"code":"00"') === -1) {
      Logger.log("⚠️ CẢNH BÁO QUAN TRỌNG: Đường dẫn WEBHOOK_URL_TO_CONFIRM hiện vẫn đang chạy bản code CŨ (chưa có hàm nhận Webhook PayOS)!");
      Logger.log("👉 CÁCH KHẮC PHỤC: Nhấn nút 'Triển khai' (Deploy) -> 'Quản lý bản triển khai' -> Bấm biểu tượng cây bút ✏️ -> Chọn 'Phiên bản mới' (New version) -> Nhấn 'Triển khai', hoặc nếu bạn tạo bản triển khai mới thì copy URL '/exec' mới dán vào dòng 18 (WEBHOOK_URL_TO_CONFIRM) rồi nhấn Ctrl+S và Chạy lại!");
      return;
    }
  } catch (warmErr) {
    Logger.log("Lỗi kiểm tra Warm-up URL: " + warmErr);
  }

  // BƯỚC 2: Gọi PayOS xác nhận Webhook sau khi container Apps Script đã được làm nóng (< 0.5s)
  var res = handleApiConfirmWebhook(url);
  Logger.log("Kết quả từ PayOS: " + res.getContent());
}

function handleApiConfirmWebhook(webhookUrl) {
  var url = String(webhookUrl || WEBHOOK_URL_TO_CONFIRM || "").trim();
  // BẢO MẬT: Chỉ cho phép đăng ký URL thuộc Google Apps Script chính chủ, chặn kẻ xấu đổi Webhook sang domain lạ
  if (!url || url.indexOf("https://script.google.com/macros/s/") !== 0) {
    return createJsonResponse({
      status: "error",
      message: "Từ chối bảo mật: Webhook URL phải là đường dẫn Google Apps Script hợp lệ (https://script.google.com/macros/s/...)."
    });
  }

  try {
    // Làm nóng container Google Apps Script trước khi gọi PayOS confirm-webhook để tránh timeout 10000ms
    try {
      UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({
          code: "00",
          desc: "success",
          data: { orderCode: 123, amount: 3000, description: "VQRIO123" },
          signature: "warmup_ping"
        }),
        muteHttpExceptions: true
      });
    } catch (_) {}

    var response = UrlFetchApp.fetch("https://api-merchant.payos.vn/confirm-webhook", {
      method: "post",
      contentType: "application/json",
      headers: {
        "x-client-id": PAYOS_CLIENT_ID,
        "x-api-key": PAYOS_API_KEY
      },
      payload: JSON.stringify({ webhookUrl: url }),
      muteHttpExceptions: true
    });

    var resText = response.getContentText();
    var resJson = {};
    try { resJson = JSON.parse(resText); } catch (_) {}

    if (resJson.code === "00") {
      return createJsonResponse({
        status: "success",
        message: "PayOS đã xác nhận và lưu Webhook URL thành công!",
        data: resJson.data
      });
    }

    return createJsonResponse({
      status: "error",
      message: resJson.desc || "Không thể xác nhận Webhook với PayOS. Chi tiết: " + resText,
      raw: resJson
    });
  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: "Lỗi kết nối tới PayOS confirm-webhook: " + err.toString()
    });
  }
}

// ==============================================================================
// 7. TIỆN ÍCH DÙNG CHUNG
// ==============================================================================
function createPayosSignature(orderCode, amount, description, cancelUrl, returnUrl) {
  var dataStr = "amount=" + amount +
                "&cancelUrl=" + cancelUrl +
                "&description=" + description +
                "&orderCode=" + orderCode +
                "&returnUrl=" + returnUrl;

  var rawSig = Utilities.computeHmacSha256Signature(dataStr, PAYOS_CHECKSUM_KEY);
  return rawSig.map(function(b) {
    var v = (b < 0) ? b + 256 : b;
    return ("0" + v.toString(16)).slice(-2);
  }).join("");
}

function escapeRegexForAppsScript(str) {
  return String(str).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

function createJsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
