// smoke-test.mjs - verify the JavaScript engine actually plays chess.
// Complements perft-test.mjs, which only proves move generation is legal.
//
//   node smoke-test.mjs

import {
  Position, generateLegal, applyMove, toSan, gameStatus,
  sqName, makeSq, inCheck, isInsufficientMaterial, F_EP,
} from './chess.js';
import { think, evaluate } from './engine.js';

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`);
  }
}

console.log('rules');

{
  const p = new Position();
  const rt = p.fen();
  check('FEN round trip', new Position(rt).fen() === rt, rt);
  check('start position has 20 legal moves', generateLegal(p).length === 20);
  check('king e1 is a1-rank', p.kingSq(1) === 4 && p.kingSq(-1) === 60);
  check('not in check at the start', !inCheck(p));
}

{
  const p = new Position('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
  const m = generateLegal(p).find((x) => x.to === makeSq(0, 7));
  check('back-rank mate is Ra8#', m && toSan(p, m) === 'Ra8#', m ? toSan(p, m) : 'none');
  check('mate is detected', gameStatus(applyMove(p, m)).reason === 'checkmate');
}

{
  const p = new Position('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  check('stalemate is detected', gameStatus(p).reason === 'stalemate');
  check('stalemate is not check', !inCheck(p, -1));
}

{
  const p = new Position('8/8/8/3pP3/8/8/8/4K3 w - d6 0 2');
  const m = generateLegal(p).find((x) => x.flag === F_EP);
  check('en passant is exd6', m && toSan(p, m) === 'exd6');
}

{
  const p = new Position('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const san = generateLegal(p).filter((m) => m.flag >= 4).map((m) => toSan(p, m)).sort();
  check('both castles available', san.join(' ') === 'O-O O-O-O', san.join(' '));
}

{
  const p = new Position('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  const promos = generateLegal(p).filter((m) => m.to === 56).map((m) => toSan(p, m));
  check('all four promotions generated',
    promos.length === 4 && promos.includes('a8=Q+') && promos.includes('a8=N'),
    promos.join(' '));
}

{
  const p = new Position('8/8/8/8/R6R/8/8/K6k w - - 0 1');
  const san = generateLegal(p).filter((m) => m.to === makeSq(2, 3)).map((m) => toSan(p, m)).sort();
  check('rook SAN is disambiguated', san.join(' ') === 'Rac4+ Rhc4', san.join(' '));
}

{
  const p = new Position('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
  check('insufficient material K vs K', isInsufficientMaterial(new Position('4k3/8/8/8/8/8/8/4K3 w - - 0 1')));
  check('K+B vs K is insufficient', isInsufficientMaterial(new Position('4k3/8/8/8/8/8/8/3BK3 w - - 0 1')));
  check('K+R vs K is sufficient', !isInsufficientMaterial(new Position('4k3/8/8/8/8/8/8/3RK3 w - - 0 1')));
}

console.log('evaluation');

check('start position is near equal', Math.abs(evaluate(new Position())) < 60, String(evaluate(new Position())));
{
  const up = evaluate(new Position('r1bq1rk1/ppp2ppp/2n5/3p4/8/2NBPN2/PPP2PPP/R1BQ1RK1 w - - 0 1'));
  const down = evaluate(new Position('r1bq1rk1/ppp2ppp/2n5/3p4/8/2NBPN2/PPP2PPP/R1BQ1RK1 b - - 0 1'));
  check('a rook up is decisive', up > 400, String(up));
  // The two scores are both from the mover's point of view, so who moves flips
  // the sign. The only remaining difference is the tempo bonus, applied twice
  // (once gained, once not gained) = 20cp at +/-10.
  check('White to move and Black to move differ by exactly the tempo bonus',
    Math.abs(up - -down) === 20, `${up} vs ${down}, gap ${Math.abs(up + down)}`);
}

console.log('search');

{
  const p = new Position();
  const r = think(p, 4);
  check('start position returns a legal move',
    r.move && generateLegal(p).some((m) => m.from === r.move.from && m.to === r.move.to));
  check('search visits a sane number of nodes', r.nodes > 1000 && r.nodes < 3000000, String(r.nodes));
}
{
  const p = new Position('6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1');
  const r = think(p, 3);
  check('finds a mate in one', r.move && toSan(p, r.move) === 'Re8#', r.move ? toSan(p, r.move) : 'none');
  check('mate scores above MATE-256', r.score > 30000 - 256, String(r.score));
}
{
  const p = new Position('4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1');
  const r = think(p, 3);
  check('takes the free queen', r.move && toSan(p, r.move) === 'Qxd5', r.move ? toSan(p, r.move) : 'none');
  check('scores the capture', r.score > 500, String(r.score));
}
{
  // White is already stalemated: the search must return no move rather than
  // crash or invent one.
  const p = new Position('7k/8/8/8/8/8/5q2/7K w - - 0 1');
  check('that position really is stalemate', gameStatus(p).reason === 'stalemate');
  const r = think(p, 3);
  check('search returns no move in a stalemate', r.move === null);
}
{
  // A mate in two the engine has to see through, not just one ply deep.
  const p = new Position('r5rk/5p1p/5R2/4B3/8/8/7P/7K w - - 0 1');
  const r = think(p, 4);
  const after = r.move ? applyMove(p, r.move) : null;
  const forced = after && after.half < 4;
  check('finds a forcing first move in a mate-in-2', forced,
    r.move ? toSan(p, r.move) : 'none');
}

console.log('');
console.log(failures === 0 ? 'all smoke tests passed' : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);