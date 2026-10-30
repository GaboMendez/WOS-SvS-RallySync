import { expect, test } from "bun:test";
import OpusScript from "opusscript";
import { encodeSpeech } from "./tts";

test("encodes Azure PCM into playable stereo 48 kHz Opus packets with 20 ms frames", async () => {
  const pcm = Buffer.alloc(2500);
  for (let i = 0; i < pcm.length / 2; i++)
    pcm.writeInt16LE(Math.round(Math.sin(i / 20) * 4000), i * 2);
  const packets = await encodeSpeech(pcm);
  expect(packets).toHaveLength(2);
  const decoder = new OpusScript(48_000, 2, OpusScript.Application.AUDIO);
  try {
    for (const packet of packets) {
      const stereo = decoder.decode(packet);
      expect(stereo.length).toBe(3840);
      let nonzero = false;
      for (let i = 0; i < stereo.length; i += 4) {
        expect(stereo.readInt16LE(i)).toBe(stereo.readInt16LE(i + 2));
        if (stereo.readInt16LE(i) !== 0) nonzero = true;
      }
      expect(nonzero).toBe(true);
    }
  } finally {
    decoder.delete();
  }
});

test("rejects empty or misaligned PCM", async () => {
  await expect(encodeSpeech(Buffer.alloc(0))).rejects.toThrow("invalid PCM");
  await expect(encodeSpeech(Buffer.alloc(3))).rejects.toThrow("invalid PCM");
});
