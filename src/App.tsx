import { useState } from 'react';
import { useGameRoom } from './context/GameRoomContext';
import { Eggsplanation } from './components/Eggsplanation';
import { RoomShell } from './components/RoomShell';
import { Toast } from './components/Toast';
import { MAX_PLAYERS, MIN_PLAYERS, PLAYER_HUES } from './types/game';

function HomeEggCluster() {
  const shell =
    'M60 8 C86 8 108 52 108 92 C108 124 86 142 60 142 C34 142 12 124 12 92 C12 52 34 8 60 8 Z';

  const renderEgg = (fill: string) => (
    <>
      <ellipse cx="60" cy="138" rx="34" ry="7" fill="#d4d1d6" />
      <path d={shell} fill={fill} stroke="#111" strokeWidth="5" strokeLinejoin="round" />
      <ellipse cx="46" cy="52" rx="16" ry="22" fill="#fff" opacity="0.38" />
    </>
  );

  const place = (cx: number, cy: number, scale: number, rotate: number, fill: string) => (
    <g transform={`translate(${cx} ${cy}) rotate(${rotate}) scale(${scale})`}>
      <g transform="translate(-60 -75)">{renderEgg(fill)}</g>
    </g>
  );

  return (
    <svg className="home-egg-stack" viewBox="0 0 280 210" aria-hidden="true">
      {place(48, 132, 0.62, -16, PLAYER_HUES[3])}
      {place(218, 132, 0.64, 14, PLAYER_HUES[2])}
      {place(82, 132, 0.74, -6, PLAYER_HUES[1])}
      {place(148, 132, 1, 6, PLAYER_HUES[0])}
    </svg>
  );
}

type Screen = 'home' | 'create' | 'join';

export function App() {
  const {
    state,
    notice,
    error,
    isConnecting,
    createRoom,
    joinRoom,
    startGame,
    sendPlayerAction,
    addBot,
    removeBot,
    leaveRoom,
    clearNotice,
    clearError,
  } = useGameRoom();

  const [screen, setScreen] = useState<Screen>('home');
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  if (state) {
    const connectedPlayers = state.players.filter((player) => player.connected);
    const isHost = state.localPlayerId === state.hostPlayerId;

    return (
      <RoomShell
        state={state}
        connectedCount={connectedPlayers.length}
        canStart={
          isHost &&
          connectedPlayers.length >= MIN_PLAYERS &&
          connectedPlayers.length <= MAX_PLAYERS &&
          state.phase === 'lobby'
        }
        isHost={isHost}
        onStart={startGame}
        onAddBot={addBot}
        onRemoveBot={removeBot}
        onLeave={leaveRoom}
        onSubmitPlan={(plan) => sendPlayerAction({ type: 'submitPlan', ...plan })}
        onReturnToLobby={() => sendPlayerAction({ type: 'returnToLobby' })}
        notice={notice}
        error={error}
        onDismissNotice={clearNotice}
        onDismissError={clearError}
      />
    );
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!playerName.trim()) return;
    await createRoom(playerName);
  };

  const handleJoin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!playerName.trim() || !joinCode.trim()) return;
    await joinRoom(joinCode, playerName);
  };

  return (
    <div className="app-shell">
      <main className="home-main">
        <header className="home-hero">
          <div className="home-lockup">
            <h1 className="brand">Eggs</h1>
            <HomeEggCluster />
          </div>
          <p className="home-lede">3 HP, 2 Moves, 1 Beat</p>
        </header>

        {screen === 'home' && (
          <section className="home-actions">
            <button type="button" className="btn btn-primary" onClick={() => setScreen('create')}>
              Make a nest
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setScreen('join')}>
              Hatch in
            </button>
            <Eggsplanation />
          </section>
        )}

        {screen === 'create' && (
          <section className="panel home-panel">
            <form className="home-form" onSubmit={handleCreate}>
              <label htmlFor="create-name">Your egg name</label>
              <input
                id="create-name"
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="Who’s hatching?"
                autoComplete="nickname"
                maxLength={20}
                required
              />
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setScreen('home')}>
                  Roll back
                </button>
                <button type="submit" className="btn btn-primary" disabled={isConnecting}>
                  {isConnecting ? 'Building the nest…' : 'Crack on'}
                </button>
              </div>
            </form>
          </section>
        )}

        {screen === 'join' && (
          <section className="panel home-panel">
            <form className="home-form" onSubmit={handleJoin}>
              <label htmlFor="join-code">Nest code</label>
              <input
                id="join-code"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="6-letter nest code"
                autoComplete="off"
                maxLength={6}
                required
              />
              <label htmlFor="join-name">Your egg name</label>
              <input
                id="join-name"
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="Who’s hatching?"
                autoComplete="nickname"
                maxLength={20}
                required
              />
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setScreen('home')}>
                  Roll back
                </button>
                <button type="submit" className="btn btn-primary" disabled={isConnecting}>
                  {isConnecting ? 'Rolling in…' : 'Crack on'}
                </button>
              </div>
            </form>
          </section>
        )}

        {error && (
          <div className="toast-stack">
            <Toast message={error} tone="error" onDismiss={clearError} />
          </div>
        )}
      </main>
    </div>
  );
}
