const STORAGE_KEY = 'random_game_player_id';

export function getOrCreatePlayerId(): string {
  const existing = sessionStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const id = crypto.randomUUID();
  sessionStorage.setItem(STORAGE_KEY, id);
  return id;
}

export function clearPlayerId(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
