# Build with the repository root as context.
FROM oven/bun:1.4.2 AS dependencies
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages/discord/package.json ./packages/discord/package.json
COPY services/discord-voice/package.json ./services/discord-voice/package.json
RUN bun install --frozen-lockfile --production --filter '@rally-sync/discord-voice'

FROM oven/bun:1.4.2
WORKDIR /app
COPY --from=dependencies /app /app
COPY packages/discord/src ./packages/discord/src
COPY services/discord-voice/src ./services/discord-voice/src
ENV NODE_ENV=production PORT=3001
USER bun
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD bun -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "run", "--cwd", "services/discord-voice", "start"]
