import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BOARD_SIZE,
  DIR_DELTA,
  MAX_WALK_STEPS,
  STARTING_HP,
  type ArenaAction,
  type Cell,
  type GameState,
  type PlaybackEvent,
  type RoundStartToken,
} from '../types/game';
import {
  cellsEqual,
  directionFromRay,
  eventDurationMs,
  formatAction,
  groupTimeline,
  isAdjacent8,
  isAlive,
  isObjectCell,
  isOnBoard,
  neighbors8,
  parseAndValidatePlan,
  plannedPositionAfter,
  playerColor,
  shotRayCells,
} from '../lib/arenaLogic';
import { PlayerToken } from './PlayerToken';

interface ArenaProps {
  state: GameState;
  isHost: boolean;
  onSubmitPlan: (actions: [ArenaAction, ArenaAction]) => void;
  onReturnToLobby: () => void;
}

type PlanMode = 'stay' | 'walk' | 'shoot';
type OverlayTone = 'active' | 'muted';

interface Beam {
  from: Cell;
  end: Cell;
  shooterId: string;
}

interface Token {
  id: string;
  name: string;
  joinOrder: number;
  row: number;
  col: number;
  hp: number;
  connected: boolean;
  isBot: boolean;
  planSubmitted: boolean;
  isYou: boolean;
  isHost: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function tokensFromState(state: GameState): Token[] {
  return state.players.map((player) => ({
    id: player.id,
    name: player.name,
    joinOrder: player.joinOrder,
    row: player.row,
    col: player.col,
    hp: player.hp,
    connected: player.connected,
    isBot: player.isBot,
    planSubmitted: player.planSubmitted,
    isYou: player.id === state.localPlayerId,
    isHost: player.id === state.hostPlayerId,
  }));
}

function tokensFromSnapshot(state: GameState, snapshot: RoundStartToken[] | null): Token[] {
  const byId = new Map(state.players.map((player) => [player.id, player]));
  if (!snapshot) return tokensFromState(state);
  return snapshot.map((token) => {
    const player = byId.get(token.id);
    return {
      id: token.id,
      name: player?.name ?? 'Player',
      joinOrder: player?.joinOrder ?? 0,
      row: token.row,
      col: token.col,
      hp: token.hp,
      connected: player?.connected ?? true,
      isBot: player?.isBot ?? false,
      planSubmitted: player?.planSubmitted ?? false,
      isYou: token.id === state.localPlayerId,
      isHost: token.id === state.hostPlayerId,
    };
  });
}

function shotCaption(tokens: Token[], frame: PlaybackEvent[], actionIndex: number): string {
  const shots = frame.flatMap((event) => (event.type === 'shot' ? [event] : []));
  if (shots.length === 0) return `Move ${actionIndex + 1} · shots`;
  const labels = shots.map((shot) => {
    const name = tokens.find((token) => token.id === shot.shooterId)?.name ?? 'Someone';
    return `${name} ${shot.dir}`;
  });
  return `Move ${actionIndex + 1} · ${labels.join(' · ')}`;
}

function applyEvent(tokens: Token[], event: PlaybackEvent): Token[] {
  switch (event.type) {
    case 'move':
      return tokens.map((token) =>
        token.id === event.playerId ? { ...token, row: event.to.row, col: event.to.col } : token,
      );
    case 'hit':
      return tokens.map((token) =>
        token.id === event.playerId ? { ...token, hp: event.hpAfter } : token,
      );
    default:
      return tokens;
  }
}

async function runPlayback(options: {
  timeline: PlaybackEvent[];
  startTokens: Token[];
  cancelled: () => boolean;
  setTokens: (tokens: Token[]) => void;
  setBeams: (beams: Beam[]) => void;
  setFlashIds: (ids: string[]) => void;
  setShootingIds: (ids: string[]) => void;
  setStatus: (status: string) => void;
}): Promise<void> {
  let current = options.startTokens;
  let actionIndex = 0;
  for (const frame of groupTimeline(options.timeline)) {
    if (options.cancelled()) return;
    const first = frame[0];
    if (first.type === 'actionStart') {
      actionIndex = first.actionIndex;
      options.setShootingIds([]);
      options.setStatus(`Move ${actionIndex + 1}`);
    } else if (first.type === 'beat') {
      actionIndex = first.actionIndex;
      options.setBeams([]);
      options.setFlashIds([]);
      options.setShootingIds([]);
      options.setStatus(`Move ${actionIndex + 1} · step ${first.beat + 1}`);
    } else if (first.type === 'shot') {
      const shots = frame.flatMap((event) =>
        event.type === 'shot'
          ? [{ from: event.from, end: event.end, shooterId: event.shooterId }]
          : [],
      );
      options.setBeams(shots);
      options.setShootingIds(shots.map((shot) => shot.shooterId));
      options.setStatus(shotCaption(current, frame, actionIndex));
    } else if (first.type === 'hit' || first.type === 'death') {
      options.setFlashIds(
        frame.flatMap((event) =>
          event.type === 'hit' || event.type === 'death' ? [event.playerId] : [],
        ),
      );
    }
    current = frame.reduce(applyEvent, current);
    options.setTokens(current);
    const duration = Math.max(...frame.map(eventDurationMs));
    if (duration > 0) await sleep(duration);
    if (options.cancelled()) return;
  }
}

function onRay(from: Cell, end: Cell, cell: Cell): boolean {
  const dir = directionFromRay(from, end);
  if (!dir) return cellsEqual(from, cell);
  let cursor = { ...from };
  const seen = new Set<string>();
  while (isOnBoard(cursor) && !seen.has(`${cursor.row},${cursor.col}`)) {
    if (cellsEqual(cursor, cell) && !cellsEqual(cursor, from)) return true;
    if (cellsEqual(cursor, end)) break;
    seen.add(`${cursor.row},${cursor.col}`);
    const delta = DIR_DELTA[dir];
    cursor = { row: cursor.row + delta.dr, col: cursor.col + delta.dc };
  }
  return false;
}

export function Arena({ state, isHost, onSubmitPlan, onReturnToLobby }: ArenaProps) {
  const local = state.players.find((player) => player.id === state.localPlayerId);
  const localAlive = Boolean(local && isAlive(local));
  const planning = state.phase === 'playing' && state.turnPhase === 'planning';

  const [draft, setDraft] = useState<[ArenaAction | null, ArenaAction | null]>([null, null]);
  const [slot, setSlot] = useState<0 | 1>(0);
  const [mode, setMode] = useState<PlanMode>('walk');
  const [localLocked, setLocalLocked] = useState(false);
  const [tokens, setTokens] = useState<Token[]>(() => tokensFromState(state));
  const [beams, setBeams] = useState<Beam[]>([]);
  const [flashIds, setFlashIds] = useState<string[]>([]);
  const [shootingIds, setShootingIds] = useState<string[]>([]);
  const [replayDone, setReplayDone] = useState(true);
  const [watchingLast, setWatchingLast] = useState(false);
  const [status, setStatus] = useState('');
  const watchGen = useRef(0);
  const canPlan = planning && localAlive && !local?.planSubmitted && !localLocked && !watchingLast;

  useEffect(() => {
    setDraft([null, null]);
    setSlot(0);
    setMode('walk');
    setLocalLocked(false);
  }, [state.round, local?.id]);

  useEffect(() => {
    if (state.turnPhase === 'resolving' && state.timeline.length > 0) return;
    if (watchingLast) return;
    setTokens(tokensFromState(state));
    setBeams([]);
    setFlashIds([]);
    setShootingIds([]);
    setReplayDone(true);
    setStatus('');
  }, [state.players, state.turnPhase, state.timeline.length, watchingLast]);

  const playbackKey = `${state.round}:${state.turnPhase}:${JSON.stringify(state.timeline)}`;

  useEffect(() => {
    let cancelled = false;

    if (state.turnPhase !== 'resolving' || state.timeline.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    watchGen.current += 1;
    setWatchingLast(false);
    setReplayDone(false);
    setTokens(tokensFromSnapshot(state, state.roundStart));
    setBeams([]);
    setFlashIds([]);
    setShootingIds([]);

    const play = async () => {
      await runPlayback({
        timeline: state.timeline,
        startTokens: tokensFromSnapshot(state, state.roundStart),
        cancelled: () => cancelled,
        setTokens,
        setBeams,
        setFlashIds,
        setShootingIds,
        setStatus,
      });
      if (cancelled) return;
      setTokens(tokensFromState(state));
      setBeams([]);
      setFlashIds([]);
      setShootingIds([]);
      setStatus('');
      setReplayDone(true);
    };

    void play();
    return () => {
      cancelled = true;
    };
  }, [playbackKey]);

  const origin = useMemo<Cell>(() => {
    if (!local) return { row: 0, col: 0 };
    const start = { row: local.row, col: local.col };
    if (slot === 0) return start;
    return plannedPositionAfter(start, draft[0]);
  }, [local, slot, draft]);

  const walkPath = draft[slot]?.type === 'walk' ? draft[slot].path : [];
  const walkTip = walkPath[walkPath.length - 1] ?? origin;
  const validWalk =
    canPlan && mode === 'walk'
      ? neighbors8(walkTip).filter((cell) => !isObjectCell(cell, state.mapObjects))
      : [];

  const walkTones = useMemo(() => {
    const tones = new Map<string, OverlayTone>();
    ([0, 1] as const).forEach((index) => {
      const action = draft[index];
      if (action?.type !== 'walk') return;
      const editingThisWalk = slot === index && mode === 'walk';
      const tone: OverlayTone = editingThisWalk ? 'active' : 'muted';
      for (const cell of action.path) {
        const key = `${cell.row},${cell.col}`;
        if (tone === 'active' || tones.get(key) !== 'active') tones.set(key, tone);
      }
    });
    return tones;
  }, [draft, slot, mode]);

  const aimTones = useMemo(() => {
    const tones = new Map<string, OverlayTone>();
    if (!local) return tones;
    const start = { row: local.row, col: local.col };
    ([0, 1] as const).forEach((index) => {
      const action = draft[index];
      if (action?.type !== 'shoot') return;
      const from = index === 0 ? start : plannedPositionAfter(start, draft[0]);
      const editingThisShot = slot === index && mode === 'shoot';
      const tone: OverlayTone = editingThisShot ? 'active' : 'muted';
      for (const cell of shotRayCells(from, action.dir, state.mapObjects)) {
        const key = `${cell.row},${cell.col}`;
        if (tone === 'active' || tones.get(key) !== 'active') tones.set(key, tone);
      }
    });
    return tones;
  }, [draft, slot, local, mode, state.mapObjects]);

  const legalPlan = local ? parseAndValidatePlan(local, draft, state.mapObjects) : null;
  const livingCount = state.players.filter(isAlive).length;
  const submittedCount =
    state.players.filter((player) => isAlive(player) && player.planSubmitted).length +
    (localLocked && localAlive && !local?.planSubmitted ? 1 : 0);

  const setAction = (index: 0 | 1, action: ArenaAction | null) => {
    setDraft((current) => {
      const next: [ArenaAction | null, ArenaAction | null] = [...current];
      next[index] = action;
      if (index === 0 && current[1]?.type === 'walk' && local) {
        const start = { row: local.row, col: local.col };
        const after = plannedPositionAfter(start, action);
        if (!parseAndValidatePlan(local, [action, current[1]], state.mapObjects)) {
          next[1] = null;
        } else if (current[1].path[0] && !isAdjacent8(after, current[1].path[0])) {
          next[1] = null;
        }
      }
      return next;
    });
  };

  const chooseMode = (nextMode: PlanMode) => {
    const current = draft[slot];
    const firstFilled =
      slot === 0 && current !== null && current.type !== nextMode && draft[1] === null;

    if (firstFilled) {
      setSlot(1);
      setMode(nextMode);
      if (nextMode === 'stay') setAction(1, { type: 'stay' });
      else setAction(1, null);
      return;
    }

    setMode(nextMode);
    if (nextMode === 'stay') setAction(slot, { type: 'stay' });
    if (nextMode === 'walk' && current?.type !== 'walk') setAction(slot, null);
    if (nextMode === 'shoot' && current?.type !== 'shoot') setAction(slot, null);
  };

  const handleCellClick = (cell: Cell) => {
    if (!canPlan) return;
    if (mode === 'walk') {
      if (walkPath.length >= MAX_WALK_STEPS) return;
      if (!isAdjacent8(walkTip, cell) || !isOnBoard(cell) || isObjectCell(cell, state.mapObjects)) {
        return;
      }
      setAction(slot, { type: 'walk', path: [...walkPath, cell] });
      return;
    }
    if (mode === 'shoot') {
      const dir = directionFromRay(origin, cell);
      if (dir) setAction(slot, { type: 'shoot', dir });
    }
  };

  const resetAction = () => {
    if (!canPlan) return;
    setAction(slot, null);
  };

  const lockIn = () => {
    if (!legalPlan) return;
    setLocalLocked(true);
    onSubmitPlan(legalPlan);
  };

  const watchLastTurn = () => {
    const replay = state.lastReplay;
    if (!replay || watchingLast) return;
    const gen = watchGen.current + 1;
    watchGen.current = gen;
    setWatchingLast(true);
    setReplayDone(false);
    setBeams([]);
    setFlashIds([]);
    setShootingIds([]);
    const startTokens = tokensFromSnapshot(state, replay.roundStart);
    setTokens(startTokens);
    void (async () => {
      await runPlayback({
        timeline: replay.timeline,
        startTokens,
        cancelled: () => watchGen.current !== gen,
        setTokens,
        setBeams,
        setFlashIds,
        setShootingIds,
        setStatus,
      });
      if (watchGen.current !== gen) return;
      setTokens(tokensFromState(state));
      setBeams([]);
      setFlashIds([]);
      setShootingIds([]);
      setStatus('');
      setWatchingLast(false);
      setReplayDone(true);
    })();
  };

  const showOutcome = state.phase === 'finished' && replayDone && !watchingLast;
  const winnerId = state.outcome.kind === 'winner' ? state.outcome.playerId : null;
  const winner = winnerId
    ? state.players.find((player) => player.id === winnerId)
    : undefined;
  const canReplayLast =
    Boolean(state.lastReplay) &&
    (planning || (state.phase === 'finished' && replayDone)) &&
    !watchingLast;

  const plannerHint = !localAlive
    ? 'You’re out. Watch the rest of the grid.'
    : local?.planSubmitted || localLocked
      ? 'Locked. Waiting on the rest.'
      : watchingLast
        ? status || 'Watching the last round…'
        : !planning
          ? status || 'Watching the grid…'
          : mode === 'stay'
            ? 'Stay put this beat. They might walk into you.'
            : mode === 'walk'
              ? 'Tap any of the 8 neighbors. Up to 3 steps. Walls block movement and shots.'
              : 'Tap a cell on the line you want. The ray lights up on the grid.';

  const showPlanner = state.phase === 'playing';

  return (
    <div className="arena">
      <div className="arena-status-row">
        <p className="arena-kicker">
          {state.phase === 'finished'
            ? 'That’s a wrap'
            : planning
              ? `Round ${state.round}`
              : `Round ${state.round} · playing out`}
        </p>
        <p className="arena-meta-inline">
          {watchingLast
            ? status || `Watching round ${state.lastReplay?.round ?? ''}`
            : planning
              ? `${submittedCount}/${livingCount} locked`
              : status || (replayDone ? 'Moves played out' : 'Watching the grid…')}
        </p>
      </div>

      <ul className="arena-hud">
        {tokens.map((player) => (
          <li
            key={player.id}
            className={`arena-hud-seat${player.isYou ? ' is-you' : ''}${
              player.hp <= 0 ? ' is-down' : ''
            }${shootingIds.includes(player.id) ? ' is-shooting' : ''}`}
          >
            <span
              className="arena-hud-swatch"
              style={{ background: playerColor(player.joinOrder) }}
            />
            <span className="arena-hud-name">
              {player.name}
              {player.isYou ? ' (you)' : ''}
            </span>
            <span className="arena-hp" aria-label={`${player.hp} HP`}>
              {Array.from({ length: STARTING_HP }, (_, index) => (
                <span key={index} className={index < player.hp ? 'pip on' : 'pip'} />
              ))}
            </span>
            <span className="arena-hud-note">
              {shootingIds.includes(player.id)
                ? 'shooting'
                : !player.connected
                  ? 'away'
                  : planning && (player.planSubmitted || (player.isYou && localLocked))
                    ? 'locked'
                    : player.isBot
                      ? 'bot'
                      : ''}
            </span>
          </li>
        ))}
      </ul>

      <div className="arena-board-wrap">
        <div className="arena-board" style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }}>
          {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
            const row = Math.floor(index / BOARD_SIZE);
            const col = index % BOARD_SIZE;
            const cell = { row, col };
            const cellKey = `${row},${col}`;
            const walkTone = walkTones.get(cellKey);
            const aimTone = aimTones.get(cellKey);
            const pathIndex = (() => {
              const firstPath = draft[0]?.type === 'walk' ? draft[0].path : [];
              const secondPath = draft[1]?.type === 'walk' ? draft[1].path : [];
              const firstIdx = firstPath.findIndex((step) => cellsEqual(step, cell));
              const secondIdx = secondPath.findIndex((step) => cellsEqual(step, cell));
              const editingSecond = slot === 1 && mode === 'walk';
              if (editingSecond && secondIdx >= 0) return firstPath.length + secondIdx;
              if (firstIdx >= 0) return firstIdx;
              if (secondIdx >= 0) return firstPath.length + secondIdx;
              return -1;
            })();
            const isValid = validWalk.some((step) => cellsEqual(step, cell));
            const isOrigin = canPlan && cellsEqual(origin, cell);
            const hasBlock = isObjectCell(cell, state.mapObjects);
            const occupants = tokens
              .filter((token) => token.row === row && token.col === col)
              .sort((a, b) => a.hp - b.hp);
            const beam = beams.find((ray) => onRay(ray.from, ray.end, cell));
            const beamShooter = beam
              ? tokens.find((token) => token.id === beam.shooterId)
              : undefined;

            return (
              <button
                key={`${row}-${col}`}
                type="button"
                className={`arena-cell${(row + col) % 2 === 0 ? ' shade' : ''}${
                  walkTone === 'muted' ? ' on-path-muted' : ''
                }${aimTone === 'muted' ? ' on-aim-muted' : ''}${
                  walkTone === 'active' ? ' on-path' : ''
                }${aimTone === 'active' ? ' on-aim' : ''}${
                  isValid ? ' is-valid' : ''
                }${isOrigin ? ' is-origin' : ''}${beam ? ' on-beam' : ''}${
                  hasBlock ? ' has-block' : ''
                }`}
                style={
                  beamShooter
                    ? ({ '--beam': playerColor(beamShooter.joinOrder) } as React.CSSProperties)
                    : undefined
                }
                onClick={() => handleCellClick(cell)}
                disabled={!canPlan}
              >
                {pathIndex >= 0 && <span className="path-index">{pathIndex + 1}</span>}
                {hasBlock && <BlockMark />}
                {occupants.map((token) => (
                  <PlayerToken
                    key={token.id}
                    joinOrder={token.joinOrder}
                    name={token.name}
                    isYou={token.isYou}
                    isDown={token.hp <= 0}
                    isHit={flashIds.includes(token.id)}
                    isShooting={shootingIds.includes(token.id)}
                  />
                ))}
              </button>
            );
          })}
        </div>
      </div>

      {showPlanner && (
        <div className="arena-planner">
          <div className="action-slots">
            {([0, 1] as const).map((index) => (
              <button
                key={index}
                type="button"
                className={`action-slot${slot === index ? ' is-active' : ''}`}
                disabled={!canPlan}
                onClick={() => {
                  setSlot(index);
                  const action = draft[index];
                  setMode(action?.type ?? 'walk');
                }}
              >
                <span className="action-slot-label">Move {index + 1}</span>
                <span>{formatAction(draft[index])}</span>
              </button>
            ))}
          </div>

          <div className="mode-row">
            <button
              type="button"
              className={`btn btn-secondary${mode === 'stay' ? ' is-selected' : ''}`}
              disabled={!canPlan}
              onClick={() => chooseMode('stay')}
            >
              Sit
            </button>
            <button
              type="button"
              className={`btn btn-secondary${mode === 'walk' ? ' is-selected' : ''}`}
              disabled={!canPlan}
              onClick={() => chooseMode('walk')}
            >
              Walk
            </button>
            <button
              type="button"
              className={`btn btn-secondary${mode === 'shoot' ? ' is-selected' : ''}`}
              disabled={!canPlan}
              onClick={() => chooseMode('shoot')}
            >
              Shoot
            </button>
          </div>

          <p className="arena-hint">{plannerHint}</p>

          <div className="planner-actions">
            <div className="planner-tools">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!canPlan}
                onClick={resetAction}
              >
                Reset
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!canReplayLast}
                onClick={watchLastTurn}
              >
                Replay
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canPlan || !legalPlan}
              onClick={lockIn}
            >
              Lock it in
            </button>
          </div>
        </div>
      )}

      {showOutcome && (
        <div className="arena-outcome">
          <p className="arena-kicker">
            {state.outcome.kind === 'winner'
              ? `${winner?.name ?? 'Someone'} called it`
              : 'Dead heat'}
          </p>
          <p className="arena-copy">
            {state.outcome.kind === 'winner'
              ? `${winner?.hp ?? 0} HP still on the board.`
              : 'Last survivors dropped on the same beat.'}
          </p>
        </div>
      )}

      {state.phase === 'finished' && isHost && replayDone && !watchingLast && (
        <div className="replay-row">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!canReplayLast}
            onClick={watchLastTurn}
          >
            Replay
          </button>
          <button type="button" className="btn btn-primary" onClick={onReturnToLobby}>
            Back to the room
          </button>
        </div>
      )}

      {state.phase === 'finished' && !isHost && replayDone && !watchingLast && (
        <div className="replay-row">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!canReplayLast}
            onClick={watchLastTurn}
          >
            Replay
          </button>
          <p className="arena-copy">Host is sending everyone back to the room.</p>
        </div>
      )}
    </div>
  );
}

function BlockMark() {
  return (
    <span className="arena-block" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <rect x="2" y="2" width="28" height="28" rx="3" fill="#7a756f" stroke="#111" strokeWidth="2.4" />
        <path
          d="M2 11 H30 M2 20 H30 M11 2 V11 M22 11 V20 M11 20 V30 M22 2 V11"
          fill="none"
          stroke="#111"
          strokeWidth="1.6"
        />
        <rect x="4" y="4" width="6" height="6" rx="1" fill="#959089" />
        <rect x="13" y="13" width="6" height="6" rx="1" fill="#959089" />
        <rect x="22" y="22" width="6" height="6" rx="1" fill="#959089" />
      </svg>
    </span>
  );
}
