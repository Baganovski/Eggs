import {
  MAX_PLAYERS,
  STARTING_HP,
  cartonFitsPlayerCount,
  isCartonType,
  DEFAULT_CARTON_TYPE,
  type GameState,
  type Player,
  type PlayerAction,
} from '../types/game';
import {
  emptyArenaFields,
  resetArenaPlayers,
  startArenaMatch,
} from './arenaLogic';

export function createInitialPlayer(
  id: string,
  name: string,
  joinOrder: number,
): Player {
  return {
    id,
    name,
    connected: true,
    isBot: false,
    joinOrder,
    planSubmitted: false,
    hp: STARTING_HP,
    row: 0,
    col: 0,
    hand: [],
    spareWeapon: null,
  };
}

export function createHostLobbyState(
  roomCode: string,
  playerId: string,
  playerName: string,
): GameState {
  return {
    roomCode,
    phase: 'lobby',
    cartonType: DEFAULT_CARTON_TYPE,
    ...emptyArenaFields(),
    players: [createInitialPlayer(playerId, playerName, 0)],
    hostPlayerId: playerId,
    localPlayerId: playerId,
  };
}

export function createJoinerLobbyState(roomCode: string, playerId: string): GameState {
  return {
    roomCode,
    phase: 'lobby',
    cartonType: DEFAULT_CARTON_TYPE,
    ...emptyArenaFields(),
    players: [],
    hostPlayerId: '',
    localPlayerId: playerId,
  };
}

export function electHost(players: Player[]): string | null {
  const connected = [...players]
    .filter((player) => player.connected && !player.isBot)
    .sort((a, b) => a.joinOrder - b.joinOrder);

  return connected[0]?.id ?? null;
}

export function nextJoinOrder(players: Player[]): number {
  const used = new Set(players.map((player) => player.joinOrder));
  for (let seat = 0; seat < MAX_PLAYERS; seat += 1) {
    if (!used.has(seat)) return seat;
  }
  return players.length;
}

export function createBotPlayer(joinOrder: number, existingNames: string[]): Player {
  const taken = new Set(existingNames.map((name) => name.toLowerCase()));
  let index = 1;
  let name = `Bot ${index}`;
  while (taken.has(name.toLowerCase())) {
    index += 1;
    name = `Bot ${index}`;
  }
  return {
    id: `bot-${crypto.randomUUID()}`,
    name,
    connected: true,
    isBot: true,
    joinOrder,
    planSubmitted: false,
    hp: STARTING_HP,
    row: 0,
    col: 0,
    hand: [],
    spareWeapon: null,
  };
}

export function resetPlayersForGameStart(players: Player[]): Player[] {
  return resetArenaPlayers(players);
}

export function markDisconnected(player: Player): Player {
  return { ...player, connected: false };
}

export function startMatch(state: GameState): GameState {
  return startArenaMatch(state);
}

export function applyPlayerAction(
  state: GameState,
  playerId: string,
  action: PlayerAction,
): GameState {
  switch (action.type) {
    case 'setCartonType': {
      if (state.phase !== 'lobby' || playerId !== state.hostPlayerId) return state;
      if (!isCartonType(action.cartonType)) return state;
      if (action.cartonType === state.cartonType) return state;
      const occupantCount = state.players.length;
      if (!cartonFitsPlayerCount(action.cartonType, occupantCount)) return state;
      return { ...state, cartonType: action.cartonType };
    }
    case 'endMatch': {
      if (state.phase !== 'playing' || playerId !== state.hostPlayerId) return state;
      return { ...state, phase: 'finished', turnPhase: 'resolving' };
    }
    case 'returnToLobby': {
      if (state.phase !== 'finished' || playerId !== state.hostPlayerId) return state;
      return {
        ...state,
        phase: 'lobby',
        ...emptyArenaFields(),
        players: resetArenaPlayers(state.players),
      };
    }
    default:
      return state;
  }
}
