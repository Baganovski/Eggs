import { JoinCodeBar } from './JoinCodeBar';
import { LobbyRoster } from './LobbyRoster';
import { BattlePlaceholder } from './BattlePlaceholder';
import { Toast } from './Toast';
import { MAX_PLAYERS, MIN_PLAYERS, type GamePhase } from '../types/game';

interface RoomShellProps {
  roomCode: string;
  phase: GamePhase;
  connectedCount: number;
  canStart: boolean;
  isHost: boolean;
  onStart: () => void;
  onLeave: () => void;
  roster: Array<{
    id: string;
    name: string;
    connected: boolean;
    isHost: boolean;
    isYou: boolean;
  }>;
  battlePlayers: Array<{
    id: string;
    name: string;
    connected: boolean;
    ready: boolean;
    isHost: boolean;
    isYou: boolean;
  }>;
  localReady: boolean;
  onToggleReady: () => void;
  onEndMatch: () => void;
  onReturnToLobby: () => void;
  notice: string | null;
  error: string | null;
  onDismissNotice: () => void;
  onDismissError: () => void;
}

function PanelHeader({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <header className="panel-header">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p className="panel-copy">{copy}</p>
    </header>
  );
}

export function RoomShell({
  roomCode,
  phase,
  connectedCount,
  canStart,
  isHost,
  onStart,
  onLeave,
  roster,
  battlePlayers,
  localReady,
  onToggleReady,
  onEndMatch,
  onReturnToLobby,
  notice,
  error,
  onDismissNotice,
  onDismissError,
}: RoomShellProps) {
  const eyebrow =
    phase === 'lobby' ? 'Waiting room' : phase === 'finished' ? 'Match over' : 'Arena';

  const title =
    phase === 'lobby'
      ? 'Gather fighters'
      : phase === 'finished'
        ? 'Standings'
        : 'Placeholder battle';

  const copy =
    phase === 'lobby'
      ? `Share the join code. Host starts with ${MIN_PLAYERS}–${MAX_PLAYERS} players.`
      : phase === 'finished'
        ? 'The real winner screen will live here. For now, head back to the lobby.'
        : 'Ready toggles sync across every device in the room.';

  return (
    <div className="room-shell">
      <JoinCodeBar code={roomCode} onLeave={onLeave} />

      <main className="room-main">
        {phase === 'lobby' ? (
          <section className="panel lobby-panel">
            <PanelHeader eyebrow={eyebrow} title={title} copy={copy} />

            <LobbyRoster players={roster} connectedCount={connectedCount} />

            {isHost ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canStart}
                onClick={onStart}
              >
                {canStart
                  ? 'Start match'
                  : `Waiting for players (${connectedCount}/${MAX_PLAYERS} · min ${MIN_PLAYERS})`}
              </button>
            ) : (
              <p className="waiting-host">Waiting for the host to start.</p>
            )}
          </section>
        ) : (
          <section className="panel game-panel">
            <PanelHeader eyebrow={eyebrow} title={title} copy={copy} />
            <BattlePlaceholder
              phase={phase}
              players={battlePlayers}
              isHost={isHost}
              localReady={localReady}
              onToggleReady={onToggleReady}
              onEndMatch={onEndMatch}
              onReturnToLobby={onReturnToLobby}
            />
          </section>
        )}
      </main>

      {notice && <Toast message={notice} tone="info" onDismiss={onDismissNotice} />}
      {error && <Toast message={error} tone="error" onDismiss={onDismissError} />}
      {phase === 'playing' && !notice && !error && (
        <p className="connection-hint">Devices stay linked peer-to-peer. Dropped players show as away.</p>
      )}
    </div>
  );
}
