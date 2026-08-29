import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { RoomSession } from '../lib/RoomSession';
import { generateRoomCode, normalizeRoomCode } from '../lib/roomCode';
import { getOrCreatePlayerId, resetPlayerId } from '../lib/playerId';
import type { GameState, PlayerAction, RoomCallbacks } from '../types/game';

interface GameRoomContextValue {
  state: GameState | null;
  notice: string | null;
  error: string | null;
  isConnecting: boolean;
  createRoom: (playerName: string) => Promise<void>;
  joinRoom: (roomCode: string, playerName: string) => Promise<void>;
  startGame: () => void;
  sendPlayerAction: (action: PlayerAction) => void;
  addBot: () => void;
  kickPlayer: (playerId: string) => void;
  leaveRoom: () => void;
  clearNotice: () => void;
  clearError: () => void;
  planRejectTick: number;
}

const GameRoomContext = createContext<GameRoomContextValue | null>(null);

export function GameRoomProvider({ children }: { children: ReactNode }) {
  const sessionRef = useRef<RoomSession | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [planRejectTick, setPlanRejectTick] = useState(0);

  const leaveRoom = useCallback(() => {
    sessionRef.current?.destroy();
    sessionRef.current = null;
    setState(null);
    setNotice(null);
    setError(null);
    setIsConnecting(false);
  }, []);

  const sessionCallbacks = useCallback((): RoomCallbacks => {
    return {
      onStateChange: setState,
      onNotice: setNotice,
      onError: setError,
      onPlanRejected: () => setPlanRejectTick((tick) => tick + 1),
      onKicked: (message) => {
        resetPlayerId();
        sessionRef.current = null;
        setState(null);
        setNotice(null);
        setIsConnecting(false);
        setError(message);
      },
    };
  }, []);

  const createRoom = useCallback(
    async (playerName: string) => {
      leaveRoom();
      setIsConnecting(true);
      setError(null);

      const roomCode = generateRoomCode();
      const playerId = getOrCreatePlayerId();

      try {
        const session = await RoomSession.create(
          roomCode,
          playerName.trim(),
          playerId,
          sessionCallbacks(),
        );
        sessionRef.current = session;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Couldn’t lay this nest.';
        setError(message);
      } finally {
        setIsConnecting(false);
      }
    },
    [leaveRoom, sessionCallbacks],
  );

  const joinRoom = useCallback(
    async (roomCode: string, playerName: string) => {
      leaveRoom();
      setIsConnecting(true);
      setError(null);

      const normalizedCode = normalizeRoomCode(roomCode);
      const playerId = getOrCreatePlayerId();

      try {
        const session = await RoomSession.join(
          normalizedCode,
          playerName.trim(),
          playerId,
          sessionCallbacks(),
        );
        sessionRef.current = session;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Couldn’t roll into that nest.';
        setError(message);
      } finally {
        setIsConnecting(false);
      }
    },
    [leaveRoom, sessionCallbacks],
  );

  const startGame = useCallback(() => {
    sessionRef.current?.startGame();
  }, []);

  const sendPlayerAction = useCallback((action: PlayerAction) => {
    sessionRef.current?.sendPlayerAction(action);
  }, []);

  const addBot = useCallback(() => {
    sessionRef.current?.addBot();
  }, []);

  const kickPlayer = useCallback((playerId: string) => {
    sessionRef.current?.kickPlayer(playerId);
  }, []);

  const value = useMemo(
    () => ({
      state,
      notice,
      error,
      isConnecting,
      createRoom,
      joinRoom,
      startGame,
      sendPlayerAction,
      addBot,
      kickPlayer,
      leaveRoom,
      clearNotice: () => setNotice(null),
      clearError: () => setError(null),
      planRejectTick,
    }),
    [
      state,
      notice,
      error,
      isConnecting,
      createRoom,
      joinRoom,
      startGame,
      sendPlayerAction,
      addBot,
      kickPlayer,
      leaveRoom,
      planRejectTick,
    ],
  );

  return (
    <GameRoomContext.Provider value={value}>{children}</GameRoomContext.Provider>
  );
}

export function useGameRoom(): GameRoomContextValue {
  const context = useContext(GameRoomContext);
  if (!context) {
    throw new Error('useGameRoom must be used within GameRoomProvider');
  }
  return context;
}
