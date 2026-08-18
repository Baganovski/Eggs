export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export type GamePhase = 'lobby' | 'playing' | 'finished';

export interface Player {
  id: string;
  name: string;
  connected: boolean;
  joinOrder: number;
  ready: boolean;
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  players: Player[];
  hostPlayerId: string;
  localPlayerId: string;
}

export type PublicGameState = Omit<GameState, 'localPlayerId'>;

export type PlayerAction =
  | { type: 'toggleReady' }
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
