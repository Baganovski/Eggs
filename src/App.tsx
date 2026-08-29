import { useState } from 'react';
import { useGameRoom } from './context/GameRoomContext';
import { Eggsplanation } from './components/Eggsplanation';
import { RoomShell } from './components/RoomShell';
import { Toast } from './components/Toast';
import { cartonSpec, MIN_PLAYERS, PLAYER_HUES } from './types/game';

function HomeEggCluster() {
  const shell =
    'M60 8 C86 8 108 52 108 92 C108 124 86 142 60 142 C34 142 12 124 12 92 C12 52 34 8 60 8 Z';

  const eggs = [
    { cx: 48, cy: 132, scale: 0.62, rotate: -16, fill: PLAYER_HUES[3], dur: '2.8s', delay: '0s' },
    { cx: 218, cy: 132, scale: 0.64, rotate: 14, fill: PLAYER_HUES[2], dur: '2.4s', delay: '0.6s' },
    { cx: 82, cy: 132, scale: 0.74, rotate: -6, fill: PLAYER_HUES[1], dur: '3.2s', delay: '0.3s' },
    { cx: 148, cy: 132, scale: 1, rotate: 6, fill: PLAYER_HUES[0], dur: '2.6s', delay: '1.1s' },
  ];

  return (
    <svg className="home-egg-stack" viewBox="8 64 264 142" aria-hidden="true">
      <defs>
        <filter id="home-egg-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.4" />
        </filter>
      </defs>
      {eggs.map((egg) => (
        <ellipse
          key={`${egg.fill}-shadow`}
          cx={egg.cx + egg.scale * 8}
          cy={egg.cy + egg.scale * 66}
          rx={egg.scale * 30}
          ry={egg.scale * 9}
          fill="#111"
          opacity="0.22"
          filter="url(#home-egg-shadow)"
        />
      ))}
      {eggs.map((egg) => (
        <g
          key={egg.fill}
          className="home-egg-fidget"
          style={{
            transformOrigin: `${egg.cx}px ${egg.cy}px`,
            animationDuration: egg.dur,
            animationDelay: egg.delay,
          }}
        >
          <g transform={`translate(${egg.cx} ${egg.cy}) rotate(${egg.rotate}) scale(${egg.scale})`}>
            <g transform="translate(-60 -75)">
              <path d={shell} fill={egg.fill} stroke="#111" strokeWidth="5" strokeLinejoin="round" />
              <ellipse cx="46" cy="52" rx="16" ry="22" fill="#fff" opacity="0.38" />
            </g>
          </g>
        </g>
      ))}
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
    kickPlayer,
    leaveRoom,
    clearNotice,
    clearError,
    planRejectTick,
  } = useGameRoom();

  const [screen, setScreen] = useState<Screen>('home');
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  if (state) {
    const connectedPlayers = state.players.filter((player) => player.connected);
    const isHost = state.localPlayerId === state.hostPlayerId;
    const carton = cartonSpec(state.cartonType);

    return (
      <RoomShell
        state={state}
        connectedCount={connectedPlayers.length}
        canStart={
          isHost &&
          connectedPlayers.length >= MIN_PLAYERS &&
          connectedPlayers.length <= carton.maxPlayers &&
          state.phase === 'lobby'
        }
        isHost={isHost}
        onStart={startGame}
        onAddBot={addBot}
        onKick={kickPlayer}
        onSetCartonType={(cartonType) => sendPlayerAction({ type: 'setCartonType', cartonType })}
        onLeave={leaveRoom}
        onSubmitPlan={(plan) => sendPlayerAction({ type: 'submitPlan', ...plan })}
        onReturnToLobby={() => sendPlayerAction({ type: 'returnToLobby' })}
        planRejectTick={planRejectTick}
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
      <div className="home-backdrop" aria-hidden="true" />
      <main className="home-main">
        <header className="home-hero">
          <div className="home-lockup">
            <h1 className="brand">Eggs</h1>
            <HomeEggCluster />
          </div>
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
            <p className="home-version">v{__APP_VERSION__}</p>
          </section>
        )}

        {screen === 'create' && (
          <section className="panel home-panel">
            <form className="home-form" onSubmit={handleCreate}>
              <label htmlFor="create-egg-handle">Your egg name</label>
              <input
                id="create-egg-handle"
                name="egg-handle"
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="Who’s hatching?"
                autoComplete="eggs-handle"
                autoCorrect="off"
                spellCheck={false}
                maxLength={20}
                required
              />
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setScreen('home')}>
                  Roll back
                </button>
                <button type="submit" className="btn btn-primary" disabled={isConnecting}>
                  {isConnecting ? 'Building' : 'Crack on'}
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
              <label htmlFor="join-egg-handle">Your egg name</label>
              <input
                id="join-egg-handle"
                name="egg-handle"
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="Who’s hatching?"
                autoComplete="eggs-handle"
                autoCorrect="off"
                spellCheck={false}
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
