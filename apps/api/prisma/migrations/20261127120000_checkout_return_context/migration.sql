-- Return context (code review P3): the host page, success and cancel URLs the
-- checkout page sends with an attempt are kept on the checkout session, so
-- the return URL given to a gateway carries only the Payment id, the
-- Publishable Key, the host origin and the language (short and bounded).

ALTER TABLE "chk_checkout_sessions" ADD COLUMN     "return_cancel_url" TEXT,
ADD COLUMN     "return_host_page_url" TEXT,
ADD COLUMN     "return_success_url" TEXT;
