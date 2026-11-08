import { motion, useAnimate } from 'motion/react';
import { memo, useEffect, useRef } from 'react';
import type { GameSession } from '../../core/game/game-state';
import type { LanguageEngine } from '../../core/localization/localization-engine';
import { SHAKE_TRANSITION, SHAKE_X } from '../../styles/motion';
import type { LetterResult } from '../../types';

interface TileProps {
  letter: string;
  result?: LetterResult;
  index: number;
  revealing?: boolean;
  bounce?: boolean;
  hinted?: boolean;
  label: string;
}

/**
 * One tile. Pure CSS animations (pop / flip / bounce) — cheap enough for 30 tiles at 60fps
 * and fully driven by design tokens, so reduced-motion collapses them automatically.
 */
const Tile = memo(function Tile({ letter, result, index, revealing, bounce, hinted, label }: TileProps) {
  const cls = ['tile'];
  if (hinted) cls.push('tile--hinted');
  else if (letter && !result) cls.push('tile--filled', 'tile--pop');
  if (result) cls.push(`tile--${result}`, revealing ? 'tile--revealing' : 'tile--settled');
  if (bounce) cls.push('tile--bounce');
  return (
    <div className={cls.join(' ')} style={{ ['--i' as string]: index }} role="gridcell" aria-label={label}>
      {letter}
      <span className="tile__mark" aria-hidden />
    </div>
  );
});

interface BoardProps {
  session: GameSession;
  engine: LanguageEngine;
  revealingRow: number | null;
  shakeTick: number;
  celebrateTick: number;
  resultLabel: (r: LetterResult) => string;
}

export function Board({ session, engine, revealingRow, shakeTick, celebrateTick, resultLabel }: BoardProps) {
  const { rows, current, maxAttempts, length, hints, status } = session;
  const [scope, animate] = useAnimate();
  const firstShake = useRef(shakeTick);

  useEffect(() => {
    if (shakeTick === firstShake.current || !scope.current) return;
    void animate(scope.current, { x: SHAKE_X }, SHAKE_TRANSITION);
  }, [shakeTick, animate, scope]);

  const hintAt = new Map<number, string>();
  for (const h of hints) if (h.position !== undefined && h.letter) hintAt.set(h.position, h.letter);
  const winRow = status === 'WON' || (status === 'COMPLETED' && rows.at(-1)?.results.every((r) => r === 'correct')) ? rows.length - 1 : -1;
  const bouncing = celebrateTick > 0 && revealingRow === null && winRow >= 0;

  return (
    <div
      className="board"
      dir={engine.dir}
      role="grid"
      aria-label="Board"
      style={{ ['--rows' as string]: maxAttempts, ['--cols' as string]: length }}
    >
      {Array.from({ length: maxAttempts }, (_, r) => {
        const row = rows[r];
        const isCurrent = r === rows.length && status === 'PLAYING';
        const letters = row ? row.letters : isCurrent ? current : [];
        const tiles = Array.from({ length }, (_, i) => {
          const l = letters[i] ?? '';
          const res = row?.results[i];
          const ghost = isCurrent && !l && hintAt.has(i);
          const shown = l ? engine.display(l) : ghost ? engine.display(hintAt.get(i)!) : '';
          return (
            <Tile
              key={isCurrent ? `${i}-${l}` : i}
              letter={shown}
              result={res}
              index={i}
              revealing={r === revealingRow}
              bounce={bouncing && r === winRow}
              hinted={ghost}
              label={shown ? `${shown}${res ? `, ${resultLabel(res)}` : ''}` : '—'}
            />
          );
        });
        return isCurrent ? (
          <motion.div key={r} ref={scope} className="board__row" role="row">
            {tiles}
          </motion.div>
        ) : (
          <div key={r} className="board__row" role="row">
            {tiles}
          </div>
        );
      })}
    </div>
  );
}
