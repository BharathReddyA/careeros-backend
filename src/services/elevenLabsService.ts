import axios from 'axios';
import FormData from 'form-data';

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // "Rachel" - professional default voice
const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY not set');
  return key;
}

function getVoiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
}

export async function textToSpeech(text: string, voiceId?: string): Promise<Buffer> {
  const response = await axios.post(
    `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId ?? getVoiceId()}`,
    {
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    },
    {
      headers: {
        'xi-api-key': getApiKey(),
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      responseType: 'arraybuffer',
    }
  );

  return Buffer.from(response.data);
}

export async function speechToText(audioBuffer: Buffer, filename: string, mimeType: string): Promise<string> {
  const form = new FormData();
  form.append('file', audioBuffer, { filename, contentType: mimeType });
  form.append('model_id', 'scribe_v1');

  const response = await axios.post(`${ELEVENLABS_BASE_URL}/speech-to-text`, form, {
    headers: {
      'xi-api-key': getApiKey(),
      ...form.getHeaders(),
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  return (response.data.text ?? '').trim();
}
