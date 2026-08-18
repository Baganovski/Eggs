interface BattlePlayer {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  isHost: boolean;
  isYou: boolean;
}

interface BattlePlaceholderProps {
  phase: 'playing' | 'finished';
  players: BattlePlayer[];
  isHost: boolean;
  localReady: boolean;
  onToggleReady: () => void;
  onEndMatch: () => void;
  onReturnToLobby: () => void;
}

export function BattlePlaceholder({
  phase,
  players,
  isHost,
  localReady,
  onToggleReady,
  onEndMatch,
  onReturnToLobby,
}: BattlePlaceholderProps) {
  const readyCount = players.filter((player) => player.connected && player.ready).length;
  const connectedCount = players.filter((player) => player.connected).length;

  return (
    <div className="battle-placeholder">
      <p className="arena-kicker">Arena coming soon</p>
      <p className="arena-copy">
        {phase === 'playing'
          ? 'Toggle ready to prove the room is in sync. The real battle will land here later.'
          : 'Match over. Host can send everyone back to the lobby.'}
      </p>

      <ul className="arena-roster">
        {players.map((player) => (
          <li
            key={player.id}
            className={`arena-seat${player.ready ? ' is-ready' : ''}${player.isYou ? ' is-you' : ''}`}
          >
            <span className="arena-name">
              {player.name}
              {player.isYou ? ' (you)' : ''}
            </span>
            <span className="arena-status">
              {player.isHost ? 'host · ' : ''}
              {!player.connected ? 'away' : player.ready ? 'ready' : 'waiting'}
            </span>
          </li>
        ))}
      </ul>

      {phase === 'playing' && (
        <>
          <p className="arena-meta">
            {readyCount}/{connectedCount} ready
          </p>
          <button type="button" className="btn btn-primary" onClick={onToggleReady}>
            {localReady ? 'Unready' : 'Ready'}
          </button>
          {isHost && (
            <button type="button" className="btn btn-secondary" onClick={onEndMatch}>
              End match
            </button>
          )}
        </>
      )}

      {phase === 'finished' && isHost && (
        <button type="button" className="btn btn-primary" onClick={onReturnToLobby}>
          Back to lobby
        </button>
      )}

      {phase === 'finished' && !isHost && (
        <p className="arena-meta">Waiting for the host to return to the lobby.</p>
      )}
    </div>
  );
}
