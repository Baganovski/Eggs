import { useState } from 'react';
import { useGameRoom } from './context/GameRoomContext';
import { RoomShell } from './components/RoomShell';
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
    leaveRoom,
    clearNotice,
    clearError,
  } = useGameRoom();

  const [screen, setScreen] = useState<Screen>('home');
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  if (state) {
    const connectedPlayers = state.players.filter((player) => player.connected);
    const localPlayer = state.players.find((player) => player.id === state.localPlayerId);
    const isHost = state.localPlayerId === state.hostPlayerId;

    return (
      <RoomShell
        roomCode={state.roomCode}
        phase={state.phase}
        connectedCount={connectedPlayers.length}
        canStart={
          isHost &&
          connectedPlayers.length >= MIN_PLAYERS &&
          connectedPlayers.length <= MAX_PLAYERS &&
          state.phase === 'lobby'
        }
        isHost={isHost}
        onStart={startGame}
        onLeave={leaveRoom}
        roster={state.players.map((player) => ({
          id: player.id,
          name: player.name,
          connected: player.connected,
          isHost: player.id === state.hostPlayerId,
          isYou: player.id === state.localPlayerId,
        }))}
        battlePlayers={state.players.map((player) => ({
          id: player.id,
          name: player.name,
          connected: player.connected,
          ready: player.ready,
          isHost: player.id === state.hostPlayerId,
          isYou: player.id === state.localPlayerId,
        }))}
        localReady={localPlayer?.ready ?? false}
        onToggleReady={() => sendPlayerAction({ type: 'toggleReady' })}
        onEndMatch={() => sendPlayerAction({ type: 'endMatch' })}
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
      <div className="home-backdrop" aria-hidden="true" />

      <main className="home-main">
        <header className="home-hero">
          <p className="brand">Random Game</p>
          <h1>Four fighters. One room.</h1>
          <p className="home-lede">
            Create a match, share the code, and wait for the others. The arena comes later —
            the lobby is ready now.
          </p>
        </header>

        {screen === 'home' && (
          <section className="home-actions">
            <button type="button" className="btn btn-primary" onClick={() => setScreen('create')}>
              Create game
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setScreen('join')}>
              Join game
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
                placeholder="Callsign"
                autoComplete="nickname"
                maxLength={20}
                required
              />
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setScreen('home')}>
                  Back
                </button>
                <button type="submit" className="btn btn-primary" disabled={isConnecting}>
                  {isConnecting ? 'Creating room…' : 'Create & join'}
                </button>
              </div>
            </form>
          </section>
        )}

        {screen === 'join' && (
          <section className="panel home-panel">
            <form className="home-form" onSubmit={handleJoin}>
              <label htmlFor="join-code">Join code</label>
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
                placeholder="Callsign"
                autoComplete="nickname"
                maxLength={20}
                required
              />
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setScreen('home')}>
                  Back
                </button>
                <button type="submit" className="btn btn-primary" disabled={isConnecting}>
                  {isConnecting ? 'Connecting…' : 'Enter room'}
                </button>
              </div>
            </form>
          </section>
        )}

        {error && (
          <p className="home-error" role="alert">
            {error}
          </p>
        )}
      </main>
    </div>
  );
}
