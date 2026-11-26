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
