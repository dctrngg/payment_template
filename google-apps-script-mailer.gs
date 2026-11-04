/**
 * ==============================================================================
 * GOOGLE APPS SCRIPT - CẦU NỐI BẢO MẬT PAYOS (TẠO VIETQR & ĐỐI SOÁT TỰ ĐỘNG)
 *                      + GỬI EMAIL VÉ ĐIỆN TỬ QUA GMAIL BTC
 * ==============================================================================
 * HƯỚNG DẪN CÀI ĐẶT / CẬP NHẬT CHỈ TRONG 1 PHÚT:
 * 1. Truy cập https://script.google.com/ -> Mở dự án của bạn (hoặc tạo "Dự án mới").
 * 2. Xóa code cũ, dán toàn bộ nội dung file này vào -> Nhấn Ctrl+S để lưu.
 * 3. Nhấn nút "Triển khai" (Deploy) góc trên bên phải -> Chọn "Tùy chọn triển khai mới" (New deployment):
 *    - Chọn loại (Select type): "Ứng dụng web" (Web app)
 *    - Thực thi dưới dạng (Execute as): "Tôi" (Me)
 *    - Ai có quyền truy cập (Who has access): "Bất kỳ ai" (Anyone)
 * 4. Nhấn "Triển khai" (Deploy) -> Cấp quyền -> Copy đường dẫn "URL ứng dụng web" (Web app URL).
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
    // 3. GỬI EMAIL VÉ ĐIỆN TỬ (action: "send_email")
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

  if (!orderCode || !amount || amount <= 0) {
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
      data: resJson.data // Chứa checkoutUrl, qrCode, accountNumber, accountName, bin, amount, orderCode...
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
      payosStatus: d.status, // "PENDING" | "PAID" | "CANCELLED" | "EXPIRED"
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
 * Xử lý gửi Email Vé Điện Tử qua Gmail
 */
function handleSendTicketEmail(payload) {
  var recipient = (payload.to || "").trim();
  var subject = payload.subject || "Vé Điện Tử Sự Kiện";
  var htmlBody = payload.htmlBody || "";

  if (!recipient || recipient.indexOf("@") === -1) {
    return createJsonResponse({ status: "error", message: "Địa chỉ email người nhận không hợp lệ." });
  }

  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    htmlBody: htmlBody,
    name: "Ban Tổ Chức Sự Kiện"
  });

  return createJsonResponse({
    status: "success",
    message: "Đã gửi email vé thành công tới " + recipient,
    remainingQuota: MailApp.getRemainingDailyQuota()
  });
}

function createJsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
