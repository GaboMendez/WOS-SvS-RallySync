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
npm install

# Start development server
npm run dev
```

## Tech Stack

- [TanStack Start](https://tanstack.com/start) — Full-stack React framework
- [React](https://react.dev) 19 — UI library
- [TypeScript](https://www.typescriptlang.org) — Type safety
- [Tailwind CSS](https://tailwindcss.com) 4 — Styling
- [Radix UI](https://www.radix-ui.com) — Accessible component primitives
- [Vite](https://vitejs.dev) — Build tool

## Deployment

This project is configured for Vercel deployment:

```sh
# Build for production
npm run build

# Preview production build
npm run preview
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
