/**
 * Click entry for Arimaa: what a click on the board does to the move being
 * entered, in each of the two input modes.
 *
 * The entry is a move string: tokens, then the squares of the selected pieces,
 * oldest first. Clicks name squares of the board as it is drawn, which is the
 * board after the turn the tokens are shown as (`display`).
 *
 * Basic plays what it is told and nothing else. A destination click adds the
 * steps of the selected pieces, written as step tokens, after the steps
 * already entered, so that steps happen in the order they were entered.
 *
 * Advanced says where pieces end up and leaves the rest to the resolver, as
 * typed notation does. Its tokens name a piece by the square it started the
 * turn on, and sending a piece somewhere else replaces what was said of it.
 */
import {
    arrowToken, captureToken, holdToken, joinSelections, parseMove, pieceChar, surviveToken,
    type Dir, type ParsedMove, type Piece, type Token, type playerid,
} from "./notation.js";
import {
    boardSignature, canMoveWithin, display, manhattan, resolve, serializeTurn, sqIndex, sqName,
    type CellContents, type Turn, type TurnStep,
} from "./turns.js";

export type ArimaaInputMode = "basic" | "advanced";
export interface InputClick {
    move: string;
    complete?: boolean;
}

/**
 * Reserved renderer-only legend key for the Advanced alternative trap outcome.
 *
 * This is not a real board occupant. It is a single custom SVG triangle in
 * the render representation, and the renderer forwards its identifier with
 * ordinary board-piece clicks.
 */
export const ARIMAA_CAPTURE_CHOICE = "ARIMAA_CAPTURE_CHOICE";

const TRAPS = ["c3", "f3", "c6", "f6"];

type Board = Map<string, CellContents>;

/** A piece as drawn, with the square it started the turn on. */
interface Shown {
    piece: Piece;
    owner: playerid;
    origin: string;
}

/** What the player is looking at: the turn the tokens are shown as and the board after it. */
interface View {
    tokens: Token[];
    /** false when no turn fits the tokens */
    fits: boolean;
    turn?: Turn;
    /** whether the tokens denote `turn` on their own, with no preference applied */
    settled: boolean;
    shown: Map<string, Shown>;
    after: Board;
    /** steps not yet spent */
    left: number;
}

const text = (tokens: Token[]): string => tokens.map(t => t.text).join(" ");

function look(board: Board, player: playerid, limit: number, tokens: Token[]): View {
    const shown = new Map<string, Shown>();
    for (const [cell, [piece, owner]] of board) {
        shown.set(cell, {piece, owner, origin: cell});
    }
    const d = display(board, player, limit, tokens);
    const turn = d.status === "turn" ? d.turn : undefined;
    if (turn !== undefined) {
        let next = 0;
        turn.steps.forEach((st, i) => {
            const from = sqName(st.from);
            shown.set(sqName(st.to), shown.get(from)!);
            shown.delete(from);
            for (; next < turn.captures.length && turn.captures[next].afterStep === i; next++) {
                shown.delete(sqName(turn.captures[next].square));
            }
        });
    }
    const after: Board = new Map([...shown].map(([cell, p]): [string, CellContents] => [cell, [p.piece, p.owner]]));
    return {
        tokens, turn, shown, after,
        fits: d.status !== "unsatisfiable",
        settled: d.status === "turn" && d.by === "notation",
        left: limit - (turn?.steps.length ?? 0),
    };
}

// What an explicit completion submits: the entry itself where it needs no
// preference to be read and holds nothing that is only for input, otherwise
// the turn shown, written so that it does.
function committed(board: Board, player: playerid, limit: number, v: View): string {
    if (v.settled && !v.tokens.some(t => t.prop.kind === "survive")) {
        return text(v.tokens);
    }
    return serializeTurn(board, player, limit, v.turn!) ?? text(v.tokens);
}

// ---------------------------------------------------------------------------
// Basic

/** One step token for each run of consecutive steps by one piece. */
function runs(steps: TurnStep[]): Token[] {
    const out: Token[] = [];
    for (let i = 0; i < steps.length;) {
        const first = steps[i];
        const dirs: Dir[] = [];
        for (; i < steps.length && steps[i].pid === first.pid; i++) {
            dirs.push(steps[i].dir);
        }
        const square = sqName(first.from);
        out.push({
            spec: {piece: first.piece, owner: first.owner, square},
            prop: {kind: "steps", dirs},
            text: `${pieceChar(first.piece, first.owner)}${square}${dirs.join("")}`,
        });
    }
    return out;
}

/** Whether the entry is a step list that is played exactly as it is written. */
function literal(v: View): boolean {
    let steps = 0;
    for (const t of v.tokens) {
        if (t.prop.kind !== "steps" || t.spec.piece === undefined || t.spec.square === undefined) {
            return false;
        }
        steps += t.prop.dirs.length;
    }
    return v.turn !== undefined && v.turn.steps.length === steps;
}

// The steps that take each selected piece to the square the next one stands
// on, and the last to `target`, moving nothing else: the fewest there are,
// provided every way of taking that few ends in one position.
function basicChain(v: View, player: playerid, squares: string[], target: string): Turn | undefined {
    const starts = squares.map(sqIndex);
    const ends = squares.map((_, i) => sqIndex(i === squares.length - 1 ? target : squares[i + 1]));
    const tokens = squares.map((s, i) => {
        const p = v.shown.get(s)!;
        return arrowToken(p.piece, p.owner, s, sqName(ends[i]));
    });
    const r = resolve(v.after, player, v.left, tokens, false, true, turn => {
        const moved = turn.trajectories.filter(tr => tr.visited.length > 1);
        return moved.every(tr => starts.includes(tr.start)) &&
            starts.every((s, i) => moved.some(tr => tr.start === s && tr.final === ends[i]));
    });
    return r.status === "resolved" ? r.turn : undefined;
}

// Whether the newest selection could move onto the clicked piece's square as
// part of the chain: the pieces selected so far follow one another, the
// clicked piece makes way, and whatever else moves does so because a link of
// the chain takes its place (it can be selected next).
function basicChainable(v: View, player: playerid, squares: string[], clicked: string): boolean {
    const starts = squares.map(sqIndex);
    const there = sqIndex(clicked);
    const ends = [...starts.slice(1), there];
    const tokens = squares.map((s, i) => {
        const p = v.shown.get(s)!;
        return arrowToken(p.piece, p.owner, s, sqName(ends[i]));
    });
    const r = resolve(v.after, player, v.left, tokens, false, true, turn => {
        const moved = turn.trajectories.filter(tr => tr.visited.length > 1);
        const taken = new Set(moved.map(tr => tr.final));
        return moved.some(tr => tr.start === there) &&
            moved.every(tr => starts.includes(tr.start) || taken.has(tr.start)) &&
            starts.every((s, i) => moved.some(tr => tr.start === s && tr.final === ends[i]));
    });
    return r.status !== "unsatisfiable";
}

function basicClick(board: Board, player: playerid, limit: number, v: View, selections: string[], square: string): InputClick {
    const clicked = v.shown.get(square);
    const stay: InputClick = {move: text(v.tokens)};
    const select = (squares: string[]): InputClick => ({move: joinSelections(v.tokens, squares)});
    const movable = (cell: string): boolean => canMoveWithin(v.after, player, v.left, cell);
    // The entry as the steps it is shown as, followed by the new ones. Steps
    // that only bring back the position the turn started from are no entry.
    const extend = (turn: Turn): InputClick => {
        if (turn.signature === boardSignature(board)) {
            return {move: ""};
        }
        const sofar = literal(v) ? v.tokens : v.turn === undefined ? [] : runs(v.turn.steps);
        return {move: text([...sofar, ...runs(turn.steps)])};
    };

    if (selections.length === 0) {
        if (clicked === undefined) {
            return v.turn === undefined ? stay : {move: committed(board, player, limit, v), complete: true};
        }
        if (movable(square)) {
            return select([square]);
        }
        if (clicked.owner === player) {
            return stay;
        }
        // undo one token, and with it whatever of a push or pull it leaves unplayable
        let rest = v.tokens.slice(0, -1);
        if (literal(v)) {
            while (rest.length > 0 && !literal(look(board, player, limit, rest))) {
                rest = rest.slice(0, -1);
            }
        }
        return {move: text(rest)};
    }

    if (selections.some(s => !v.shown.has(s))) {
        return stay;
    }
    if (clicked === undefined || (square === selections[0] && selections.length > 1)) {
        const turn = basicChain(v, player, selections, square);
        if (turn !== undefined) {
            return extend(turn);
        }
    }
    if (clicked === undefined || selections.includes(square)) {
        return stay;
    }
    if (basicChainable(v, player, selections, square)) {
        return select([...selections, square]);
    }
    return movable(square) ? select([square]) : stay;
}

// ---------------------------------------------------------------------------
// Advanced

/** Where a piece ends up in a turn, and by way of which squares. */
interface Fate {
    final: number;
    captured: boolean;
    visited: number[];
}

function fate(turn: Turn | undefined, origin: string): Fate {
    const start = sqIndex(origin);
    const tr = turn?.trajectories.find(t => t.start === start);
    return tr === undefined ? {final: start, captured: false, visited: [start]} : tr;
}

// Whether, in the turn shown, token `t` is said of `piece`. A token that
// names no square is taken to be only if it names where the piece ends up.
function describes(t: Token, piece: Shown, f: Fate): boolean {
    if (t.spec.piece !== undefined && (t.spec.piece !== piece.piece || t.spec.owner !== piece.owner)) {
        return false;
    }
    if (t.spec.square === undefined) {
        return t.prop.kind === "dest" && f.final === sqIndex(t.prop.square);
    }
    if (!f.visited.includes(sqIndex(t.spec.square))) {
        return false;
    }
    switch (t.prop.kind) {
        case "dest": return f.final === sqIndex(t.prop.square);
        case "capture": return f.captured;
        case "survive": return !f.captured;
        default: return f.visited.length > 1;
    }
}

/** A selected piece, the square it is drawn on, and the square it is being sent to. */
interface Link {
    piece: Shown;
    at: string;
    to: string;
}

function links(v: View, squares: string[], target: string): Link[] | undefined {
    const out: Link[] = [];
    for (let i = 0; i < squares.length; i++) {
        const piece = v.shown.get(squares[i]);
        if (piece === undefined) {
            return undefined;
        }
        out.push({piece, at: squares[i], to: i === squares.length - 1 ? target : squares[i + 1]});
    }
    return out;
}

// The entry with what it said of each link replaced by an arrow to where the
// link is now sent, newest selection first.
function sent(v: View, chain: Link[], tokens = v.tokens): Token[] {
    const fates = chain.map(l => fate(v.turn, l.piece.origin));
    return [
        ...tokens.filter(t => !chain.some((l, i) => describes(t, l.piece, fates[i]))),
        ...chain.map(l => arrowToken(l.piece.piece, l.piece.owner, l.piece.origin, l.to)).reverse(),
    ];
}

/** Whether the player put the link's piece on the square it is drawn on, rather than the resolver. */
function placed(v: View, l: Link): boolean {
    if (l.at === l.piece.origin) {
        return true;
    }
    const f = fate(v.turn, l.piece.origin);
    const at = sqIndex(l.at);
    return v.tokens.some(t => t.prop.kind === "dest" && sqIndex(t.prop.square) === at && describes(t, l.piece, f));
}

// What a turn must do to be the chain: every link ends where it was sent, and
// a link whose square another link moves into has stood on that square if the
// player put it there (a piece the resolver put there is simply planned anew).
function obeys(v: View, chain: Link[]): (turn: Turn) => boolean {
    const via = chain.map((l, i) => i > 0 && placed(v, l));
    return turn => chain.every((l, i) => {
        const f = fate(turn, l.piece.origin);
        return f.final === sqIndex(l.to) && (!via[i] || f.visited.includes(sqIndex(l.at)));
    });
}

// The entry after a chain is sent on its way. The arrows are returned as they
// are when they are shown as a turn the chain allows; when they would be read
// as some shorter turn that ignores it, more is said until they are not.
function advancedChain(board: Board, player: playerid, limit: number, v: View, chain: Link[], extra: Token[] = []): string | undefined {
    const tokens = [...sent(v, chain), ...extra];
    const plain = display(board, player, limit, tokens);
    if (plain.status !== "turn") {
        return plain.status === "idle" ? text(tokens) : undefined;
    }
    const want = display(board, player, limit, tokens, obeys(v, chain));
    if (want.status !== "turn") {
        return undefined;
    }
    if (plain.turn.signature === want.turn.signature) {
        return text(tokens);
    }
    const through = chain.filter((l, i) => i > 0 && l.at !== l.piece.origin && placed(v, l))
        .map(l => arrowToken(l.piece.piece, l.piece.owner, l.at, l.to));
    if (through.length > 0) {
        const more = [...tokens, ...through];
        const d = display(board, player, limit, more);
        if (d.status === "turn" && d.turn.signature === want.turn.signature) {
            return text(more);
        }
    }
    return serializeTurn(board, player, limit, want.turn);
}

// Whether the chain could go on through the clicked piece: the newest
// selection ends on its square and it ends somewhere else.
function advancedChainable(board: Board, player: playerid, limit: number, v: View, squares: string[], clicked: string): boolean {
    const chain = links(v, squares, clicked);
    const x = v.shown.get(clicked);
    if (chain === undefined || x === undefined) {
        return false;
    }
    const f = fate(v.turn, x.origin);
    const tokens = sent(v, chain, v.tokens.filter(t => !describes(t, x, f)));
    const follows = obeys(v, chain);
    const there = sqIndex(clicked);
    return display(board, player, limit, tokens, turn => fate(turn, x.origin).final !== there && follows(turn)).status === "turn";
}

function prefer(a: Turn, b: Turn): number {
    return a.steps.length - b.steps.length ||
        a.displaced - b.displaced ||
        a.ownCaptured - b.ownCaptured ||
        b.enemyCaptured - a.enemyCaptured;
}

// The move a click on an empty square asks for by itself: of the turns that
// fit the entry and end with a piece on (or captured on) `target`, those
// moving an enemy piece there if any do, then the fewest steps, the fewest
// pieces displaced, the fewest own pieces captured and the most enemy pieces
// captured. Nothing if that still leaves more than one position.
function targetSelection(board: Board, player: playerid, limit: number, tokens: Token[], target: string): string | undefined {
    const there = sqIndex(target);
    const choices: Array<{turn: Turn; enemy: boolean}> = [];
    for (const [origin, [piece, owner]] of board) {
        const start = sqIndex(origin);
        if (manhattan(start, there) > limit) {
            continue;
        }
        const r = resolve(board, player, limit, [...tokens, arrowToken(piece, owner, origin, target)], false, true, turn =>
            turn.trajectories.some(tr => tr.start === start && tr.final === there && (tr.visited.length > 1 || tr.captured)));
        for (const turn of r.status === "resolved" ? [r.turn] : r.status === "ambiguous" ? r.candidates : []) {
            choices.push({turn, enemy: owner !== player});
        }
    }
    if (choices.length === 0) {
        return undefined;
    }
    const enemy = choices.some(c => c.enemy);
    const preferred = choices.filter(c => c.enemy === enemy).map(c => c.turn).sort(prefer);
    if (preferred.some(t => prefer(t, preferred[0]) === 0 && t.signature !== preferred[0].signature)) {
        return undefined;
    }
    return serializeTurn(board, player, limit, preferred[0]);
}

/** The token a click on a trap's triangle adds: an own piece is captured there, an enemy piece is not. */
function choice(player: playerid, last: Shown): Token {
    return last.owner === player ?
        captureToken(last.piece, last.owner, last.origin) :
        surviveToken(last.piece, last.owner, last.origin);
}

/**
 * Trap squares where the newest selection has both a surviving and a captured
 * legal ending. The renderer can draw the advanced-mode alternative control
 * only on these squares.
 */
export function captureAlternatives(board: Board, player: playerid, limit: number, move: string): string[] {
    let parsed: ParsedMove;
    try {
        parsed = parseMove(move, true);
    } catch {
        return [];
    }
    const squares = parsed.selections ?? [];
    const v = look(board, player, limit, parsed.tokens);
    if (squares.length === 0 || !v.fits) {
        return [];
    }
    const out: string[] = [];
    for (const trap of TRAPS) {
        const chain = v.shown.has(trap) ? undefined : links(v, squares, trap);
        if (chain === undefined) {
            continue;
        }
        const last = chain[chain.length - 1].piece;
        const tokens = sent(v, chain);
        const follows = obeys(v, chain);
        const can = (t: Token): boolean => display(board, player, limit, [...tokens, t], follows).status === "turn";
        if (can(captureToken(last.piece, last.owner, last.origin)) && can(surviveToken(last.piece, last.owner, last.origin))) {
            out.push(trap);
        }
    }
    return out;
}

function advancedClick(board: Board, player: playerid, limit: number, v: View, selections: string[], square: string, triangle: boolean): InputClick {
    const clicked = v.shown.get(square);
    const stay: InputClick = {move: text(v.tokens)};
    const select = (squares: string[]): InputClick => ({move: joinSelections(v.tokens, squares)});
    // A piece can be selected if it can still move once the turn shown has
    // been played, if it moves in that turn (it can be sent elsewhere), or
    // if the entry leaves room for it to move in place of what was inferred.
    const movable = (cell: string): boolean => {
        const p = v.shown.get(cell);
        if (p === undefined) {
            return false;
        }
        if (canMoveWithin(v.after, player, v.left, cell)) {
            return true;
        }
        const f = fate(v.turn, p.origin);
        if (f.visited.length > 1) {
            return true;
        }
        if (v.turn === undefined || !canMoveWithin(board, player, limit, p.origin)) {
            return false;
        }
        const start = sqIndex(p.origin);
        return display(board, player, limit, v.tokens.filter(t => !describes(t, p, f)), turn =>
            turn.trajectories.some(tr => tr.start === start && tr.visited.length > 1)).status === "turn";
    };
    // an emptied square stands for the piece that started the turn on it
    const cameFrom = (cell: string): InputClick | undefined => {
        for (const [at, p] of v.shown) {
            if (p.origin === cell) {
                return movable(at) ? select([at]) : undefined;
            }
        }
        return undefined;
    };
    const aimed = (): InputClick | undefined => {
        const move = targetSelection(board, player, limit, v.tokens, square);
        return move === undefined ? undefined : {move};
    };

    if (selections.length === 0) {
        if (clicked === undefined) {
            return cameFrom(square) ?? aimed() ??
                (v.turn === undefined ? stay : {move: committed(board, player, limit, v), complete: true});
        }
        if (movable(square)) {
            return select([square]);
        }
        return clicked.owner === player ? stay : {move: text(v.tokens.slice(0, -1))};
    }

    const chain = links(v, selections, square);
    if (chain === undefined) {
        return stay;
    }
    if (clicked === undefined) {
        const extra = triangle && TRAPS.includes(square) ? [choice(player, chain[chain.length - 1].piece)] : [];
        const move = advancedChain(board, player, limit, v, chain, extra);
        return move !== undefined ? {move} : cameFrom(square) ?? aimed() ?? stay;
    }
    if (square === selections[0]) {
        if (selections.length > 1) {
            const move = advancedChain(board, player, limit, v, chain);
            if (move !== undefined) {
                return {move};
            }
        } else {
            // the piece stays where it is drawn, which the entry may say already
            const f = fate(v.turn, clicked.origin);
            const here = sqIndex(square);
            if (v.tokens.some(t => t.prop.kind === "dest" && sqIndex(t.prop.square) === here && describes(t, clicked, f))) {
                return stay;
            }
            return {move: text([...v.tokens, holdToken(clicked.piece, clicked.owner, square)])};
        }
    }
    if (!selections.includes(square) && advancedChainable(board, player, limit, v, selections, square)) {
        return select([...selections, square]);
    }
    return movable(square) ? select([square]) : stay;
}

export function inputClick(
    board: Board, player: playerid, limit: number,
    move: string, square: string, mode: ArimaaInputMode, alternativeCapture = false,
): InputClick {
    let parsed: ParsedMove;
    try {
        parsed = parseMove(move, true);
    } catch {
        parsed = {tokens: [], selections: []};
    }
    const v = look(board, player, limit, parsed.tokens);
    const selections = parsed.selections ?? [];
    if (!v.fits) {
        // nothing can be added to an entry no turn fits; an enemy click still takes its last token back
        const clicked = v.shown.get(square);
        return {move: text(clicked !== undefined && clicked.owner !== player ? v.tokens.slice(0, -1) : v.tokens)};
    }
    return mode === "advanced" ?
        advancedClick(board, player, limit, v, selections, square, alternativeCapture) :
        basicClick(board, player, limit, v, selections, square);
}
