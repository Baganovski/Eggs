import { MAX_PLAYERS } from '../types/game';

interface LobbyRosterProps {
  connectedCount: number;
  players: Array<{
    id: string;
    name: string;
    connected: boolean;
    isHost: boolean;
    isYou: boolean;
  }>;
}

export function LobbyRoster({ players, connectedCount }: LobbyRosterProps) {
  const seats = Array.from({ length: MAX_PLAYERS }, (_, index) => players[index] ?? null);

  return (
    <div className="roster">
      <div className="roster-meta">
        <span>{connectedCount} connected</span>
        <span>{MAX_PLAYERS - connectedCount} seats open</span>
      </div>
      <ul className="roster-list">
        {seats.map((player, index) => (
          <li key={player?.id ?? `empty-${index}`} className="roster-seat">
            {player ? (
              <>
                <span className="seat-name">
                  {player.name}
                  {player.isYou ? ' (you)' : ''}
                </span>
                <span className="seat-tags">
                  {player.isHost && <span className="tag">host</span>}
                  {!player.connected && <span className="tag tag-muted">away</span>}
                </span>
              </>
            ) : (
              <span className="seat-empty">Empty seat</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
