const crypto = require("crypto");


const processedEventIds = new Set();

function isValidSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signatureHeader);
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

app.post(
  "/webhooks/payment",
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
  async (req, res) => {
    const signature = req.headers["x-payment-signature"];

    if (!isValidSignature(req.rawBody, signature, process.env.PAYMENT_WEBHOOK_SECRET)) {
      return res.status(401).send("invalid signature");
    }

    const event = req.body;

    if (event.id && processedEventIds.has(event.id)) {
      return res.status(200).send("ok");
    }

    if (event.type !== "payment.succeeded") {
      return res.status(200).send("ok");
    }

  
    try {
      const result = await db.query(
        "UPDATE bookings SET status = $1 WHERE id = $2 RETURNING id",
        ["paid", event.booking_id]
      );

      if (result.rowCount === 0) {
        console.error(
          `Webhook payment.succeeded: booking ${event.booking_id} introuvable`
        );
      }
    } catch (err) {
      console.error("Erreur mise à jour booking:", err.message);
      return res.status(500).send("error");
    }

    if (event.id) {
      processedEventIds.add(event.id);
    }

    res.status(200).send("ok");

   
    sendEmail(event.customer_email, "Paiement confirmé", buildReceipt(event)).catch(
      (err) => console.error("Erreur envoi email de confirmation:", err.message)
    );

    crm.notifyPayment(event).catch((err) =>
      console.error("Erreur notification CRM:", err.message)
    );
  }
);