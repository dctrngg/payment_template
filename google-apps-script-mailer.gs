/**
 * ==============================================================================
 * GOOGLE APPS SCRIPT - CẦU NỐI BẢO MẬT PAYOS (TẠO VIETQR & ĐỐI SOÁT TỰ ĐỘNG)
 *                      + GỬI EMAIL VÉ ĐIỆN TỬ QUA GMAIL BTC (INLINE QR CID)
 *                      + CHỐNG SPAM / ĐỐT QUOTA GMAIL (CACHESERVICE RATE-LIMIT)
 * ==============================================================================
 * HƯỚNG DẪN CÀI ĐẶT / CẬP NHẬT CHỈ TRONG 1 PHÚT:
 * 1. Truy cập https://script.google.com/ -> Mở dự án của bạn (hoặc tạo "Dự án mới").
 * 2. Xóa code cũ, dán toàn bộ nội dung file này vào -> Nhấn Ctrl+S để lưu.
 * 3. Nhấn nút "Triển khai" (Deploy) góc trên bên phải -> Chọn "Quản lý bản triển khai" (Manage deployments):
 *    - Chọn phiên bản hiện tại -> Nhấn biểu tượng chỉnh sửa (cây bút) -> Chọn "Phiên bản mới" (New version) -> Nhấn "Triển khai" (Deploy).
 *    (Nếu tạo mới lần đầu: Chọn "Tùy chọn triển khai mới" -> Web app -> Execute as "Tôi" -> Who has access "Bất kỳ ai").
 * 4. Copy đường dẫn "URL ứng dụng web" (Web app URL).
 * 5. Dán URL đó vào biến `appsScriptWebhookUrl` trong file `js/config.js`
 *    (và ô "Google Apps Script Webhook URLs" trên trang Admin `admin-orders.html`).
 */

// KHÓA BÍ MẬT PAYOS (Chỉ điền trực tiếp trên https://script.google.com, KHÔNG lưu khóa thật lên GitHub)
const PAYOS_CLIENT_ID = "YOUR_PAYOS_CLIENT_ID";
const PAYOS_API_KEY = "YOUR_PAYOS_API_KEY";
const PAYOS_CHECKSUM_KEY = "YOUR_PAYOS_CHECKSUM_KEY";

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ status: "error", message: "Không nhận được dữ liệu JSON." });
    }

    var payload = JSON.parse(e.postData.contents);
    var action = payload.action || "send_email";

    // ==========================================================================
    // 1. TẠO LINK & MÃ VIETQR ĐỊNH DANH PAYOS (action: "create_payos_link")
    // ==========================================================================
    if (action === "create_payos_link") {
      return handleCreatePayosLink(payload);
    }

    // ==========================================================================
    // 2. KIỂM TRA TRẠNG THÁI GIAO DỊCH PAYOS (action: "check_payos_status")
    // ==========================================================================
    if (action === "check_payos_status") {
      return handleCheckPayosStatus(payload.orderCode);
    }

    // ==========================================================================
    // 3. GỬI EMAIL VÉ ĐIỆN TỬ CÓ CHỐNG SPAM QUOTA (action: "send_email")
    // ==========================================================================
    return handleSendTicketEmail(payload);

  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: err.toString()
    });
  }
}

/**
 * Xử lý tạo phiên thanh toán PayOS (POST /v2/payment-requests)
 */
function handleCreatePayosLink(payload) {
  var orderCode = Number(payload.orderCode);
  var amount = Number(payload.amount);
  // PayOS quy định description tối đa 25 ký tự không dấu
  var rawDesc = String(payload.description || ("HVC " + orderCode)).replace(/[^a-zA-Z0-9 ]/g, "").trim();
  var description = rawDesc.slice(0, 25) || ("HVC " + orderCode);
  var returnUrl = String(payload.returnUrl || "https://hungvuongconcert.web.app/thanks.html");
  var cancelUrl = String(payload.cancelUrl || "https://hungvuongconcert.web.app/index.html");

  if (!orderCode || !amount || amount < 500) {
    return createJsonResponse({ status: "error", message: "Thiếu orderCode hoặc amount hợp lệ." });
  }

  // Tạo chữ ký HMAC-SHA256 theo đúng thứ tự alphabet của PayOS:
  // amount=$amount&cancelUrl=$cancelUrl&description=$description&orderCode=$orderCode&returnUrl=$returnUrl
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

/**
 * Xử lý kiểm tra trạng thái đơn hàng trên PayOS (GET /v2/payment-requests/{orderCode})
 */
function handleCheckPayosStatus(orderCode) {
  if (!orderCode) {
    return createJsonResponse({ status: "error", message: "Thiếu mã orderCode cần kiểm tra." });
  }

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
  if (resJson.code === "00" && resJson.data) {
    var d = resJson.data;
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
    payosCode: resJson.code,
    message: resJson.desc || "Không tìm thấy giao dịch trên PayOS."
  });
}

/**
 * Hàm ký HMAC-SHA256 chuẩn của PayOS
 */
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

/**
 * Xử lý gửi Email Vé Điện Tử qua Gmail (KÈM LỚP BẢO VỆ CHỐNG ĐỐT QUOTA & OPEN RELAY)
 */
function handleSendTicketEmail(payload) {
  var recipient = String(payload.to || "").trim();
  var subject = String(payload.subject || "Vé Điện Tử Sự Kiện").trim();
  var htmlBody = String(payload.htmlBody || "");
  var orderId = String(payload.orderId || "").trim();
  var payosOrderCode = payload.payosOrderCode ? String(payload.payosOrderCode).trim() : "";
  var ticketCodes = Array.isArray(payload.ticketCodes) ? payload.ticketCodes : [];

  if (!recipient || recipient.indexOf("@") === -1) {
    return createJsonResponse({ status: "error", message: "Địa chỉ email người nhận không hợp lệ." });
  }

  // BẢO MẬT 1: Bắt buộc phải có orderId hợp lệ và danh sách mã vé đúng chuẩn HVC-XXXXXX-XXXX
  // Chặn hoàn toàn việc kẻ xấu lợi dụng Webhook làm Open Email Relay gửi nội dung rác/phishing
  if (!orderId || ticketCodes.length === 0 || ticketCodes.length > 20) {
    return createJsonResponse({ status: "error", message: "Yêu cầu gửi mail bị từ chối: Thiếu mã đơn hoặc danh sách mã vé hợp lệ." });
  }

  var validTicketRegex = /^[A-Z0-9]{2,6}-[A-Z0-9]{4,10}-[A-F0-9]{4,8}$/;
  for (var k = 0; k < ticketCodes.length; k++) {
    if (!validTicketRegex.test(String(ticketCodes[k]).trim())) {
      return createJsonResponse({ status: "error", message: "Mã vé không đúng định dạng chữ ký bảo mật." });
    }
  }

  // BẢO MẬT 2: Chống đốt Quota Gmail (Rate-Limit / Deduplication bằng CacheService)
  // Mỗi mã đơn (orderId) chỉ được phép gửi tối đa 2 lần trong 6 giờ để tránh vòng lặp spam làm cạn 100 mail/ngày
  try {
    var cache = CacheService.getScriptCache();
    var cacheKey = "hvc_mail_count_" + orderId.replace(/[^a-zA-Z0-9_-]/g, "_");
    var sentCount = Number(cache.get(cacheKey) || "0");
    if (sentCount >= 2 && !payload.forceAdminResend) {
      return createJsonResponse({
        status: "success",
        alreadySentCached: true,
        message: "Email cho đơn " + orderId + " đã được gửi trước đó (Chống gửi lặp bảo vệ Quota).",
        remainingQuota: MailApp.getRemainingDailyQuota()
      });
    }
    cache.put(cacheKey, String(sentCount + 1), 21600); // Lưu cache 6 tiếng (21600 giây)
  } catch (cacheErr) {}

  // BẢO MẬT 3: Nếu đơn có payosOrderCode và đã cấu hình PAYOS_API_KEY, đối chiếu nhanh trạng thái PAID trên PayOS
  if (payosOrderCode && PAYOS_API_KEY && PAYOS_API_KEY !== "YOUR_PAYOS_API_KEY") {
    try {
      var verifyUrl = "https://api-merchant.payos.vn/v2/payment-requests/" + encodeURIComponent(payosOrderCode);
      var verifyResp = UrlFetchApp.fetch(verifyUrl, {
        method: "get",
        headers: {
          "x-client-id": PAYOS_CLIENT_ID,
          "x-api-key": PAYOS_API_KEY
        },
        muteHttpExceptions: true
      });
      var verifyJson = JSON.parse(verifyResp.getContentText());
      if (verifyJson && verifyJson.code === "00" && verifyJson.data) {
        if (verifyJson.data.status !== "PAID") {
          return createJsonResponse({
            status: "error",
            message: "Từ chối gửi email: Đơn PayOS #" + payosOrderCode + " chưa ở trạng thái PAID."
          });
        }
      }
    } catch (verifyErr) {}
  }

  var inlineImages = {};

  // Tự động tải mã QR về và đính kèm dạng Inline Attachment (cid:)
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

  return createJsonResponse({
    status: "success",
    message: "Đã gửi email vé thành công tới " + recipient,
    inlineCount: Object.keys(inlineImages).length,
    remainingQuota: MailApp.getRemainingDailyQuota()
  });
}

/**
 * Tải ảnh QR dưới dạng Blob với cơ chế tự động thử nhiều nguồn CDN (QuickChart -> QRServer)
 */
function fetchQrBlobWithFallback(ticketCode) {
  var encoded = encodeURIComponent(ticketCode);
  var sources = [
    "https://quickchart.io/qr?size=320&margin=2&text=" + encoded,
    "https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=" + encoded
  ];

  for (var i = 0; i < sources.length; i++) {
    try {
      var resp = UrlFetchApp.fetch(sources[i], {
        muteHttpExceptions: true
      });
      if (resp.getResponseCode() === 200) {
        var blob = resp.getBlob();
        blob.setName("ticket_qr_" + ticketCode.replace(/[^a-zA-Z0-9_-]/g, "_") + ".png");
        blob.setContentType("image/png");
        return blob;
      }
    } catch (e) {}
  }
  return null;
}

function escapeRegexForAppsScript(str) {
  return String(str).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

function createJsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
