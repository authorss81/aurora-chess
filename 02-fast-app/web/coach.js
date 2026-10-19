// Move grading, shared by the app and the tests.
//
// This lives in its own module on purpose. The grading rules first lived inline
// in index.html, and coach-test.mjs kept a copy of them. When the bands changed
// to winning chance the test kept testing the old copy and still went green -
// which is worse than having no test, because it looked like coverage.
//
// Sources:
//   https://lichess.org/page/accuracy
//   https://lichess.org/forum/lichess-feedback/definition-of-blundermistakeinaccuracy

/**
 * Centipawns -> percentage chance of winning.
 *
 * Saturates at both ends, which is the whole point. Raw centipawn loss is the
 * wrong measure: dropping 200cp from dead equal to two pawns down is a disaster,
 * while dropping the same 200cp from +9 to +7, still completely winning, is
 * nothing. A system built on raw centipawns treats those identically and gets
 * the second one badly wrong.
 */
export function winPercent(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/**
 * Per-move accuracy from the drop in winning chance, in percent.
 * Lichess's formula; a move that gives nothing away scores 100.
 */
export function moveAccuracy(winBefore, winAfter) {
  const a = 103.1668 * Math.exp(-0.04354 * (winBefore - winAfter)) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

/**
 * Labels come from how much winning chance the move gave away, as percentage
 * points. Thresholds follow lichess: 10% is an inaccuracy, 20% a mistake, and
 * anything beyond that a blunder.
 */
export const COACH_BANDS = [
  { max: 0.5,      key: 'best',  label: 'Best move',   cls: 'b-best',  short: '!!' },
  { max: 2,        key: 'excl',  label: 'Excellent',   cls: 'b-good',  short: '!'  },
  { max: 5,        key: 'good',  label: 'Good',        cls: 'b-good',  short: ''    },
  { max: 10,       key: 'inacc', label: 'Inaccuracy',  cls: 'b-inacc', short: '?!' },
  { max: 20,       key: 'mist',  label: 'Mistake',     cls: 'b-mist',  short: '?'  },
  { max: Infinity, key: 'blun',  label: 'Blunder',     cls: 'b-blun',  short: '??' },
];

/** winLost: percentage points of winning chance given away. */
export function gradeMove(winLost) {
  return COACH_BANDS.find((b) => winLost <= b.max);
}

/** Grade straight from two centipawn evaluations (mover's point of view). */
export function gradeFromScores(beforeCp, afterCp) {
  const winLost = Math.max(0, winPercent(beforeCp) - winPercent(afterCp));
  return { band: gradeMove(winLost), winLost, accuracy: moveAccuracy(winPercent(beforeCp), winPercent(afterCp)) };
}

/** The colour a move of this quality gets on the board and in the move list. */
export function bandColor(key) {
  return {
    best: '#4caf50', excl: '#66bb6a', good: '#8bc34a',
    inacc: '#e0b93c', mist: '#e08a3c', blun: '#e0503c',
  }[key] || '#9aa0a6';
}

/**
 * The actual teaching line.
 *
 * A bare number ("-1.83") teaches nothing. Name the kind of mistake so the
 * player knows what to check next time: an undefended piece, a king stepped
 * into danger, or a piece developed too late.
 */
export function coachAdvice(band, loss) {
  const big = Math.abs(loss) > 150;
  switch (band.key) {
    case 'best':
      return 'That was the strongest move here. Nothing to fix.';
    case 'excl':
      return 'Hard to tell apart from the best move in practice. Keep it.';
    case 'good':
      return 'A sound move. It keeps the position and you are still on plan.';
    case 'inacc':
      return 'Slightly imprecise - the position drifts the wrong way. Before moving a piece, check that it is still defended.';
    case 'mist':
      return big
        ? 'You gave away a large part of the position. Before you commit, ask what your opponent can take, and whether your king is safe.'
        : 'A real error. Look for the square your opponent wanted next time you moved in that part of the board.';
    case 'blun':
      return big
        ? 'This lost a lot. The usual causes are a piece left undefended, or moving into a square the opponent attacks. Check those two things first.'
        : 'This lost a lot of the game. Replay it and find the moment your opponent was allowed to attack.';
    default:
      return '';
  }
}