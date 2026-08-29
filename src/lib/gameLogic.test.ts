import { describe, expect, it } from 'vitest';
import type { Player } from '../types/game';
import {
  applyJoinRequest,
  createInitialPlayer,
  markDisconnected,
} from './gameLogic';

function player(id: string, name: string, joinOrder: number, connected = true): Player {
  return { ...createInitialPlayer(id, name, joinOrder), connected };
}

describe('applyJoinRequest', () => {
  it('adds a new player in the lobby', () => {
    const host = player('host', 'Joe', 0);
    const result = applyJoinRequest([host], { playerId: 'phone', name: 'Phone' }, {
      phase: 'lobby',
      maxPlayers: 4,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.player).toMatchObject({ id: 'phone', name: 'Phone', connected: true });
    expect(result.players.map((entry) => entry.id)).toEqual(['host', 'phone']);
  });

  it('reclaims a disconnected seat and uses the new name', () => {
    const host = player('host', 'Joe', 0);
    const rolledOff = markDisconnected(player('phone', 'Phone', 1));
    const result = applyJoinRequest(
      [host, rolledOff],
      { playerId: 'phone', name: 'Handset' },
      { phase: 'lobby', maxPlayers: 4 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.player).toMatchObject({ id: 'phone', name: 'Handset', connected: true, joinOrder: 1 });
    expect(result.players).toHaveLength(2);
    expect(result.players[1]?.name).toBe('Handset');
  });

  it('lets a kicked player join again as a new seat with their new name', () => {
    const host = player('host', 'Joe', 0);
    const result = applyJoinRequest([host], { playerId: 'fresh', name: 'Handset' }, {
      phase: 'lobby',
      maxPlayers: 4,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.player).toMatchObject({ id: 'fresh', name: 'Handset' });
    expect(result.players.map((entry) => entry.name)).toEqual(['Joe', 'Handset']);
  });

  it('does not reclaim a different disconnected player just because names match', () => {
    const host = player('host', 'Joe', 0);
    const other = markDisconnected(player('other', 'Phone', 1));
    const result = applyJoinRequest(
      [host, other],
      { playerId: 'fresh', name: 'Phone' },
      { phase: 'lobby', maxPlayers: 4 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.player.id).toBe('fresh');
    expect(result.players).toHaveLength(3);
    expect(result.players.find((entry) => entry.id === 'other')?.connected).toBe(false);
  });

  it('rejects a rejoin that takes a connected player’s name', () => {
    const host = player('host', 'Joe', 0);
    const rolledOff = markDisconnected(player('phone', 'Phone', 1));
    const result = applyJoinRequest(
      [host, rolledOff],
      { playerId: 'phone', name: 'Joe' },
      { phase: 'lobby', maxPlayers: 4 },
    );

    expect(result).toEqual({ ok: false, error: 'That egg name is already taken.' });
  });
});
