import { Client, Events, GatewayIntentBits } from "discord.js";
import { generateDependencyReport } from "@discordjs/voice";
import { readConfig } from "./config";
import { VoiceController } from "./controller";
import { createControlHandler } from "./http";
import { AzureSpeech } from "./tts";

const config = readConfig(process.env);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  rest: { timeout: 8000, retries: 1 },
});
const controller = new VoiceController(client, config, new AzureSpeech(config));
client.once(Events.ClientReady, (ready) => {
  if (ready.user.id !== config.DISCORD_CLIENT_ID) {
    console.error("The bot token does not belong to the configured DISCORD_CLIENT_ID.");
    client.destroy();
    process.exit(1);
  }
  console.info(`3496_BOT ready (${ready.user.id}).`);
});
client.on(Events.Error, () =>
  console.error("Discord Gateway error; automatic reconnection is active."),
);
client.on(Events.ShardReconnecting, () => console.warn("Discord Gateway reconnecting."));
client.on(Events.ShardResume, () => console.info("Discord Gateway resumed."));

console.info(generateDependencyReport());
const server = Bun.serve({
  hostname: "0.0.0.0",
  port: config.PORT,
  maxRequestBodySize: 16_384,
  fetch: createControlHandler(
    controller,
    config.VOICE_SHARED_SECRET,
    new Set(config.DISCORD_ALLOWED_USER_IDS),
  ),
});
const ticker = setInterval(() => controller.tick(), 20);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(ticker);
  controller.shutdown();
  await client.destroy();
  await server.stop(true);
}
process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
client.login(config.DISCORD_BOT_TOKEN).catch(() => {
  console.error("Discord login failed. Check DISCORD_BOT_TOKEN and connectivity.");
  void shutdown().then(() => {
    process.exitCode = 1;
  });
});
