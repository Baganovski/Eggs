import { useState, type CSSProperties } from 'react';
import { JoinCodeBar } from './JoinCodeBar';
import { LobbyRoster } from './LobbyRoster';
import { CartonPicker } from './CartonPicker';
import { Arena } from './Arena';
import { Toast } from './Toast';
import {
  clampZoom,
  readDeviceZoom,
  writeDeviceZoom,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from '../lib/deviceZoom';
import { cartonSpec, MIN_PLAYERS, type ArenaAction, type CartonType, type GameState } from '../types/game';

interface RoomShellProps {
  state: GameState;
  connectedCount: number;
  canStart: boolean;
  isHost: boolean;
  onStart: () => void;
  onAddBot: () => void;
  onKick: (playerId: string) => void;
  onSetCartonType: (cartonType: CartonType) => void;
  onLeave: () => void;
  onSubmitPlan: (plan: { cardIds: [string, string]; actions: [ArenaAction, ArenaAction] }) => void;
  onReturnToLobby: () => void;
  planRejectTick: number;
  notice: string | null;
  error: string | null;
  onDismissNotice: () => void;
  onDismissError: () => void;
}

function PanelHeader({ title, copy }: { title: string; copy: string }) {
  return (
    <header className="panel-header">
      <h2>{title}</h2>
      <p className="panel-copy">{copy}</p>
    </header>
  );
}

const lobbyHeader = {
  title: 'The carton is filling',
  copy: 'Share the nest code, or add a bot. The host picks a carton, then starts the scramble.',
};

export function RoomShell({
  state,
  connectedCount,
  canStart,
  isHost,
  onStart,
  onAddBot,
  onKick,
  onSetCartonType,
  onLeave,
  onSubmitPlan,
  onReturnToLobby,
  planRejectTick,
  notice,
  error,
  onDismissNotice,
  onDismissError,
}: RoomShellProps) {
  const { phase } = state;
  const carton = cartonSpec(state.cartonType);
  const [zoom, setZoom] = useState(readDeviceZoom);

  const setDeviceZoom = (next: number) => {
    const clamped = clampZoom(next);
    setZoom(clamped);
    writeDeviceZoom(clamped);
  };

  return (
    <div className="room-shell" style={{ '--ui-zoom': String(zoom) } as CSSProperties}>
      <JoinCodeBar
        code={state.roomCode}
        onLeave={onLeave}
        canZoomOut={zoom > ZOOM_MIN}
        canZoomIn={zoom < ZOOM_MAX}
        onZoomOut={() => setDeviceZoom(zoom - ZOOM_STEP)}
        onZoomIn={() => setDeviceZoom(zoom + ZOOM_STEP)}
      />

      <main className={`room-main${phase !== 'lobby' ? ' is-arena' : ''}`}>
        {phase === 'lobby' ? (
          <section className="panel lobby-panel">
            <PanelHeader {...lobbyHeader} />

            <LobbyRoster
              players={state.players.map((player) => ({
                id: player.id,
                name: player.name,
                connected: player.connected,
                isBot: player.isBot,
                isHost: player.id === state.hostPlayerId,
                isYou: player.id === state.localPlayerId,
                joinOrder: player.joinOrder,
              }))}
              connectedCount={connectedCount}
              maxSeats={carton.maxPlayers}
              canKick={isHost && phase === 'lobby'}
              onKick={onKick}
            />

            <div className="lobby-controls">
              <CartonPicker
                value={state.cartonType}
                playerCount={state.players.length}
                isHost={isHost}
                onChange={onSetCartonType}
              />

              {isHost ? (
                <div className="lobby-actions">
                  {connectedCount < carton.maxPlayers && (
                    <button type="button" className="btn btn-secondary" onClick={onAddBot}>
                      Add a bot
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!canStart}
                    onClick={onStart}
                  >
                    {canStart
                      ? 'Crack on'
                      : `Need ${MIN_PLAYERS}+ eggs (${connectedCount}/${carton.maxPlayers})`}
                  </button>
                </div>
              ) : (
                <p className="waiting-host">Waiting on the host.</p>
              )}
            </div>
          </section>
        ) : (
          <section className="panel game-panel">
            <Arena
              state={state}
              isHost={isHost}
              planRejectTick={planRejectTick}
              onSubmitPlan={onSubmitPlan}
              onReturnToLobby={onReturnToLobby}
              onPlayAgain={onStart}
            />
          </section>
        )}
      </main>

      {(notice || error) && (
        <div className="toast-stack">
          {notice && <Toast message={notice} tone="info" onDismiss={onDismissNotice} />}
          {error && <Toast message={error} tone="error" onDismiss={onDismissError} />}
        </div>
      )}
    </div>
  );
}
