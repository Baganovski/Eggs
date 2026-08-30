import Peer, { type DataConnection } from 'peerjs';
import type {
  ArenaAction,
  GameState,
  PlayerAction,
  PublicGameState,
  RoomCallbacks,
  RoomMessage,
} from '../types/game';
import { MIN_PLAYERS, PLAN_DEADLINE_GRACE_MS, cartonSpec } from '../types/game';
import {
  applyResolvedRound,
  beginPlanningRound,
  closedMapObjects,
  isAlive,
  parseAndValidatePlan,
  playbackDurationMs,
  resetPlanningAfterHandoff,
  resolveRound,
  STAY_PLAN,
  hideOtherHands,
  viewStateFor,
} from './arenaLogic';
import { chooseBotPlan } from './botLogic';
import {
  applyPlayerAction,
  applyJoinRequest,
  createBotPlayer,
  createHostLobbyState,
  createJoinerLobbyState,
  electHost,
  markDisconnected,
  nextJoinOrder,
  startMatch,
} from './gameLogic';

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
  private pendingPlans = new Map<string, [ArenaAction, ArenaAction]>();
  private forcedPlans = new Set<string>();
  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private botPlanGeneration = 0;
  private botTimers: ReturnType<typeof setTimeout>[] = [];
  private planTimer: ReturnType<typeof setTimeout> | null = null;
  private latePlanTimer: ReturnType<typeof setTimeout> | null = null;
  private kickCloseTimers: ReturnType<typeof setTimeout>[] = [];

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
    this.send({ type: 'start' });
  }

  sendPlayerAction(action: PlayerAction): void {
    if (this.isHost) {
      this.handlePlayerAction(this.state.localPlayerId, action);
      return;
    }
    this.send({
      type: 'playerAction',
      action,
    });
  }

  addBot(): void {
    if (!this.isHost) return;
    if (this.state.phase !== 'lobby') return;
    const activeCount = this.state.players.filter((player) => player.connected).length;
    if (activeCount >= cartonSpec(this.state.cartonType).maxPlayers) {
      this.emitError('This nest is full.');
      return;
    }
    const bot = createBotPlayer(
      nextJoinOrder(this.state.players),
      this.state.players.map((player) => player.name),
    );
    this.state.players = [...this.state.players, bot];
    this.broadcastLobby();
  }

  kickPlayer(playerId: string): void {
    if (!this.isHost) return;
    if (this.state.phase !== 'lobby') return;
    if (playerId === this.state.localPlayerId) return;
    const target = this.state.players.find((player) => player.id === playerId);
    if (!target) return;

    const connection = this.connections.get(playerId);
    if (connection?.open) {
      this.send({ type: 'kicked', message: 'The host kicked you from the nest.' }, connection);
    }
    this.connections.delete(playerId);
    this.state.players = this.state.players.filter((player) => player.id !== playerId);
    this.broadcastLobby();

    if (connection) {
      const timer = setTimeout(() => {
        this.kickCloseTimers = this.kickCloseTimers.filter((entry) => entry !== timer);
        if (connection.open) connection.close();
      }, 250);
      this.kickCloseTimers.push(timer);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.clearKickCloseTimers();
    this.clearPlaybackTimer();
    this.clearBotTimers();
    this.clearPlanTimer();
    this.clearPendingPlans();
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    this.hostConnection = null;
    this.peer?.destroy();
    this.peer = null;
  }

  private clearKickCloseTimers(): void {
    for (const timer of this.kickCloseTimers) {
      clearTimeout(timer);
    }
    this.kickCloseTimers = [];
  }

  private clearPlanTimer(): void {
    if (this.planTimer !== null) {
      clearTimeout(this.planTimer);
      this.planTimer = null;
    }
  }

  private clearLatePlanTimer(): void {
    if (this.latePlanTimer !== null) {
      clearTimeout(this.latePlanTimer);
      this.latePlanTimer = null;
    }
  }

  private clearPendingPlans(): void {
    this.pendingPlans.clear();
    this.forcedPlans.clear();
    this.clearLatePlanTimer();
  }

  private scheduleLatePlanResolve(): void {
    this.clearLatePlanTimer();
    if (!this.isHost) return;
    this.latePlanTimer = setTimeout(() => {
      this.latePlanTimer = null;
      if (this.destroyed || !this.isHost) return;
      this.tryResolveIfReady();
    }, PLAN_DEADLINE_GRACE_MS);
  }

  private schedulePlanDeadline(): void {
    this.clearPlanTimer();
    if (!this.isHost) return;
    if (this.state.phase !== 'playing' || this.state.turnPhase !== 'planning') return;
    const deadline = this.state.planDeadlineAt;
    if (!deadline) return;
    const wait = Math.max(0, deadline - Date.now()) + PLAN_DEADLINE_GRACE_MS;
    this.planTimer = setTimeout(() => {
      this.planTimer = null;
      if (this.destroyed || !this.isHost) return;
      this.forceUnsubmittedPlans();
    }, wait);
  }

  private forceUnsubmittedPlans(): void {
    if (this.state.phase !== 'playing' || this.state.turnPhase !== 'planning') return;
    let filled = false;
    for (const player of this.state.players.filter(isAlive)) {
      if (this.pendingPlans.has(player.id)) continue;
      this.pendingPlans.set(player.id, STAY_PLAN);
      this.forcedPlans.add(player.id);
      filled = true;
    }
    if (filled) {
      this.state = {
        ...this.state,
        players: this.state.players.map((player) =>
          isAlive(player) && !player.planSubmitted ? { ...player, planSubmitted: true } : player,
        ),
      };
      this.syncState();
      this.scheduleLatePlanResolve();
      return;
    }
    this.tryResolveIfReady();
  }

  private clearPlaybackTimer(): void {
    if (this.playbackTimer !== null) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  private clearBotTimers(): void {
    this.botPlanGeneration += 1;
    for (const timer of this.botTimers) {
      clearTimeout(timer);
    }
    this.botTimers = [];
  }

  private scheduleBotPlans(): void {
    if (!this.isHost) return;
    if (this.state.phase !== 'playing' || this.state.turnPhase !== 'planning') return;
    this.clearBotTimers();
    const generation = this.botPlanGeneration;
    for (const player of this.state.players) {
      if (!player.isBot || !player.connected || !isAlive(player) || player.planSubmitted) continue;
      const delay = 450 + Math.floor(Math.random() * 700);
      const timer = setTimeout(() => {
        if (this.destroyed || !this.isHost || generation !== this.botPlanGeneration) return;
        this.submitBotPlan(player.id);
      }, delay);
      this.botTimers.push(timer);
    }
  }

  private submitBotPlan(playerId: string): void {
    const player = this.state.players.find((entry) => entry.id === playerId);
    if (!player?.isBot) return;
    const carton = cartonSpec(this.state.cartonType);
    const plan = chooseBotPlan(
      player,
      this.state.players,
      closedMapObjects(this.state.mapObjects, this.state.shrinkIndex ?? 0, carton),
      this.state.presents ?? [],
      carton,
      this.state.shrinkIndex ?? 0,
    );
    this.handlePlayerAction(playerId, {
      type: 'submitPlan',
      cardIds: plan.cardIds,
      actions: plan.actions,
    });
  }

  private rejectPlan(playerId: string, message: string): void {
    const connection = this.connections.get(playerId);
    if (connection) {
      this.send({ type: 'error', message }, connection);
      this.send({ type: 'planRejected', message }, connection);
      return;
    }
    if (playerId === this.state.localPlayerId) {
      this.emitError(message);
      this.callbacks.onPlanRejected();
    }
  }

  private syncState(): void {
    for (const [playerId, connection] of this.connections) {
      if (!connection.open) continue;
      this.send({ type: 'stateSync', state: viewStateFor(this.state, playerId) }, connection);
    }
    this.emitState();
  }

  private tryResolveIfReady(): void {
    if (!this.isHost) return;
    if (this.state.phase !== 'playing' || this.state.turnPhase !== 'planning') return;

    const livingPlayers = this.state.players.filter(isAlive);
    if (livingPlayers.length === 0) {
      this.state = {
        ...this.state,
        phase: 'finished',
        outcome: { kind: 'draw' },
      };
      this.syncState();
      return;
    }

    for (const player of livingPlayers) {
      if (this.pendingPlans.has(player.id)) continue;
      if (!player.connected) {
        this.pendingPlans.set(player.id, STAY_PLAN);
        continue;
      }
      return;
    }

    if (this.latePlanTimer !== null && this.forcedPlans.size > 0) return;

    const carton = cartonSpec(this.state.cartonType);
    const result = resolveRound(
      this.state.players,
      this.pendingPlans,
      this.state.mapObjects,
      this.state.eggStains ?? [],
      this.state.presents ?? [],
      carton,
      this.state.shrinkIndex ?? 0,
      this.state.round,
      this.state.startedPlayerCount || this.state.players.length,
    );
    this.clearPendingPlans();
    this.state = applyResolvedRound(this.state, result);
    this.syncState();

    if (result.outcome.kind !== 'none') return;

    this.clearPlaybackTimer();
    const delay = playbackDurationMs(result.timeline);
    this.playbackTimer = setTimeout(() => {
      this.playbackTimer = null;
      if (this.destroyed || !this.isHost) return;
      if (this.state.phase !== 'playing' || this.state.turnPhase !== 'resolving') return;
      this.state = beginPlanningRound(this.state);
      this.syncState();
      this.scheduleBotPlans();
      this.schedulePlanDeadline();
    }, delay);
  }

  private handleSubmitPlan(playerId: string, action: Extract<PlayerAction, { type: 'submitPlan' }>): void {
    if (this.state.phase !== 'playing' || this.state.turnPhase !== 'planning') return;
    const player = this.state.players.find((entry) => entry.id === playerId);
    if (!player?.connected || !isAlive(player)) return;
    const replaceable = this.forcedPlans.has(playerId);
    if ((player.planSubmitted || this.pendingPlans.has(playerId)) && !replaceable) return;

    const carton = cartonSpec(this.state.cartonType);
    const plan = parseAndValidatePlan(
      player,
      action.actions,
      action.cardIds,
      closedMapObjects(this.state.mapObjects, this.state.shrinkIndex ?? 0, carton),
      carton,
    );
    if (!plan) {
      this.rejectPlan(playerId, 'That scramble is not legal.');
      return;
    }

    this.pendingPlans.set(playerId, plan);
    this.forcedPlans.delete(playerId);
    this.state = {
      ...this.state,
      players: this.state.players.map((entry) =>
        entry.id === playerId ? { ...entry, planSubmitted: true } : entry,
      ),
    };
    this.syncState();
    this.tryResolveIfReady();
  }

  private emitState(): void {
    this.callbacks.onStateChange({
      ...viewStateFor(this.state, this.state.localPlayerId),
      localPlayerId: this.state.localPlayerId,
    });
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

  private playerIdForConnection(connection: DataConnection): string | null {
    for (const [playerId, mapped] of this.connections) {
      if (mapped === connection) return playerId;
    }
    return null;
  }

  private isUnavailableIdError(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === 'object' &&
        'type' in error &&
        (error as { type: unknown }).type === 'unavailable-id',
    );
  }

  private async claimHostPeer(roomCode: string): Promise<void> {
    const delays = [800, 1500, 2500];
    let lastError: unknown;
    for (const delay of delays) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (this.destroyed) throw new Error('Room closed.');
      try {
        await this.initHostPeer(roomCode);
        return;
      } catch (error) {
        lastError = error;
        this.peer?.destroy();
        this.peer = null;
        if (!this.isUnavailableIdError(error) && delay === delays[delays.length - 1]) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Could not reclaim the nest.');
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
        reject(new Error('Could not reach the host. Try rolling back into the nest.'));
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
        if (this.isHost) {
          const playerId = this.playerIdForConnection(connection);
          if (playerId) this.handleStart(playerId);
        }
        break;
      case 'playerAction':
        if (this.isHost) {
          const playerId = this.playerIdForConnection(connection);
          if (playerId) this.handlePlayerAction(playerId, message.action);
        }
        break;
      case 'requestState':
        if (this.isHost) {
          const claimedId = message.playerId;
          const occupant = this.state.players.find((player) => player.id === claimedId);
          if (!occupant) break;
          const existing = this.connections.get(claimedId);
          if (existing && existing !== connection && existing.open) break;
          if (occupant.connected && existing && existing !== connection) break;
          this.mapConnectionToPlayer(connection, claimedId);
          this.send(
            { type: 'stateSync', state: viewStateFor(this.state, claimedId) },
            connection,
          );
          this.emitState();
        }
        break;
      case 'joinAck':
        this.state = withLocalId(message.state, message.playerId);
        this.emitState();
        break;
      case 'lobbyUpdate':
        this.updateState({
          players: message.players,
          cartonType: message.cartonType ?? this.state.cartonType,
        });
        break;
      case 'stateSync':
        this.state = withLocalId(message.state, this.state.localPlayerId);
        this.emitState();
        break;
      case 'playerLeft':
        this.updateState({ players: message.players });
        if (this.state.phase !== 'lobby') {
          this.emitNotice('An egg left the scramble.');
        }
        break;
      case 'planRejected':
        this.callbacks.onPlanRejected();
        break;
      case 'notice':
        this.emitNotice(message.message);
        break;
      case 'error':
        this.emitError(message.message);
        break;
      case 'kicked':
        this.callbacks.onKicked(message.message);
        this.destroy();
        break;
      default:
        break;
    }
  }

  private handleJoin(
    message: Extract<RoomMessage, { type: 'join' }>,
    connection: DataConnection,
  ): void {
    const result = applyJoinRequest(this.state.players, message, {
      phase: this.state.phase,
      maxPlayers: cartonSpec(this.state.cartonType).maxPlayers,
    });
    if (!result.ok) {
      this.send({ type: 'error', message: result.error }, connection);
      connection.close();
      return;
    }

    const { player: nextPlayer, players } = result;
    this.state.players = players;
    this.connections.set(nextPlayer.id, connection);
    this.send(
      {
        type: 'joinAck',
        playerId: nextPlayer.id,
        state: viewStateFor(this.state, nextPlayer.id),
      },
      connection,
    );
    this.broadcastLobby();
    this.emitState();
  }

  private broadcastLobby(): void {
    const players = [...this.state.players];
    this.broadcast({
      type: 'lobbyUpdate',
      players,
      cartonType: this.state.cartonType,
    });
    this.emitState();
  }

  private handleStart(startedBy: string): void {
    if (!this.isHost) return;
    if (startedBy !== this.state.hostPlayerId) {
      this.broadcast({
        type: 'notice',
        message: 'Only the host can start the scramble.',
      });
      return;
    }
    const connectedCount = this.state.players.filter((player) => player.connected).length;
    if (connectedCount < MIN_PLAYERS) {
      this.broadcast({
        type: 'notice',
        message: `Need at least ${MIN_PLAYERS} eggs to scramble (${connectedCount}/${cartonSpec(this.state.cartonType).maxPlayers}).`,
      });
      return;
    }
    const carton = cartonSpec(this.state.cartonType);
    if (connectedCount > carton.maxPlayers) {
      this.broadcast({
        type: 'notice',
        message: `That carton only holds ${carton.maxPlayers} eggs.`,
      });
      return;
    }
    if (this.state.phase !== 'lobby' && this.state.phase !== 'finished') return;
    this.clearPendingPlans();
    this.clearPlaybackTimer();
    this.clearBotTimers();
    this.clearPlanTimer();
    this.state = startMatch(this.state);
    this.syncState();
    this.scheduleBotPlans();
    this.schedulePlanDeadline();
  }

  private handlePlayerAction(playerId: string, action: PlayerAction): void {
    if (!this.isHost) return;
    if (action.type === 'submitPlan') {
      this.handleSubmitPlan(playerId, action);
      return;
    }
    const next = applyPlayerAction(this.state, playerId, action);
    if (next === this.state) return;
    this.clearPlaybackTimer();
    this.clearBotTimers();
    this.clearPlanTimer();
    this.clearPendingPlans();
    this.state = next;
    this.syncState();
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
    for (const [viewerId, connection] of this.connections) {
      this.send(
        {
          type: 'playerLeft',
          playerId,
          players: hideOtherHands([...this.state.players], viewerId),
        },
        connection,
      );
    }
    if (this.state.phase !== 'lobby') {
      this.emitNotice(`${player.name} left the scramble.`);
    }
    this.emitState();
    this.tryResolveIfReady();
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

    const remaining = this.state.players.filter((player) => player.connected && !player.isBot);
    if (remaining.length === 0) {
      this.emitError('Everyone flew the nest.');
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
    this.emitNotice('You are now the host.');
    this.clearPlaybackTimer();
    this.clearBotTimers();
    this.clearPlanTimer();
    this.clearPendingPlans();
    this.state = resetPlanningAfterHandoff(this.state);
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    this.hostConnection = null;
    this.peer?.destroy();
    this.isHost = true;

    await this.claimHostPeer(this.state.roomCode);
    this.emitState();
    this.scheduleBotPlans();
    this.schedulePlanDeadline();
  }

  private mapConnectionToPlayer(connection: DataConnection, playerId: string): void {
    this.connections.set(playerId, connection);
    this.state.players = this.state.players.map((player) =>
      player.id === playerId ? { ...player, connected: true } : player,
    );
  }

  private async reconnectToHost(): Promise<void> {
    this.emitNotice('The host changed. Reconnecting…');
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
        : 'Reconnection failed. Try rolling back into the nest.';
    this.emitError(message);
  }
}
