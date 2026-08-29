import { PlayerToken } from './PlayerToken';

interface LobbyRosterProps {
  connectedCount: number;
  maxSeats: number;
  canKick: boolean;
  onKick: (playerId: string) => void;
  players: Array<{
    id: string;
    name: string;
    connected: boolean;
    isBot: boolean;
    isHost: boolean;
    isYou: boolean;
    joinOrder: number;
  }>;
}

export function LobbyRoster({
  players,
  connectedCount,
  maxSeats,
  canKick,
  onKick,
}: LobbyRosterProps) {
  const seats = Array.from({ length: maxSeats }, (_, index) => players[index] ?? null);

  return (
    <div className="roster">
      <div className="roster-meta">
        <span>{connectedCount} in the carton</span>
        <span>{Math.max(0, maxSeats - connectedCount)} cups open</span>
      </div>
      <ul className="roster-list">
        {seats.map((player, index) => (
          <li key={player?.id ?? `empty-${index}`} className="roster-seat">
            {player ? (
              <>
                <span className="seat-egg" aria-hidden="true">
                  <PlayerToken joinOrder={player.joinOrder} name={player.name} isYou={player.isYou} />
                </span>
                <span className="seat-name">
                  {player.name}
                  {player.isYou ? ' (you)' : ''}
                </span>
                <span className="seat-tags">
                  {player.isHost && <span className="tag">host</span>}
                  {player.isBot && <span className="tag tag-muted">bot</span>}
                  {!player.connected && <span className="tag tag-muted">rolled off</span>}
                  {canKick && !player.isYou && (
                    <button
                      type="button"
                      className="seat-remove"
                      onClick={() => onKick(player.id)}
                    >
                      Kick
                    </button>
                  )}
                </span>
              </>
            ) : (
              <span className="seat-empty">Empty cup</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
