import { useId, useRef } from 'react';
import { formatWeapon, WEAPON_STATS } from '../lib/arenaLogic';
import type { WeaponKind } from '../types/game';

const EGGSPLANATION_WEAPONS: WeaponKind[] = [
  'pistol',
  'slap',
  'rifle',
  'shotgun',
  'bomb',
  'flamethrower',
];

function actionDetail(kind: WeaponKind): string {
  const { range, damage } = WEAPON_STATS[kind];
  const hit = `${damage} damage`;
  if (kind === 'slap') return `next-door fan · ${hit}`;
  if (kind === 'flamethrower') return `2-square fan · ${hit}`;
  if (kind === 'bomb') return `2-away splash · ${hit}`;
  if (!Number.isFinite(range)) return `unlimited · ${hit}`;
  return `${range} range · ${hit}`;
}

export function Eggsplanation() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const open = () => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
  };

  const closeOnBackdrop = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      event.currentTarget.close();
    }
  };

  return (
    <>
      <button type="button" className="btn btn-lime eggsplanation-open" onClick={open}>
        <svg className="eggsplanation-i" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <circle cx="12" cy="7.65" r="1.45" fill="currentColor" />
          <rect x="10.75" y="10.35" width="2.5" height="6.5" rx="1.25" fill="currentColor" />
        </svg>
        Eggsplanation
      </button>

      <dialog
        ref={dialogRef}
        className="eggsplanation-dialog"
        aria-labelledby={titleId}
        onClick={closeOnBackdrop}
      >
        <form method="dialog" className="panel eggsplanation-panel">
          <header className="eggsplanation-head">
            <h2 id={titleId}>Eggsplanation</h2>
            <button type="submit" className="eggsplanation-close" aria-label="Close">
              <svg viewBox="0 0 32 32" aria-hidden="true">
                <path
                  d="M9 9 L23 23 M23 9 L9 23"
                  fill="none"
                  stroke="#111"
                  strokeWidth="10"
                  strokeLinecap="round"
                />
                <path
                  d="M9 9 L23 23 M23 9 L9 23"
                  fill="none"
                  stroke="var(--hit)"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>

          <div className="eggsplanation-body">
            <ul className="eggsplanation-list">
              <li className="eggsplanation-item">
                <h3>The scramble</h3>
                <p>
                  You’re an egg with 3 HP. Each round, pick two moves — walk, sit
                  tight, or an action. Last egg uncracked hatches.
                </p>
              </li>
              <li className="eggsplanation-item">
                <h3>Whole carton at once</h3>
                <p>
                  Nobody waits their turn. The whole carton plans together, then
                  the scramble plays out at once.
                </p>
              </li>
              <li className="eggsplanation-item">
                <h3>Move order</h3>
                <p>
                  Walks go first — everyone steps together, one square at a
                  time. Sit stays put. Then the actions crack.
                </p>
              </li>
              <li className="eggsplanation-item">
                <h3>Actions</h3>
                <p>
                  You always pack a pistol — you can fire it on both of your
                  moves. A present adds one spare. You keep that spare until
                  another present replaces it, but you can only fire it once
                  per round. Aim a direction; shots go after the walks.
                </p>
                <ul className="eggsplanation-actions">
                  {EGGSPLANATION_WEAPONS.map((kind) => (
                    <li key={kind}>
                      <span className="eggsplanation-action-name">{formatWeapon(kind)}</span>
                      <span className="eggsplanation-action-stat">{actionDetail(kind)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            </ul>
          </div>

          <button type="submit" className="btn btn-primary">
            Crack on
          </button>
        </form>
      </dialog>
    </>
  );
}
