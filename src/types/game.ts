export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const STARTING_HP = 3;
export const MAX_WALK_STEPS = 3;
export const PLAN_TIME_MS = 30_000;
export const PLAN_DEADLINE_GRACE_MS = 750;

export const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const CARDINAL_DIRS = ['N', 'E', 'S', 'W'] as const;
export type CardinalDir = (typeof CARDINAL_DIRS)[number];

export const DIR_DELTA: Record<Direction, { dr: number; dc: number }> = {
  N: { dr: -1, dc: 0 },
  NE: { dr: -1, dc: 1 },
  E: { dr: 0, dc: 1 },
  SE: { dr: 1, dc: 1 },
  S: { dr: 1, dc: 0 },
  SW: { dr: 1, dc: -1 },
  W: { dr: 0, dc: -1 },
  NW: { dr: -1, dc: -1 },
};

export const WEAPON_KINDS = ['pistol', 'rifle', 'shotgun', 'bomb', 'slap', 'flamethrower'] as const;
export type WeaponKind = (typeof WEAPON_KINDS)[number];
export const PICKUP_WEAPON_KINDS = ['rifle', 'shotgun', 'bomb', 'slap', 'flamethrower'] as const;
export type PickupWeaponKind = (typeof PICKUP_WEAPON_KINDS)[number];

export type PlanCard =
  | { id: string; kind: 'move' }
  | { id: string; kind: WeaponKind };

export const PLAYER_HUES = ['#f6c7d4', '#c5e4ea', '#d4ead0', '#f6e7b4'] as const;

export type GamePhase = 'lobby' | 'playing' | 'finished';
export type TurnPhase = 'planning' | 'resolving';

export interface Cell {
  row: number;
  col: number;
}

export const CARTON_TYPES = ['halfDozen', 'full'] as const;
export type CartonType = (typeof CARTON_TYPES)[number];
export const DEFAULT_CARTON_TYPE: CartonType = 'full';

export interface CartonSpec {
  type: CartonType;
  rows: number;
  cols: number;
  minPlayers: number;
  maxPlayers: number;
  maxPresents: number;
  obstacleCount: number;
  starts: Cell[];
}

export const CARTON_SPECS: Record<CartonType, CartonSpec> = {
  halfDozen: {
    type: 'halfDozen',
    rows: 2,
    cols: 3,
    minPlayers: 2,
    maxPlayers: 2,
    maxPresents: 0,
    obstacleCount: 0,
    starts: [
      { row: 0, col: 0 },
      { row: 1, col: 2 },
    ],
  },
  full: {
    type: 'full',
    rows: 7,
    cols: 7,
    minPlayers: 2,
    maxPlayers: 4,
    maxPresents: 2,
    obstacleCount: 3,
    starts: [
      { row: 0, col: 0 },
      { row: 6, col: 6 },
      { row: 6, col: 0 },
      { row: 0, col: 6 },
    ],
  },
};

export function isCartonType(value: unknown): value is CartonType {
  return typeof value === 'string' && (CARTON_TYPES as readonly string[]).includes(value);
}

export function cartonSpec(type: CartonType | null | undefined): CartonSpec {
  return CARTON_SPECS[isCartonType(type) ? type : DEFAULT_CARTON_TYPE];
}

export function cartonFitsPlayerCount(type: CartonType, count: number): boolean {
  const spec = cartonSpec(type);
  return count >= spec.minPlayers && count <= spec.maxPlayers;
}

export function cartonNeedsLabel(type: CartonType): string {
  const spec = cartonSpec(type);
  if (spec.minPlayers === spec.maxPlayers) return `Needs ${spec.minPlayers} players`;
  return `Needs ${spec.minPlayers}–${spec.maxPlayers} players`;
}

export type ArenaAction =
  | { type: 'stay' }
  | { type: 'shoot'; weapon: WeaponKind; dir: Direction; steps?: number }
  | { type: 'walk'; path: Cell[]; delay?: number };

export type MatchOutcome =
  | { kind: 'none' }
  | { kind: 'winner'; playerId: string }
  | { kind: 'draw' };

export type PlaybackEvent =
  | { type: 'actionStart'; actionIndex: number }
  | { type: 'beat'; actionIndex: number; beat: number }
  | {
      type: 'shot';
      shooterId: string;
      weapon: WeaponKind;
      dir: Direction;
      from: Cell;
      end: Cell;
      fan?: Cell[];
      splash?: Cell[];
      hitPlayerId?: string;
    }
  | { type: 'hit'; playerId: string; hpAfter: number }
  | { type: 'death'; playerId: string }
  | { type: 'move'; playerId: string; from: Cell; to: Cell }
  | { type: 'eggStain'; cell: Cell }
  | { type: 'blocked'; playerId: string; from: Cell; attempted: Cell }
  | { type: 'pickup'; playerId: string; cell: Cell; weapon: WeaponKind }
  | { type: 'shrinkWarn'; cells: Cell[] }
  | { type: 'shrinkDestroy'; cells: Cell[] };

export interface RoundStartToken {
  id: string;
  row: number;
  col: number;
  hp: number;
}

export interface LastReplay {
  round: number;
  timeline: PlaybackEvent[];
  roundStart: RoundStartToken[];
  startEggStains: Cell[];
  startPresents: Cell[];
  startShrinkIndex: number;
}

export interface Player {
  id: string;
  name: string;
  connected: boolean;
  isBot: boolean;
  joinOrder: number;
  planSubmitted: boolean;
  hp: number;
  row: number;
  col: number;
  hand: PlanCard[];
  spareWeapon: WeaponKind | null;
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  turnPhase: TurnPhase;
  round: number;
  cartonType: CartonType;
  outcome: MatchOutcome;
  timeline: PlaybackEvent[];
  roundStart: RoundStartToken[] | null;
  lastReplay: LastReplay | null;
  mapObjects: Cell[];
  eggStains: Cell[];
  presents: Cell[];
  shrinkIndex: number;
  startedPlayerCount: number;
  players: Player[];
  hostPlayerId: string;
  localPlayerId: string;
  planDeadlineAt: number | null;
}

export type PublicGameState = Omit<GameState, 'localPlayerId'>;

export type PlayerAction =
  | { type: 'submitPlan'; cardIds: [string, string]; actions: [ArenaAction, ArenaAction] }
  | { type: 'setCartonType'; cartonType: CartonType }
  | { type: 'endMatch' }
  | { type: 'returnToLobby' };

export type RoomMessage =
  | { type: 'join'; name: string; playerId: string }
  | { type: 'joinAck'; playerId: string; state: PublicGameState }
  | { type: 'lobbyUpdate'; players: Player[]; cartonType: CartonType }
  | { type: 'start' }
  | { type: 'stateSync'; state: PublicGameState }
  | { type: 'playerAction'; action: PlayerAction }
  | { type: 'playerLeft'; playerId: string; players: Player[] }
  | { type: 'requestState'; playerId: string }
  | { type: 'planRejected'; message: string }
  | { type: 'kicked'; message: string }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string };

export interface RoomCallbacks {
  onStateChange: (state: GameState) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onPlanRejected: () => void;
  onKicked: (message: string) => void;
}
