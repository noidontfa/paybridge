// Everything the Customer reads, in the Pricing Table's language.

export type Language = 'vi' | 'en';

const STRINGS = {
  en: {
    unavailable: 'Payment is not available right now',
    recommended: 'Recommended',
    included: 'Included',
    notIncluded: 'Not included',
    close: 'Close',
    loading: 'Loading…',
    chooseMethod: 'Choose how to pay',
    otherMethod: 'Choose another way to pay',
    scanQr: 'Scan this QR code with your banking app',
    waiting: 'Waiting for your payment…',
    continueToGateway: 'Continue to the payment page',
    methodNotSupported: 'This payment method is not available here yet',
    attemptFailed: 'This payment method did not work. Please choose another.',
    succeeded: 'Payment successful',
    succeededBody: 'Thank you! Your payment has been received.',
    expired: 'Payment expired',
    expiredBody: 'The time to pay has run out. Start again to buy.',
    cancelled: 'Payment cancelled',
    cancelledBody: 'This payment was cancelled.',
    tryAgainLater: 'Something went wrong. Please try again.',
    done: 'Done',
    emailPrompt: 'Enter your email so we know who bought.',
    emailLabel: 'Your email',
    emailInvalid: 'Please enter a valid email',
    continue: 'Continue',
    payNow: 'Pay',
    processing: 'Processing your payment…',
    // The return page, after a redirect gateway (ticket 10).
    redirectingToGateway: 'Taking you to the payment page…',
    notCompleted: 'Payment not completed',
    notCompletedBody: 'The payment was not completed. You have not been charged.',
    returnProcessing: 'Your payment is being processed',
    processingBody: 'This can take a moment. Please keep this page open.',
    processingTooLong: 'We have not received the result yet. You will be notified once the payment is confirmed.',
    forwarding: 'Taking you back…',
    backToShop: 'Back to the shop',
  },
  vi: {
    unavailable: 'Hiện chưa thể thanh toán',
    recommended: 'Khuyên dùng',
    included: 'Có',
    notIncluded: 'Không có',
    close: 'Đóng',
    loading: 'Đang tải…',
    chooseMethod: 'Chọn cách thanh toán',
    otherMethod: 'Chọn cách thanh toán khác',
    scanQr: 'Quét mã QR bằng ứng dụng ngân hàng của bạn',
    waiting: 'Đang chờ thanh toán…',
    continueToGateway: 'Tiếp tục đến trang thanh toán',
    methodNotSupported: 'Cách thanh toán này chưa được hỗ trợ ở đây',
    attemptFailed: 'Cách thanh toán này không thành công. Vui lòng chọn cách khác.',
    succeeded: 'Thanh toán thành công',
    succeededBody: 'Cảm ơn bạn! Chúng tôi đã nhận được thanh toán.',
    expired: 'Thanh toán đã hết hạn',
    expiredBody: 'Đã hết thời gian thanh toán. Vui lòng bắt đầu lại.',
    cancelled: 'Thanh toán đã bị huỷ',
    cancelledBody: 'Khoản thanh toán này đã bị huỷ.',
    tryAgainLater: 'Đã có lỗi xảy ra. Vui lòng thử lại.',
    done: 'Xong',
    emailPrompt: 'Nhập email để chúng tôi biết ai đã mua.',
    emailLabel: 'Email của bạn',
    emailInvalid: 'Vui lòng nhập một email hợp lệ',
    continue: 'Tiếp tục',
    payNow: 'Thanh toán',
    processing: 'Đang xử lý thanh toán…',
    // The return page, after a redirect gateway (ticket 10).
    redirectingToGateway: 'Đang chuyển đến trang thanh toán…',
    notCompleted: 'Thanh toán chưa hoàn tất',
    notCompletedBody: 'Thanh toán chưa được hoàn tất. Bạn chưa bị trừ tiền.',
    returnProcessing: 'Thanh toán đang được xử lý',
    processingBody: 'Việc này có thể mất một chút thời gian. Vui lòng không đóng trang.',
    processingTooLong: 'Chúng tôi chưa nhận được kết quả. Bạn sẽ được thông báo khi thanh toán được xác nhận.',
    forwarding: 'Đang quay lại…',
    backToShop: 'Quay lại cửa hàng',
  },
} as const satisfies Record<Language, Record<string, string>>;

export type Strings = Readonly<Record<keyof (typeof STRINGS)['en'], string>>;

export function strings(language: Language): Strings {
  return STRINGS[language];
}

/** A language tag such as `vi-VN` or `en`, or anything else (English). */
export function languageOf(tag: string | null | undefined): Language {
  return tag?.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

/** An Amount (decimal string, major unit) in the language's format. */
export function formatAmount(amount: string, currency: string, language: Language): string {
  return new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

/** How a PaymentGateway is named to the Customer. */
const GATEWAY_NAMES: Record<string, string> = {
  fake: 'Fake gateway',
  'fake-qr': 'Fake QR',
  stripe: 'Card (Stripe)',
  vnpay: 'VNPay',
  zalopay: 'ZaloPay',
  momo: 'MoMo',
};

export function gatewayName(gatewayId: string): string {
  return GATEWAY_NAMES[gatewayId] ?? gatewayId;
}
