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
  priority: number;
  rallyId: string | null;
}
export interface RallyAudio {
  announce(
    audio: SpeechAudio,
    text: string,
    rallyId: string,
    priority: number,
    deadline: number,
  ): void;
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
  private switching = false;
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
      this.queue.length = 0;
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
      priority: -1,
      rallyId: null,
    });
    this.pump();
  }

  announce(audio: SpeechAudio, text: string, rallyId: string, priority: number, deadline: number) {
    if (!this.online || performance.now() > deadline) return;
    if (this.current?.rallyId && this.current.priority > priority) return;
    // Deadline announcements preempt manual speech and old clips rather than drift.
    this.switching = true;
    try {
      this.current = null;
      this.player.stop(true);
      this.play({ audio, text, deadline, priority, rallyId });
    } finally {
      this.switching = false;
    }
  }

  stopRally(rallyId: string) {
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
    if (this.current || !this.online || this.switching) return;
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
