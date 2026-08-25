import { useId, useRef } from 'react';

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
        <span className="eggsplanation-i" aria-hidden="true">
          i
        </span>
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
              ×
            </button>
          </header>

          <ul className="eggsplanation-list">
            <li className="eggsplanation-item">
              <h3>How to play</h3>
              <p>
                You’re an egg with 3 HP. Each round, pick two moves — walk, sit, or
                shoot. Last egg standing wins.
              </p>
            </li>
            <li className="eggsplanation-item">
              <h3>Everyone goes at once</h3>
              <p>
                Nobody waits their turn. The whole carton plans at the same time,
                then those two moves play out together.
              </p>
            </li>
            <li className="eggsplanation-item">
              <h3>Beats</h3>
              <p>
                The round ticks in beats, like a shared metronome. If you walk,
                each step is one beat. Sit, shoot, and other actions happen at the
                end of a beat, so everyone acts on the same tick.
              </p>
            </li>
          </ul>

          <button type="submit" className="btn btn-primary">
            Got it
          </button>
        </form>
      </dialog>
    </>
  );
}
