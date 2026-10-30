import { getCiphers } from "node:crypto";
import { generateDependencyReport } from "@discordjs/voice";
import { encodeSpeech } from "./tts";

console.info(generateDependencyReport());
if (!getCiphers().includes("aes-256-gcm"))
  throw new Error("AES-256-GCM is unavailable in this runtime.");
const frames = await encodeSpeech(Buffer.alloc(1920));
if (frames.length !== 1) throw new Error("The Opus encoder is not available.");
console.info(
  "Bun crypto and stereo 48 kHz Opus are available. Configure credentials before connecting Discord.",
);
