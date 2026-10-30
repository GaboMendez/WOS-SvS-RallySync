import type { VoiceLanguage } from "@rally-sync/discord";
import type { VoiceConfig } from "./config";
import { VoiceError } from "./errors";
import OpusScript from "opusscript";

export type SpeechAudio = Buffer[];

// OpusScript instances share one WASM heap. Keep each encoder's lifetime exclusive,
// including the yields used to keep rally scheduling responsive.
let encodingTail: Promise<void> = Promise.resolve();

export interface SpeechProvider {
  get(text: string, language: VoiceLanguage): Promise<SpeechAudio>;
}

export const escapeXml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );

/** Convert Azure mono PCM into Discord's stereo 48 kHz, 20 ms Opus packets. */
export function encodeSpeech(pcm: Buffer): Promise<SpeechAudio> {
  const task = encodingTail
    .then(() => encodeSpeechExclusive(pcm))
    .catch((error: unknown) => {
      if (error instanceof VoiceError) throw error;
      console.error(JSON.stringify({ event: "speech-encoding-failed", stage: "opus" }));
      throw new VoiceError(
        "Could not encode speech audio. Restart the voice service and try again.",
        503,
      );
    });
  encodingTail = task.then(
    () => {},
    () => {},
  );
  return task;
}

async function encodeSpeechExclusive(pcm: Buffer): Promise<SpeechAudio> {
  if (!pcm.length || pcm.length % 2 || pcm.length > 16 * 1024 * 1024) {
    throw new VoiceError("The Speech service returned invalid PCM audio.", 503);
  }
  // Azure can pad even a single word with over a second of near-silent audio.
  // Reserve time for speech, not that padding, while retaining quiet word edges.
  let first = 0;
  let last = pcm.length;
  while (first < last && Math.abs(pcm.readInt16LE(first)) <= 64) first += 2;
  while (last > first && Math.abs(pcm.readInt16LE(last - 2)) <= 64) last -= 2;
  if (first === last) {
    throw new VoiceError("The Speech service returned silent audio. Try again.", 503);
  }
  // 48 kHz mono PCM uses 96 bytes/ms: retain 40 ms before and 80 ms after speech.
  pcm = pcm.subarray(Math.max(0, first - 3840), Math.min(pcm.length, last + 7680));
  const encoder = new OpusScript(48_000, 2, OpusScript.Application.AUDIO);
  encoder.setBitrate(48_000);
  const packets: Buffer[] = [];
  try {
    for (let offset = 0; offset < pcm.length; offset += 1920) {
      const stereo = Buffer.alloc(3840);
      for (let i = 0; i < 960 && offset + i * 2 < pcm.length; i++) {
        const sample = pcm.readInt16LE(offset + i * 2);
        stereo.writeInt16LE(sample, i * 4);
        stereo.writeInt16LE(sample, i * 4 + 2);
      }
      packets.push(encoder.encode(stereo, 960));
      // Yield during long manual messages so existing rallies keep their deadlines.
      if (packets.length % 8 === 0) await Bun.sleep(0);
    }
    return packets;
  } finally {
    encoder.delete();
  }
}

/** Bounded LRU cache and shared synthesis pool; no FFmpeg or native Opus build. */
export class AzureSpeech implements SpeechProvider {
  private readonly cache = new Map<string, SpeechAudio>();
  private readonly pending = new Map<string, Promise<SpeechAudio>>();
  private bytes = 0;
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly config: VoiceConfig) {}

  async get(text: string, language: VoiceLanguage): Promise<SpeechAudio> {
    if (!text.trim() || text.length > 2000) throw new VoiceError("Speech text is too long.");
    const key = `${language}:${text}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= 128)
      throw new VoiceError("Speech preparation is busy. Try again shortly.", 429);
    const task = this.synthesize(text, language)
      .then((buffer) => {
        this.cache.set(key, buffer);
        this.bytes += buffer.reduce((total, packet) => total + packet.length, 0);
        while (this.cache.size > 256 || this.bytes > 32 * 1024 * 1024) {
          const first = this.cache.entries().next().value;
          if (!first) break;
          this.bytes -= first[1].reduce((total, packet) => total + packet.length, 0);
          this.cache.delete(first[0]);
        }
        return buffer;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  private async synthesize(text: string, language: VoiceLanguage): Promise<SpeechAudio> {
    if (this.active >= 3) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      const voice =
        language === "es" ? this.config.AZURE_SPEECH_VOICE_ES : this.config.AZURE_SPEECH_VOICE_EN;
      const locale = language === "es" ? "es-ES" : "en-US";
      for (let attempt = 0; attempt < 3; attempt++) {
        let response: Response;
        try {
          response = await fetch(
            `https://${this.config.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
            {
              method: "POST",
              headers: {
                "Ocp-Apim-Subscription-Key": this.config.AZURE_SPEECH_KEY,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "raw-48khz-16bit-mono-pcm",
                "User-Agent": "WOS-RallySync/3496_BOT",
              },
              body: `<speak version="1.0" xml:lang="${locale}"><voice name="${voice}"><prosody rate="+20%">${escapeXml(text)}</prosody></voice></speak>`,
              signal: AbortSignal.timeout(8000),
            },
          );
        } catch {
          if (attempt === 2)
            throw new VoiceError("Speech synthesis timed out. Check the Speech service.", 503);
          await Bun.sleep(250 * 2 ** attempt);
          continue;
        }
        if (!response.ok) {
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            await response.body?.cancel();
            await Bun.sleep(300 * 2 ** attempt);
            continue;
          }
          await response.body?.cancel();
          throw new VoiceError(
            `Speech synthesis failed (HTTP ${response.status}). Check the Speech service.`,
            503,
          );
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        return await encodeSpeech(buffer);
      }
      throw new VoiceError("Speech synthesis failed.", 503);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
