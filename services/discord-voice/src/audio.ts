import { Readable } from "node:stream";
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  createAudioPlayer,
  createAudioResource,
  type AudioPlayer,
} from "@discordjs/voice";
import { VoiceError } from "./errors";
import type { SpeechAudio } from "./tts";

interface Clip {
  audio: SpeechAudio;
  text: string;
  deadline: number | null;
  kind: "manual" | "instruction";
  rallyId: string | null;
}
export interface RallyAudio {
  announce(audio: SpeechAudio, text: string, rallyId: string): void;
  stopRally(rallyId: string): void;
  available(): boolean;
}

export class GuildAudio implements RallyAudio {
  readonly player: AudioPlayer = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Stop },
  });
  private readonly queue: Clip[] = [];
  private current: Clip | null = null;
  private online = false;
  onError: (message: string) => void = () => {};

  constructor() {
    this.player.on(AudioPlayerStatus.Idle, () => {
      this.current = null;
      this.pump();
    });
    this.player.on("error", () => {
      this.current = null;
      this.onError("Discord could not play an audio clip.");
      this.pump();
    });
  }

  get speaking(): string | null {
    return this.current?.text ?? null;
  }
  get queueLength(): number {
    return this.queue.length;
  }
  available(): boolean {
    return this.online;
  }
  setOnline(value: boolean) {
    this.online = value;
    if (value) this.pump();
    else {
      // Resume an interrupted instruction from its beginning after reconnection.
      if (this.current?.kind === "instruction") this.queue.unshift(this.current);
      this.current = null;
      this.player.stop(true);
    }
  }
  enqueue(audio: SpeechAudio, text: string, deadline = performance.now() + 30_000) {
    if (!this.online) throw new VoiceError("Connect the bot to a voice channel first.", 409);
    if (this.queue.length >= 20) throw new VoiceError("The audio queue is full.", 429);
    if (performance.now() > deadline) return;
    this.queue.push({
      audio,
      text,
      deadline,
      kind: "manual",
      rallyId: null,
    });
    this.pump();
  }

  announce(audio: SpeechAudio, text: string, rallyId: string) {
    // Complete countdowns keep their arrival order and never expire.
    this.queue.push({
      audio,
      text,
      deadline: null,
      kind: "instruction",
      rallyId,
    });
    this.pump();
  }

  stopRally(rallyId: string) {
    for (let index = this.queue.length - 1; index >= 0; index--) {
      if (this.queue[index]!.rallyId === rallyId) this.queue.splice(index, 1);
    }
    if (this.current?.rallyId === rallyId) {
      this.current = null;
      this.player.stop(true);
    }
    this.pump();
  }
  clear() {
    this.queue.length = 0;
    this.current = null;
    this.player.stop(true);
  }

  private pump() {
    if (this.current || !this.online) return;
    while (this.queue.length) {
      const clip = this.queue.shift()!;
      if (clip.deadline !== null && clip.deadline < performance.now()) continue;
      this.play(clip);
      return;
    }
  }
  private play(clip: Clip) {
    this.current = clip;
    const resource = createAudioResource(Readable.from(clip.audio), {
      inputType: StreamType.Opus,
      silencePaddingFrames: 0,
    });
    this.player.play(resource);
  }
}
