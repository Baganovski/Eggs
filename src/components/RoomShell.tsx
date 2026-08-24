import { JoinCodeBar } from './JoinCodeBar';
import { LobbyRoster } from './LobbyRoster';
import { Arena } from './Arena';
import { Toast } from './Toast';
import { MAX_PLAYERS, MIN_PLAYERS, type ArenaAction, type GameState } from '../types/game';

interface RoomShellProps {
  state: GameState;
  connectedCount: number;
  canStart: boolean;
  isHost: boolean;
  onStart: () => void;
  onAddBot: () => void;
  onRemoveBot: (playerId: string) => void;
  onLeave: () => void;
  onSubmitPlan: (plan: { cardIds: [string, string]; actions: [ArenaAction, ArenaAction] }) => void;
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

const lobbyHeader = {
  eyebrow: 'Incubating',
  title: 'The carton is filling',
  copy: `Share the nest code, or add a bot. The hen starts with ${MIN_PLAYERS}–${MAX_PLAYERS} eggs.`,
};

export function RoomShell({
  state,
  connectedCount,
  canStart,
  isHost,
  onStart,
  onAddBot,
  onRemoveBot,
  onLeave,
  onSubmitPlan,
  onReturnToLobby,
  notice,
  error,
  onDismissNotice,
  onDismissError,
}: RoomShellProps) {
  const { phase } = state;

  return (
    <div className="room-shell">
      <JoinCodeBar code={state.roomCode} onLeave={onLeave} />

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
              canManageBots={isHost && phase === 'lobby'}
              onRemoveBot={onRemoveBot}
            />

            {isHost ? (
              <>
                {connectedCount < MAX_PLAYERS && (
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
                    : `Need ${MIN_PLAYERS}+ eggs (${connectedCount}/${MAX_PLAYERS})`}
                </button>
              </>
            ) : (
              <p className="waiting-host">Waiting on the hen.</p>
            )}
          </section>
        ) : (
          <section className="panel game-panel">
            <Arena
              state={state}
              isHost={isHost}
              onSubmitPlan={onSubmitPlan}
              onReturnToLobby={onReturnToLobby}
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
