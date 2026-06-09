import admin from 'firebase-admin';

let initialized = false;

function ensureInit(): void {
  if (initialized) return;
  const fcmKey = process.env.FCM_SERVER_KEY;
  if (!fcmKey) {
    console.warn('FCM_SERVER_KEY not set — push notifications disabled');
    return;
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fcmKey)) });
  initialized = true;
}

export async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  ensureInit();
  if (!initialized || !fcmToken) return;

  await admin.messaging().send({
    token: fcmToken,
    notification: { title, body },
    data,
    android: { priority: 'high' },
    apns: { payload: { aps: { sound: 'default' } } },
  });
}

export async function sendHighMatchNotification(
  fcmToken: string,
  score: number,
  jobTitle: string,
  company: string,
  jobId: string
): Promise<void> {
  await sendPushNotification(
    fcmToken,
    `🎯 ${score}% match: ${jobTitle} at ${company}`,
    'Your resume is ready to tailor.',
    { jobId, type: 'high_match' }
  );
}

export async function sendFollowUpNotification(
  fcmToken: string,
  company: string,
  applicationId: string
): Promise<void> {
  await sendPushNotification(
    fcmToken,
    `Time to follow up on your ${company} application!`,
    'Reach out to the hiring team today.',
    { applicationId, type: 'follow_up' }
  );
}
