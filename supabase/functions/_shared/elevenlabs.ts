/**
 * ElevenLabs TTS helper — generates speech audio from text.
 * Returns a URL to the audio file that Twilio can play via <Play>.
 *
 * Usage:
 *   const audioUrl = await generateSpeech("Hello, where are you?", "en");
 *   // Use in TwiML: <Play>${audioUrl}</Play>
 */

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";

// Default voice IDs — can be overridden via business_rules
const DEFAULT_VOICES: Record<string, string> = {
  "en": "21m00Tcm4TlvDq8ikWAM",      // Rachel — professional, warm
  "fr": "ErXwobaYiN019PkySvjV",       // Antoni — clear, professional
  "zh": "21m00Tcm4TlvDq8ikWAM",       // Rachel with Chinese — ElevenLabs multilingual
};

export interface SpeechOptions {
  text: string;
  language?: string;         // "en", "fr", "zh"
  voiceId?: string;          // override default voice
  stability?: number;        // 0-1, default 0.5
  similarityBoost?: number;  // 0-1, default 0.75
}

/**
 * Generate speech audio and return as base64 data URI.
 * Twilio can play this via <Play> when hosted at a URL,
 * or we can use Twilio's <Say> as fallback.
 */
export async function generateSpeechBuffer(
  apiKey: string,
  options: SpeechOptions
): Promise<{ audio: Uint8Array; contentType: string } | null> {
  const voiceId = options.voiceId || DEFAULT_VOICES[options.language || "en"] || DEFAULT_VOICES["en"];

  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text: options.text,
        model_id: "eleven_turbo_v2_5",  // Fast, multilingual
        voice_settings: {
          stability: options.stability ?? 0.5,
          similarity_boost: options.similarityBoost ?? 0.75,
        },
      }),
    });

    if (!response.ok) {
      console.error(`[ELEVENLABS] API error: ${response.status} ${await response.text()}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      audio: new Uint8Array(arrayBuffer),
      contentType: "audio/mpeg",
    };
  } catch (err) {
    console.error(`[ELEVENLABS] Network error:`, err);
    return null;
  }
}

/**
 * Generate speech and store temporarily in Supabase Storage.
 * Returns a public URL that Twilio can <Play>.
 */
export async function generateSpeechUrl(
  apiKey: string,
  supabase: any,
  options: SpeechOptions & { sessionId: string; stepName: string }
): Promise<string | null> {
  const result = await generateSpeechBuffer(apiKey, options);
  if (!result) return null;

  const fileName = `voice-ivr/${options.sessionId}/${options.stepName}.mp3`;

  // Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from("audio")
    .upload(fileName, result.audio, {
      contentType: result.contentType,
      upsert: true,
    });

  if (error) {
    console.error(`[ELEVENLABS] Storage upload failed:`, error);
    return null;
  }

  // Get public URL
  const { data: urlData } = supabase.storage.from("audio").getPublicUrl(fileName);
  return urlData?.publicUrl || null;
}
