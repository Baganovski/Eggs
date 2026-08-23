import { useState } from 'react';
import { useGameRoom } from './context/GameRoomContext';
import { RoomShell } from './components/RoomShell';
import { Toast } from './components/Toast';
import { MAX_PLAYERS, MIN_PLAYERS } from './types/game';

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
        onSubmitPlan={(actions) => sendPlayerAction({ type: 'submitPlan', actions })}
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
          <svg className="home-doodle" viewBox="0 0 48 48" aria-hidden="true">
            <path
              d="M6 24 C14 10 34 10 42 24 C34 38 14 38 6 24 Z"
              fill="#ffe14a"
              stroke="#111"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <circle cx="24" cy="24" r="8" fill="#fff" stroke="#111" strokeWidth="2.4" />
            <circle cx="24" cy="24" r="4" fill="#111" />
          </svg>
          <h1 className="brand">BEAT</h1>
          <p className="home-lede">3 HP, 2 Moves, 1 Beat</p>
        </header>

        {screen === 'home' && (
          <section className="home-actions">
            <button type="button" className="btn btn-primary" onClick={() => setScreen('create')}>
              Open a room
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setScreen('join')}>
              Hop in
            </button>
          </section>
        )}

        {screen === 'create' && (
          <section className="panel home-panel">
            <form className="home-form" onSubmit={handleCreate}>
              <label htmlFor="create-name">Your name</label>
              <input
                id="create-name"
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="Who’s playing?"
                autoComplete="nickname"
                maxLength={20}
                required
              />
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setScreen('home')}>
                  Back
                </button>
                <button type="submit" className="btn btn-primary" disabled={isConnecting}>
                  {isConnecting ? 'Opening room…' : 'Let’s go'}
                </button>
              </div>
            </form>
          </section>
        )}

        {screen === 'join' && (
          <section className="panel home-panel">
            <form className="home-form" onSubmit={handleJoin}>
              <label htmlFor="join-code">Room code</label>
              <input
                id="join-code"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="6-letter code"
                autoComplete="off"
                maxLength={6}
                required
              />
              <label htmlFor="join-name">Your name</label>
              <input
                id="join-name"
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="Who’s playing?"
                autoComplete="nickname"
                maxLength={20}
                required
              />
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setScreen('home')}>
                  Back
                </button>
                <button type="submit" className="btn btn-primary" disabled={isConnecting}>
                  {isConnecting ? 'Linking up…' : 'Let’s go'}
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
