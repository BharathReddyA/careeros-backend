import twilio from 'twilio';

let client: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!client) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set');
    client = twilio(sid, token);
  }
  return client;
}

function getVerifyService() {
  const sid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid) throw new Error('TWILIO_VERIFY_SERVICE_SID not set');
  return getClient().verify.v2.services(sid);
}

export async function sendOtp(phone: string): Promise<void> {
  await getVerifyService().verifications.create({ to: phone, channel: 'sms' });
}

export async function checkOtp(phone: string, code: string): Promise<boolean> {
  const check = await getVerifyService().verificationChecks.create({ to: phone, code });
  return check.status === 'approved';
}
