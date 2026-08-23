import { MAX_PLAYERS } from '../types/game';

interface LobbyRosterProps {
  connectedCount: number;
  canManageBots: boolean;
  onRemoveBot: (playerId: string) => void;
  players: Array<{
    id: string;
    name: string;
    connected: boolean;
    isBot: boolean;
    isHost: boolean;
    isYou: boolean;
  }>;
}

export function LobbyRoster({
  players,
  connectedCount,
  canManageBots,
  onRemoveBot,
}: LobbyRosterProps) {
  const seats = Array.from({ length: MAX_PLAYERS }, (_, index) => players[index] ?? null);

  return (
    <div className="roster">
      <div className="roster-meta">
        <span>{connectedCount} in the room</span>
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
                  {player.isBot && <span className="tag tag-muted">bot</span>}
                  {!player.connected && <span className="tag tag-muted">away</span>}
                  {canManageBots && player.isBot && (
                    <button
                      type="button"
                      className="seat-remove"
                      onClick={() => onRemoveBot(player.id)}
                    >
                      Kick
                    </button>
                  )}
                </span>
              </>
            ) : (
              <span className="seat-empty">Open seat</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
