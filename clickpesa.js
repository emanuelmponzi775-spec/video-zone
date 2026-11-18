// clickpesa.js - CODE MPYA badala ya Selcom
// Tunatumia ClickPesa Payment Page uliyotengeneza (1,500 TZS)

function createClickPesaOrder(phone, amount) {
  // Hakikisha namba inaanza na 255
  let cleanPhone = (phone || '').replace(/\s+/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '255' + cleanPhone.substring(1);
  }

  const orderId = "VZ-" + Date.now();

  // Hii ndiyo link yako ya ClickPesa Payment Page
  // Utaweka kwenye .env baadaye
  const paymentLink = process.env.CLICKPESA_PAYMENT_LINK || "https://merchant.clickpesa.com/payment-page/PYPLPL7170";

  console.log("ClickPesa Order:", orderId, cleanPhone);

  return {
    order_id: orderId,
    phone: cleanPhone,
    amount: amount || 1500,
    currency: "TZS",
    payment_link: paymentLink,
    checkout_url: paymentLink
  };
}

module.exports = { createClickPesaOrder };