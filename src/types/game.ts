export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const BOARD_SIZE = 7;
export const STARTING_HP = 3;
export const MAX_WALK_STEPS = 3;

export const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Direction = (typeof DIRECTIONS)[number];

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

export const PLAYER_HUES = ['#e23b3b', '#3b6cf0', '#3cbf4a', '#ffe14a'] as const;

export type GamePhase = 'lobby' | 'playing' | 'finished';
export type TurnPhase = 'planning' | 'resolving';

export interface Cell {
  row: number;
  col: number;
}

export type ArenaAction =
  | { type: 'stay' }
  | { type: 'shoot'; dir: Direction }
  | { type: 'walk'; path: Cell[] };

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
      dir: Direction;
      from: Cell;
      end: Cell;
      hitPlayerId?: string;
    }
  | { type: 'hit'; playerId: string; hpAfter: number }
  | { type: 'death'; playerId: string }
  | { type: 'move'; playerId: string; from: Cell; to: Cell }
  | { type: 'blocked'; playerId: string; from: Cell; attempted: Cell };

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
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  turnPhase: TurnPhase;
  round: number;
  outcome: MatchOutcome;
  timeline: PlaybackEvent[];
  roundStart: RoundStartToken[] | null;
  lastReplay: LastReplay | null;
  mapObjects: Cell[];
  players: Player[];
  hostPlayerId: string;
  localPlayerId: string;
}

export type PublicGameState = Omit<GameState, 'localPlayerId'>;

export type PlayerAction =
  | { type: 'submitPlan'; actions: [ArenaAction, ArenaAction] }
  | { type: 'endMatch' }
  | { type: 'returnToLobby' };

export type RoomMessage =
  | { type: 'join'; name: string; playerId: string }
  | { type: 'joinAck'; playerId: string; state: PublicGameState }
  | { type: 'lobbyUpdate'; players: Player[] }
  | { type: 'start'; startedBy: string }
  | { type: 'stateSync'; state: PublicGameState }
  | { type: 'playerAction'; playerId: string; action: PlayerAction }
  | { type: 'playerLeft'; playerId: string; players: Player[] }
  | { type: 'hostHandoff'; newHostPlayerId: string; state: PublicGameState }
  | { type: 'requestState'; playerId: string }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string };

export interface RoomCallbacks {
  onStateChange: (state: GameState) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}
