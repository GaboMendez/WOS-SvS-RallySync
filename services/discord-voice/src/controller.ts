import {
  ChannelType,
  Client,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type VoiceChannel,
} from "discord.js";
import {
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
} from "@discordjs/voice";
import type { VoiceReply, VoiceRequest, VoiceStatus } from "@rally-sync/discord";
import { GuildAudio } from "./audio";
import { GuildRallies } from "./rallies";
import { VoiceError } from "./errors";
import type { SpeechProvider } from "./tts";
import type { VoiceConfig } from "./config";

interface GuildState {
  audio: GuildAudio;
  rallies: GuildRallies;
  connection: VoiceConnection | null;
  error: string | null;
  recovering: boolean;
  generation: number;
  manualTail: Promise<void>;
  pendingSpeech: Set<string>;
  spoken: Map<string, { fingerprint: string; expiresAt: number }>;
}

const BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
];
const USER_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect];

export class VoiceController {
  private readonly states = new Map<string, GuildState>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly members = new Map<string, { member: GuildMember; until: number }>();
  constructor(
    readonly client: Client,
    private readonly config: VoiceConfig,
    private readonly speech: SpeechProvider,
  ) {}

  ready(): boolean {
    return this.client.isReady();
  }

  private state(guildId: string): GuildState {
    let state = this.states.get(guildId);
    if (!state) {
      const audio = new GuildAudio();
      state = {
        audio,
        rallies: new GuildRallies(this.speech, audio),
        connection: null,
        error: null,
        recovering: false,
        generation: 0,
        manualTail: Promise.resolve(),
        pendingSpeech: new Set(),
        spoken: new Map(),
      };
      const current = state;
      audio.onError = (message) => {
        current.error = message;
      };
      this.states.set(guildId, state);
    }
    return state;
  }

  private async member(guild: Guild, actor: string): Promise<GuildMember> {
    const key = `${guild.id}:${actor}`;
    const cached = this.members.get(key);
    if (cached && cached.until > Date.now()) return cached.member;
    try {
      const member = await guild.members.fetch({ user: actor, force: true });
      if (this.members.size >= 2000) this.members.clear();
      this.members.set(key, { member, until: Date.now() + 30_000 });
      return member;
    } catch {
      throw new VoiceError("You must be a member of this Discord server.", 403);
    }
  }

  private guildAllowed(guildId: string): boolean {
    return (
      !this.config.DISCORD_ALLOWED_GUILD_IDS.length ||
      this.config.DISCORD_ALLOWED_GUILD_IDS.includes(guildId)
    );
  }

  private async authorize(
    guildId: string,
    actor: string,
  ): Promise<{ guild: Guild; member: GuildMember }> {
    if (!this.guildAllowed(guildId))
      throw new VoiceError("This Discord server is not authorized.", 403);
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild?.available)
      throw new VoiceError("The bot is not available in this Discord server.", 404);
    return { guild, member: await this.member(guild, actor) };
  }

  private async channel(
    guild: Guild,
    member: GuildMember,
    id: string,
    requireBotPermissions = true,
  ): Promise<VoiceChannel> {
    const channel = await guild.channels.fetch(id, { force: true }).catch(() => null);
    if (
      !channel ||
      channel.type !== ChannelType.GuildVoice ||
      !channel.permissionsFor(member).has(USER_PERMISSIONS)
    ) {
      throw new VoiceError("You do not have access to this voice channel.", 403);
    }
    const me = await guild.members.fetchMe();
    if (requireBotPermissions && !channel.permissionsFor(me).has(BOT_PERMISSIONS)) {
      throw new VoiceError("The bot needs View Channel, Connect and Speak permissions.", 403);
    }
    return channel;
  }

  private status(state: GuildState): VoiceStatus {
    const connection = state.connection?.state.status;
    return {
      gateway: this.ready() ? "ready" : "reconnecting",
      connection:
        connection === VoiceConnectionStatus.Ready
          ? "ready"
          : connection === VoiceConnectionStatus.Disconnected
            ? "reconnecting"
            : connection === VoiceConnectionStatus.Connecting ||
                connection === VoiceConnectionStatus.Signalling
              ? "connecting"
              : state.error
                ? "error"
                : "disconnected",
      channelId: state.connection?.joinConfig.channelId ?? null,
      queueLength: state.audio.queueLength + state.pendingSpeech.size,
      speaking: state.audio.speaking,
      error: state.error,
      rally: state.rallies.snapshot(),
    };
  }

  async control(input: VoiceRequest, actor: string): Promise<VoiceReply> {
    // Defense in depth: do not rely solely on the HTTP verifier or web session.
    if (!this.config.DISCORD_ALLOWED_USER_IDS.includes(actor))
      throw new VoiceError("Access denied.", 403);
    if (input.op === "guilds") {
      if (!this.ready()) throw new VoiceError("Discord Gateway is reconnecting.", 503);
      const guilds: { id: string; name: string }[] = [];
      const candidates = [...this.client.guilds.cache.values()].filter(
        (guild) => this.guildAllowed(guild.id) && guild.available,
      );
      for (let offset = 0; offset < candidates.length; offset += 8) {
        const results = await Promise.allSettled(
          candidates.slice(offset, offset + 8).map(async (guild) => {
            await this.member(guild, actor);
            return { id: guild.id, name: guild.name };
          }),
        );
        for (const result of results) if (result.status === "fulfilled") guilds.push(result.value);
      }
      return { guilds: guilds.sort((a, b) => a.name.localeCompare(b.name)), serverNow: Date.now() };
    }
    const { guild, member } = await this.authorize(input.guildId, actor);
    const state = this.state(guild.id);
    if (input.op === "channels") {
      const channels = await guild.channels.fetch();
      const me = await guild.members.fetchMe();
      return {
        serverNow: Date.now(),
        channels: channels
          .filter(
            (channel) =>
              channel?.type === ChannelType.GuildVoice &&
              channel.permissionsFor(me).has(BOT_PERMISSIONS) &&
              channel.permissionsFor(member).has(USER_PERMISSIONS),
          )
          .map((channel) => ({ id: channel!.id, name: channel!.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    }
    if (input.op === "status") return { serverNow: Date.now(), status: this.status(state) };
    // Serialize writes so connect/disconnect and cancellation cannot race.
    const previous = this.locks.get(guild.id) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        if (!this.ready() && input.op !== "disconnect" && input.op !== "cancel") {
          throw new VoiceError("Discord Gateway is reconnecting. Try again shortly.", 503);
        }
        if (state.connection?.joinConfig.channelId && input.op !== "connect") {
          await this.channel(
            guild,
            member,
            state.connection.joinConfig.channelId,
            !["disconnect", "cancel", "clearQueue"].includes(input.op),
          );
        }
        switch (input.op) {
          case "connect": {
            const channel = await this.channel(guild, member, input.channelId);
            if (
              state.connection?.joinConfig.channelId === channel.id &&
              state.connection.state.status !== VoiceConnectionStatus.Destroyed
            )
              break;
            if (
              state.rallies.snapshot() &&
              !["done", "error"].includes(state.rallies.snapshot()!.phase)
            ) {
              throw new VoiceError("Cancel the active rally before moving the bot.", 409);
            }
            if (
              channel.full &&
              !channel.permissionsFor(guild.members.me!).has(PermissionFlagsBits.MoveMembers)
            ) {
              throw new VoiceError("This voice channel is full.", 409);
            }
            this.disconnect(state);
            state.error = null;
            const connection = joinVoiceChannel({
              guildId: guild.id,
              channelId: channel.id,
              adapterCreator: guild.voiceAdapterCreator,
              selfDeaf: true,
              selfMute: false,
            });
            state.connection = connection;
            connection.subscribe(state.audio.player);
            connection.on("error", () => {
              state.error = "Discord voice encountered a connection error.";
            });
            connection.on("stateChange", (_, current) => {
              if (state.connection !== connection) return;
              state.audio.setOnline(current.status === VoiceConnectionStatus.Ready);
              if (current.status === VoiceConnectionStatus.Ready) state.error = null;
              if (current.status === VoiceConnectionStatus.Disconnected)
                void this.recover(state, connection);
              if (current.status === VoiceConnectionStatus.Destroyed) {
                state.connection = null;
                state.rallies.clear();
              }
            });
            void entersState(connection, VoiceConnectionStatus.Ready, 20_000).catch(() => {
              if (
                state.connection === connection &&
                connection.state.status !== VoiceConnectionStatus.Ready
              ) {
                this.disconnect(state);
                state.error =
                  "Could not join voice. Check channel permissions and outbound UDP on the host.";
              }
            });
            break;
          }
          case "disconnect":
            this.disconnect(state);
            state.error = null;
            break;
          case "clearQueue":
            state.generation++;
            state.pendingSpeech.clear();
            state.manualTail = Promise.resolve();
            state.audio.clear();
            break;
          case "speak": {
            if (!state.audio.available())
              throw new VoiceError("Connect the bot to voice first.", 409);
            for (const [id, item] of state.spoken)
              if (item.expiresAt <= Date.now()) state.spoken.delete(id);
            const fingerprint = JSON.stringify([actor, input.text, input.language]);
            const previousSpeech = state.spoken.get(input.id);
            if (previousSpeech) {
              if (previousSpeech.fingerprint !== fingerprint)
                throw new VoiceError("This message ID is already in use.", 409);
              break;
            }
            if (
              state.pendingSpeech.size + state.audio.queueLength >= 20 ||
              state.spoken.size >= 1000
            ) {
              throw new VoiceError("The audio queue is full. Wait or clear it.", 429);
            }
            state.spoken.set(input.id, { fingerprint, expiresAt: Date.now() + 600_000 });
            const generation = state.generation;
            const deadline = performance.now() + 30_000;
            state.pendingSpeech.add(input.id);
            state.manualTail = state.manualTail
              .then(async () => {
                if (generation !== state.generation || performance.now() > deadline) return;
                const clip = await this.speech.get(input.text, input.language);
                if (generation === state.generation && state.audio.available())
                  state.audio.enqueue(clip, input.text, deadline);
              })
              .catch((error: unknown) => {
                if (generation === state.generation)
                  state.error =
                    error instanceof VoiceError
                      ? error.message
                      : "Could not prepare the voice message.";
              })
              .finally(() => {
                state.pendingSpeech.delete(input.id);
              });
            break;
          }
          case "prepare":
            if (!state.audio.available())
              throw new VoiceError("Connect the bot to voice first.", 409);
            state.rallies.prepare(input.plan, actor);
            break;
          case "start":
            state.rallies.start(input.rallyId, actor);
            break;
          case "pause":
            state.rallies.pause(input.rallyId, actor);
            break;
          case "resume":
            state.rallies.resume(input.rallyId, actor);
            break;
          case "cancel":
            state.rallies.cancel(input.rallyId, actor);
            break;
        }
        console.info(
          JSON.stringify({ event: "voice-control", actor, guildId: guild.id, operation: input.op }),
        );
        return { serverNow: Date.now(), status: this.status(state) };
      });
    this.locks.set(guild.id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(guild.id) === next) this.locks.delete(guild.id);
    }
  }

  private disconnect(state: GuildState) {
    state.generation++;
    state.pendingSpeech.clear();
    state.manualTail = Promise.resolve();
    state.rallies.clear();
    state.audio.setOnline(false);
    state.audio.clear();
    const connection = state.connection;
    state.connection = null;
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed)
      connection.destroy();
  }

  private async recover(state: GuildState, connection: VoiceConnection) {
    if (state.recovering) return;
    state.recovering = true;
    try {
      const disconnected = connection.state;
      if (
        disconnected.status === VoiceConnectionStatus.Disconnected &&
        disconnected.reason === VoiceConnectionDisconnectReason.WebSocketClose &&
        disconnected.closeCode === 4014
      ) {
        // Discord moved/kicked the bot: allow a move handshake, never force-rejoin a kick.
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
        return;
      }
      for (let attempt = 0; attempt < 5 && state.connection === connection; attempt++) {
        await Bun.sleep(Math.min(500 * 2 ** attempt, 8000));
        if (
          state.connection !== connection ||
          connection.state.status === VoiceConnectionStatus.Destroyed
        )
          return;
        if (connection.state.status === VoiceConnectionStatus.Ready) return;
        connection.rejoin();
        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 5000);
          return;
        } catch {
          /* retry */
        }
      }
      throw new Error("Retries exhausted");
    } catch {
      if (state.connection === connection) {
        this.disconnect(state);
        state.error = "Voice disconnected. Reconnect the bot to continue.";
      }
    } finally {
      state.recovering = false;
    }
  }

  tick() {
    for (const state of this.states.values()) state.rallies.tick();
  }
  shutdown() {
    for (const state of this.states.values()) this.disconnect(state);
  }
}
