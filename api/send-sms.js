export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, invoiceNumber, amount, link } = req.body;
  if (!to) return res.status(400).json({ error: 'Phone number required' });

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_PHONE;

  const digits = to.replace(/\D/g, '');
  const toFormatted = digits.length === 10 ? `+1${digits}` : `+${digits}`;

  const body = `Fine Touch Decor & Design\nInvoice ${invoiceNumber} — ${amount}\nView & pay: ${link}`;

  const params = new URLSearchParams({ From: from, To: toFormatted, Body: body });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    }
  );

  const data = await response.json();
  if (!response.ok) return res.status(400).json({ error: data.message || 'Twilio error' });
  return res.status(200).json({ sid: data.sid });
}
