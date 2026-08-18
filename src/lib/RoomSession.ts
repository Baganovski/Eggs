import Peer, { type DataConnection } from 'peerjs';
import type {
  GameState,
  Player,
  PlayerAction,
  PublicGameState,
  RoomCallbacks,
  RoomMessage,
} from '../types/game';
import { MAX_PLAYERS, MIN_PLAYERS } from '../types/game';
import {
  applyPlayerAction,
  createHostLobbyState,
  createInitialPlayer,
  createJoinerLobbyState,
  electHost,
  markDisconnected,
  startMatch,
} from './gameLogic';

function toPublicState(state: GameState): PublicGameState {
  const { localPlayerId: _, ...publicState } = state;
  return publicState;
}

function withLocalId(state: PublicGameState, localPlayerId: string): GameState {
  return { ...state, localPlayerId };
}

export class RoomSession {
  private peer: Peer | null = null;
  private connections = new Map<string, DataConnection>();
  private state: GameState;
  private isHost = false;
  private callbacks: RoomCallbacks;
  private hostConnection: DataConnection | null = null;
  private destroyed = false;
  private migrationInProgress = false;

  private constructor(state: GameState, callbacks: RoomCallbacks) {
    this.state = state;
    this.callbacks = callbacks;
  }

  static async create(
    roomCode: string,
    playerName: string,
    playerId: string,
    callbacks: RoomCallbacks,
  ): Promise<RoomSession> {
    const session = new RoomSession(
      createHostLobbyState(roomCode, playerId, playerName),
      callbacks,
    );
    await session.initHostPeer(roomCode);
    session.isHost = true;
    session.emitState();
    return session;
  }

  static async join(
    roomCode: string,
    playerName: string,
    playerId: string,
    callbacks: RoomCallbacks,
  ): Promise<RoomSession> {
    const session = new RoomSession(createJoinerLobbyState(roomCode, playerId), callbacks);
    await session.initJoinerPeer(roomCode, playerName, playerId);
    return session;
  }

  getState(): GameState {
    return this.state;
  }

  startGame(): void {
    if (this.isHost) {
      this.handleStart(this.state.localPlayerId);
      return;
    }
    this.send({ type: 'start', startedBy: this.state.localPlayerId });
  }

  sendPlayerAction(action: PlayerAction): void {
    this.send({
      type: 'playerAction',
      playerId: this.state.localPlayerId,
      action,
    });
    if (this.isHost) {
      this.handlePlayerAction(this.state.localPlayerId, action);
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    this.hostConnection = null;
    this.peer?.destroy();
    this.peer = null;
  }

  private emitState(): void {
    this.callbacks.onStateChange({ ...this.state, players: [...this.state.players] });
  }

  private emitNotice(message: string): void {
    this.callbacks.onNotice(message);
  }

  private emitError(message: string): void {
    this.callbacks.onError(message);
  }

  private updateState(partial: Partial<GameState>): void {
    this.state = { ...this.state, ...partial };
    this.emitState();
  }

  private send(message: RoomMessage, target?: DataConnection): void {
    const payload = JSON.stringify(message);
    if (target) {
      if (target.open) target.send(payload);
      return;
    }
    if (this.isHost) {
      this.broadcast(message);
      return;
    }
    const hostConnection = this.getHostConnection();
    if (hostConnection?.open) {
      hostConnection.send(payload);
    }
  }

  private broadcast(message: RoomMessage, exceptPlayerId?: string): void {
    const payload = JSON.stringify(message);
    for (const [playerId, connection] of this.connections) {
      if (playerId === exceptPlayerId) continue;
      if (connection.open) connection.send(payload);
    }
  }

  private getHostConnection(): DataConnection | undefined {
    if (this.isHost) return undefined;
    return this.hostConnection ?? undefined;
  }

  private async initHostPeer(roomCode: string): Promise<void> {
    const peer = await this.createPeer(roomCode);
    this.peer = peer;
    peer.on('connection', (connection) => {
      this.registerConnection(connection);
    });
    peer.on('error', (error) => {
      if (!this.destroyed) {
        this.emitError(error.message);
      }
    });
  }

  private async initJoinerPeer(
    roomCode: string,
    playerName: string,
    playerId: string,
  ): Promise<void> {
    const peer = await this.createPeer();
    this.peer = peer;
    peer.on('error', (error) => {
      if (!this.destroyed && !this.migrationInProgress) {
        this.emitError(error.message);
      }
    });
    const connection = peer.connect(roomCode, { reliable: true });
    this.hostConnection = connection;
    this.registerConnection(connection);
    await this.waitForOpen(connection, { peer, timeoutMs: 12_000 });
    this.send({ type: 'join', name: playerName, playerId }, connection);
  }

  private createPeer(id?: string): Promise<Peer> {
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id) : new Peer();
      const onOpen = () => {
        peer.off('error', onError);
        resolve(peer);
      };
      const onError = (error: Error) => {
        peer.off('open', onOpen);
        reject(error);
      };
      peer.once('open', onOpen);
      peer.once('error', onError);
    });
  }

  private waitForOpen(
    connection: DataConnection,
    options?: { peer?: Peer; timeoutMs?: number },
  ): Promise<void> {
    if (connection.open) return Promise.resolve();
    const timeoutMs = options?.timeoutMs ?? 12_000;
    const peer = options?.peer;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Could not reach the host. Try rejoining the room.'));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        connection.off('open', onOpen);
        connection.off('error', onConnError);
        peer?.off('error', onPeerError);
      };

      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onConnError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onPeerError = (error: Error) => {
        cleanup();
        reject(error);
      };

      connection.once('open', onOpen);
      connection.once('error', onConnError);
      peer?.on('error', onPeerError);
    });
  }

  private registerConnection(connection: DataConnection, playerIdHint?: string): void {
    const playerId = playerIdHint ?? '';
    connection.on('data', (raw) => {
      try {
        const message = JSON.parse(String(raw)) as RoomMessage;
        this.handleMessage(message, connection);
      } catch {
        this.emitError('Received invalid message from peer.');
      }
    });
    connection.on('close', () => {
      if (playerId) {
        this.connections.delete(playerId);
      }
      this.handleConnectionClosed(connection, playerId);
    });
    connection.on('error', () => {
      if (playerId) {
        this.connections.delete(playerId);
      }
    });
    if (playerId) {
      this.connections.set(playerId, connection);
    }
  }

  private handleMessage(message: RoomMessage, connection: DataConnection): void {
    switch (message.type) {
      case 'join':
        if (this.isHost) this.handleJoin(message, connection);
        break;
      case 'start':
        if (this.isHost) this.handleStart(message.startedBy);
        break;
      case 'playerAction':
        if (this.isHost) this.handlePlayerAction(message.playerId, message.action);
        break;
      case 'requestState':
        if (this.isHost) {
          this.mapConnectionToPlayer(connection, message.playerId);
          this.broadcast({ type: 'stateSync', state: toPublicState(this.state) });
          this.emitState();
        }
        break;
      case 'joinAck':
        this.state = withLocalId(message.state, message.playerId);
        this.emitState();
        break;
      case 'lobbyUpdate':
        this.updateState({ players: message.players });
        break;
      case 'stateSync':
        this.state = withLocalId(message.state, this.state.localPlayerId);
        this.emitState();
        break;
      case 'playerLeft':
        this.updateState({ players: message.players });
        this.emitNotice('A player left the game.');
        break;
      case 'hostHandoff':
        this.handleHostHandoff(message);
        break;
      case 'notice':
        this.emitNotice(message.message);
        break;
      case 'error':
        this.emitError(message.message);
        break;
      default:
        break;
    }
  }

  private handleJoin(
    message: Extract<RoomMessage, { type: 'join' }>,
    connection: DataConnection,
  ): void {
    const { name, playerId } = message;
    const activeCount = this.state.players.filter((player) => player.connected).length;
    const duplicateName = this.state.players.some(
      (player) => player.connected && player.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicateName) {
      this.send({ type: 'error', message: 'That name is already taken.' }, connection);
      connection.close();
      return;
    }
    const disconnectedSeat = this.state.players.find(
      (player) =>
        !player.connected &&
        (player.name.toLowerCase() === name.toLowerCase() || player.id === playerId),
    );
    let nextPlayer: Player;
    if (disconnectedSeat) {
      nextPlayer = {
        ...disconnectedSeat,
        connected: true,
        ready: false,
      };
      this.state.players = this.state.players.map((player) =>
        player.id === disconnectedSeat.id ? nextPlayer : player,
      );
    } else {
      if (activeCount >= MAX_PLAYERS) {
        this.send({ type: 'error', message: 'This room is full.' }, connection);
        connection.close();
        return;
      }
      if (this.state.phase !== 'lobby') {
        this.send({ type: 'error', message: 'This game has already started.' }, connection);
        connection.close();
        return;
      }
      nextPlayer = createInitialPlayer(playerId, name, this.state.players.length);
      this.state.players = [...this.state.players, nextPlayer];
    }
    this.connections.set(nextPlayer.id, connection);
    this.send(
      {
        type: 'joinAck',
        playerId: nextPlayer.id,
        state: toPublicState({
          ...this.state,
          localPlayerId: nextPlayer.id,
        }),
      },
      connection,
    );
    this.broadcastLobby();
    this.emitState();
  }

  private broadcastLobby(): void {
    const players = [...this.state.players];
    this.broadcast({ type: 'lobbyUpdate', players });
    this.emitState();
  }

  private handleStart(startedBy: string): void {
    if (!this.isHost) return;
    if (startedBy !== this.state.hostPlayerId) {
      this.broadcast({
        type: 'notice',
        message: 'Only the host can start the match.',
      });
      return;
    }
    const connectedCount = this.state.players.filter((player) => player.connected).length;
    if (connectedCount < MIN_PLAYERS) {
      this.broadcast({
        type: 'notice',
        message: `Need at least ${MIN_PLAYERS} players to start (${connectedCount}/${MAX_PLAYERS}).`,
      });
      return;
    }
    if (this.state.phase !== 'lobby') return;
    this.state = startMatch(this.state);
    this.broadcast({ type: 'start', startedBy });
    this.broadcast({ type: 'stateSync', state: toPublicState(this.state) });
    this.emitState();
    this.emitNotice('Match started. Arena coming soon.');
  }

  private handlePlayerAction(playerId: string, action: PlayerAction): void {
    if (!this.isHost) return;
    const next = applyPlayerAction(this.state, playerId, action);
    if (next === this.state) return;
    this.state = next;
    this.broadcast({ type: 'stateSync', state: toPublicState(this.state) });
    this.emitState();
    if (action.type === 'endMatch') {
      this.emitNotice('Host ended the match.');
    } else if (action.type === 'returnToLobby') {
      this.emitNotice('Back in the lobby.');
    }
  }

  private handleConnectionClosed(connection: DataConnection, playerId: string): void {
    if (this.destroyed) return;
    const resolvedPlayerId =
      playerId ||
      [...this.connections.entries()].find(([, conn]) => conn === connection)?.[0] ||
      '';
    if (this.isHost) {
      if (!resolvedPlayerId) return;
      this.removePlayer(resolvedPlayerId);
      return;
    }
    if (connection === this.hostConnection) {
      this.hostConnection = null;
      void this.beginHostMigration();
    }
  }

  private removePlayer(playerId: string): void {
    const player = this.state.players.find((entry) => entry.id === playerId);
    if (!player) return;
    this.connections.delete(playerId);
    this.state.players = this.state.players.map((entry) =>
      entry.id === playerId ? markDisconnected(entry) : entry,
    );
    this.broadcast({
      type: 'playerLeft',
      playerId,
      players: [...this.state.players],
    });
    this.emitNotice(`${player.name} left.`);
    this.emitState();
    if (playerId === this.state.hostPlayerId) {
      void this.beginHostMigration();
    }
  }

  private async beginHostMigration(): Promise<void> {
    if (this.migrationInProgress || this.destroyed) return;
    this.migrationInProgress = true;

    const departedHostId = this.state.hostPlayerId;

    this.state.players = this.state.players.map((player) =>
      player.id === departedHostId ? markDisconnected(player) : player,
    );

    const remaining = this.state.players.filter((player) => player.connected);
    if (remaining.length === 0) {
      this.emitError('Everyone left the room.');
      this.destroy();
      return;
    }

    const newHostId = electHost(this.state.players);
    if (!newHostId) {
      this.emitError('Could not elect a new host.');
      this.destroy();
      return;
    }

    this.state.hostPlayerId = newHostId;

    if (newHostId === this.state.localPlayerId) {
      try {
        await this.promoteToHost();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to take over as host.';
        this.emitError(message);
        this.migrationInProgress = false;
        return;
      }
    } else {
      await this.reconnectToHost();
    }

    this.migrationInProgress = false;
  }

  private async promoteToHost(): Promise<void> {
    this.emitNotice('You are now hosting.');
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    this.hostConnection = null;
    this.peer?.destroy();
    this.isHost = true;

    await new Promise((resolve) => setTimeout(resolve, 800));
    await this.initHostPeer(this.state.roomCode);
    this.broadcast({
      type: 'hostHandoff',
      newHostPlayerId: this.state.localPlayerId,
      state: toPublicState(this.state),
    });
    this.emitState();
  }

  private mapConnectionToPlayer(connection: DataConnection, playerId: string): void {
    this.connections.set(playerId, connection);
    this.state.players = this.state.players.map((player) =>
      player.id === playerId ? { ...player, connected: true } : player,
    );
  }

  private async reconnectToHost(): Promise<void> {
    this.emitNotice('Host changed. Reconnecting...');
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    this.hostConnection = null;
    this.peer?.destroy();
    this.isHost = false;

    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 1200 : 1500));
      if (this.destroyed) return;

      try {
        const peer = await this.createPeer();
        this.peer = peer;
        peer.on('error', (error) => {
          if (!this.destroyed && !this.migrationInProgress) {
            this.emitError(error.message);
          }
        });
        const connection = peer.connect(this.state.roomCode, { reliable: true });
        this.hostConnection = connection;
        this.registerConnection(connection);
        await this.waitForOpen(connection, { peer, timeoutMs: 10_000 });
        this.send(
          {
            type: 'requestState',
            playerId: this.state.localPlayerId,
          },
          connection,
        );
        return;
      } catch (error) {
        lastError = error;
        this.hostConnection = null;
        this.peer?.destroy();
        this.peer = null;
      }
    }

    const message =
      lastError instanceof Error
        ? lastError.message
        : 'Reconnection failed. Try rejoining the room.';
    this.emitError(message);
  }

  private handleHostHandoff(message: Extract<RoomMessage, { type: 'hostHandoff' }>): void {
    this.state = withLocalId(message.state, this.state.localPlayerId);
    this.state.hostPlayerId = message.newHostPlayerId;
    this.isHost = message.newHostPlayerId === this.state.localPlayerId;
    this.emitNotice('New host connected. Game continues.');
    this.emitState();
  }
}
