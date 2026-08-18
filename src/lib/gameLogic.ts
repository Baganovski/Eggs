import type { GameState, Player, PlayerAction } from '../types/game';

export function createInitialPlayer(
  id: string,
  name: string,
  joinOrder: number,
): Player {
  return {
    id,
    name,
    connected: true,
    joinOrder,
    ready: false,
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
    players: [createInitialPlayer(playerId, playerName, 0)],
    hostPlayerId: playerId,
    localPlayerId: playerId,
  };
}

export function createJoinerLobbyState(roomCode: string, playerId: string): GameState {
  return {
    roomCode,
    phase: 'lobby',
    players: [],
    hostPlayerId: '',
    localPlayerId: playerId,
  };
}

export function electHost(players: Player[]): string | null {
  const connected = [...players]
    .filter((player) => player.connected)
    .sort((a, b) => a.joinOrder - b.joinOrder);

  return connected[0]?.id ?? null;
}

export function resetPlayersForGameStart(players: Player[]): Player[] {
  return players.map((player) => ({
    ...player,
    ready: false,
  }));
}

export function markDisconnected(player: Player): Player {
  return { ...player, connected: false, ready: false };
}

export function startMatch(state: GameState): GameState {
  return {
    ...state,
    phase: 'playing',
    players: resetPlayersForGameStart(state.players),
  };
}

export function applyPlayerAction(
  state: GameState,
  playerId: string,
  action: PlayerAction,
): GameState {
  switch (action.type) {
    case 'toggleReady': {
      if (state.phase !== 'playing') return state;
      const actor = state.players.find((player) => player.id === playerId);
      if (!actor?.connected) return state;
      return {
        ...state,
        players: state.players.map((player) =>
          player.id === playerId ? { ...player, ready: !player.ready } : player,
        ),
      };
    }
    case 'endMatch': {
      if (state.phase !== 'playing' || playerId !== state.hostPlayerId) return state;
      return { ...state, phase: 'finished' };
    }
    case 'returnToLobby': {
      if (state.phase !== 'finished' || playerId !== state.hostPlayerId) return state;
      return {
        ...state,
        phase: 'lobby',
        players: resetPlayersForGameStart(state.players),
      };
    }
    default:
      return state;
  }
}
