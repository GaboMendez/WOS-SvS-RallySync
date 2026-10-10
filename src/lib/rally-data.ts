export type TabId = "timing" | "pets1" | "pets2" | "references";
export interface Player { id: string; name: string; march: number; tag: string }
export interface Team { id: string; name: string; playerIds: string[] }
export type TimerPhase = "idle" | "ready" | "running" | "paused" | "done";
export interface TimerState { phase: TimerPhase; elapsed: number; startTime: number }
export interface TabState { players: Player[]; teams: Team[]; selectedTeamId: string | null; timerStates: Record<string, TimerState> }
export type AppState = Record<TabId, TabState>;

export const TABS: { id: TabId; label: string }[] = [
  { id: "timing", label: "Timing" },
  { id: "pets1", label: "Pets 1st Wave" },
  { id: "pets2", label: "Pets 2nd Wave" },
  { id: "references", label: "References" },
];

const raw: Record<TabId, string> = {
  timing: "Beast 40 ABS|Candie 36 WSE|Lumpia 36 GOS|Zaddy 36 GOS|Tily 43 ABS|Panzer 43 ABS|Lord22 39 GOS|Mono 39 WSE|Croissant 48 ABS|Queenie 48 ABS|Blaze 48 WSE|Allen 43 WSE|Bagels 43 WSE",
  pets1: "Beast 40 ABS|Zaddy 36 GOS|Candie 30 WSE|Lumpia 30 GOS|Panzer 43 ABS|Lord22 39 GOS|Mono 39 WSE|Tily 35 ABS|Allen 43 WSE|Blaze 40 WSE|Croissant 39 ABS|Queenie 39 ABS|Bagels 36 WSE",
  pets2: "Candie 36 WSE|Lumpia 36 GOS|Beast 33 ABS|Zaddy 30 GOS|Tily 43 ABS|Panzer 35 ABS|Lord22 32 GOS|Mono 32 WSE|Croissant 48 ABS|Queenie 48 ABS|Blaze 48 WSE|Bagels 43 WSE|Allen 36 WSE",
  references: "",
};

export const uid = () => Math.random().toString(36).slice(2, 10);

export function initialState(): AppState {
  const out = {} as AppState;
  (Object.keys(raw) as TabId[]).forEach((t) => {
    out[t] = {
      players: raw[t].split("|").map((s, i) => {
        const [name, m, tag] = s.split(" ");
        return { id: `${t}-${i}`, name: name ?? "", march: Number(m), tag: tag ?? "" };
      }),
      teams: [],
      selectedTeamId: null,
      timerStates: {},
    };
  });
  return out;
}

export interface ScheduleRow { player: Player; offset: number; order: number; first: boolean }

export function computeSchedule(players: Player[]): { rows: ScheduleRow[]; longest: number } {
  if (!players.length) return { rows: [], longest: 0 };
  const longest = Math.max(...players.map((p) => p.march));
  const sorted = players
    .map((p, idx) => ({ p, idx, offset: longest - p.march }))
    .sort((a, b) => a.offset - b.offset || a.idx - b.idx);
  const offsets = [...new Set(sorted.map((s) => s.offset))];
  return {
    longest,
    rows: sorted.map((s) => ({
      player: s.p,
      offset: s.offset,
      order: offsets.indexOf(s.offset) + 1,
      first: s.offset === 0,
    })),
  };
}
