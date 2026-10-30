# RallySync — Whiteout Survival SFC & SvS Timer

A web-based coordination tool for synchronizing rally attacks in Whiteout Survival's Sunfire Castle (SFC) and Server vs Server (SvS) events.

## Features

- **Multiple Rally Tabs** — Pre-configured tabs for different rally scenarios:
  - Timing (general rallies)
  - Pets 1st Wave
  - Pets 2nd Wave
  - Reference charts for march times by square

- **Team Management** — Create and manage rally teams, assign players, reorder launch order

- **Live Countdown Timer** — Real-time countdown with:
  - Audio alerts at key intervals
  - Haptic/vibration feedback (mobile)
  - Pause and resume support
  - Per-team timer state persistence

- **March Time Calculation** — Automatically calculates optimal launch offsets so all marches land simultaneously

- **Reference Charts** — Visual guides showing march times based on:
  - Pets active status
  - Expedition facility availability

- **Persistent State** — Your teams, roster, and preferences are saved locally

## Getting Started

```sh
# Install dependencies
bun install

# Start development server
bun run dev
```

## Tech Stack

- [TanStack Start](https://tanstack.com/start) — Full-stack React framework
- [React](https://react.dev) 19 — UI library
- [TypeScript](https://www.typescriptlang.org) — Type safety
- [Tailwind CSS](https://tailwindcss.com) 4 — Styling
- [Radix UI](https://www.radix-ui.com) — Accessible component primitives
- [Vite](https://vitejs.dev) — Build tool

## Deployment

### Discord voice — 3496_BOT

The web can control **3496_BOT** (`1519475189128233001`) through a separate persistent Bun service. It supports authorized Discord sign-in, server/channel selection, manual English/Spanish TTS and automatic rally announcements synchronized with the existing timers.

See **[Discord setup, security and deployment](docs/discord-voice.md)** for environment variables, OAuth2 setup, Azure Speech, and the Docker deployment. Start the service with `bun run discord:dev`; keep the web on Vercel. Run checks with `bun run test` and `bun run typecheck`.

This project is configured for Vercel deployment:

```sh
# Build for production
bun run build

# Preview production build
bun run preview
```

## Usage

1. **Select a Tab** — Choose Timing, Pets 1st Wave, or Pets 2nd Wave
2. **Create a Team** — Click "+ New team" and name it
3. **Build Your Roster** — Add players with their march times (or use the pre-loaded data)
4. **Add Players to Team** — Tap players in the roster to add them to your team
5. **Reorder Launch Order** — Use ↑↓ arrows to set the optimal launch sequence
6. **Start the Timer** — Click "Start" to begin the countdown; all marches will land together

## License

MIT
