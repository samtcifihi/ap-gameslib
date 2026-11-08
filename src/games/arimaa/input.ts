import {
    arrowToken, captureToken, joinSelections, parseMove, surviveToken,
    type Token, type Piece, type playerid,
} from "./notation.js";
import { canMoveNow, resolve, serializeTurn, sqIndex, sqName, type CellContents, type Turn } from "./turns.js";

export type ArimaaInputMode = "basic" | "advanced";
export interface InputClick {
    move: string;
    complete?: boolean;
}

interface Occupant {
    piece: Piece;
    owner: playerid;
    origin: string;
}

// Work from the board the player is looking at rather than the turn's original
// occupancy. A piece already moved by a preceding token still retains its
// original identity when another arrow extends its destination.
interface Projection {
    occupants: Map<string, Occupant>;
    stepsUsed: number;
    resolved: boolean;
}

function projected(board: Map<string, CellContents>, player: playerid, limit: number, tokens: Token[]): Projection {
    const out = new Map<string, Occupant>();
    for (const [square, [piece, owner]] of board) {
        out.set(square, {piece, owner, origin: square});
    }
    if (tokens.length === 0) {
        return {occupants: out, stepsUsed: 0, resolved: true};
    }
    const r = resolve(board, player, limit, tokens, true);
    if (r.status !== "resolved") {
        return {occupants: out, stepsUsed: 0, resolved: false};
    }
    for (const step of r.turn.steps) {
        const from = sqName(step.from), to = sqName(step.to);
        const occupant = out.get(from);
        if (occupant !== undefined) {
            out.delete(from);
            out.set(to, occupant);
        }
        for (const cap of r.turn.captures.filter(c => c.afterStep === r.turn.steps.indexOf(step))) {
            out.delete(sqName(cap.square));
        }
    }
    return {occupants: out, stepsUsed: r.turn.steps.length, resolved: true};
}

function distinctMoves(turn: Turn, allowed: Set<number>): boolean {
    return turn.trajectories.every(tr => tr.visited.length === 1 || allowed.has(tr.start));
}

function moveToken(board: Map<string, CellContents>, origin: string, dest: string): Token {
    const [piece, owner] = board.get(origin)!;
    return arrowToken(piece, owner, origin, dest);
}

function updateArrow(tokens: Token[], origin: string, dest: string, board: Map<string, CellContents>): Token[] {
    // Re-opening an existing destination replaces its arrow, rather than
    // asserting that the same piece has two different final squares.
    return [...tokens.filter(t => !(t.prop.kind === "dest" && t.spec.square === origin)), moveToken(board, origin, dest)];
}

function chainTokens(board: Map<string, CellContents>, tokens: Token[], selected: Occupant[], squares: string[], target: string): Token[] {
    let out = [...tokens];
    for (let i = selected.length - 1; i >= 0; i--) {
        out = updateArrow(out, selected[i].origin, i === selected.length - 1 ? target : squares[i + 1], board);
    }
    return out;
}

function resolveChain(board: Map<string, CellContents>, player: playerid, limit: number, tokens: Token[], selected: Occupant[], mode: ArimaaInputMode): boolean {
    // A chained entry vacates its squares from newest selection to oldest.
    // Basic additionally forbids movement or capture of unselected pieces
    // and requires one strict result, without guessing between positions.
    const allowed = new Set<number>();
    for (const t of tokens) {
        if (t.spec.square !== undefined) {
            allowed.add(sqIndex(t.spec.square));
        }
    }
    const chain = new Set(selected.map(p => sqIndex(p.origin)));
    const r = resolve(board, player, limit, tokens, mode === "advanced", true, turn => {
        if (mode === "basic" && !distinctMoves(turn, allowed)) {
            return false;
        }
        const order = selected.map(p => turn.trajectories.find(tr => tr.start === sqIndex(p.origin))?.firstStep ?? -1);
        return order.every((step, i) => step >= 0 && (i === 0 || order[i - 1] > step));
    });
    return mode === "advanced" ?
        r.status !== "unsatisfiable" :
        r.status === "resolved" && r.turn.trajectories.some(tr => chain.has(tr.start));
}

function prefCompare(a: Turn, b: Turn): number {
    return a.steps.length - b.steps.length ||
        a.displaced - b.displaced ||
        a.ownCaptured - b.ownCaptured ||
        b.enemyCaptured - a.enemyCaptured;
}

function targetSelection(board: Map<string, CellContents>, player: playerid, limit: number, tokens: Token[], target: string): string | undefined {
    const choices: Array<{turn: Turn; enemy: boolean}> = [];
    for (const [origin, [, owner]] of board) {
        if (Math.abs(origin.charCodeAt(0) - target.charCodeAt(0)) +
            Math.abs(Number(origin[1]) - Number(target[1])) > limit) {
            continue;
        }
        const extra = moveToken(board, origin, target);
        const r = resolve(board, player, limit, [...tokens, extra], false, true, turn =>
            turn.trajectories.some(tr => tr.start === sqIndex(origin) && tr.final === sqIndex(target) &&
                (tr.visited.length > 1 || tr.captured)));
        const found = r.status === "resolved" ? [r.turn] : r.status === "ambiguous" ? r.candidates : [];
        for (const turn of found) {
            choices.push({turn, enemy: owner !== player});
        }
    }
    if (choices.length === 0) {
        return undefined;
    }
    const enemyPresent = choices.some(c => c.enemy);
    const preferred = choices.filter(c => c.enemy === enemyPresent).sort((a, b) => prefCompare(a.turn, b.turn));
    const best = preferred[0].turn;
    const tied = preferred.filter(c => prefCompare(c.turn, best) === 0);
    if (new Set(tied.map(c => c.turn.signature)).size !== 1) {
        return undefined;
    }
    return serializeTurn(board, player, limit, best);
}

/**
 * Exact visible triangle: x in [0.5,1], y in [0,0.5], x - y >= 0.5.
 *
 * The current renderer does not make shading polygons clickable. Its existing
 * clickable line markers can supply a subpixel-precision hit region without a
 * renderer change. Tile horizontal strokes *inside* the triangle: clicks in
 * the rest of the square remain ordinary board clicks. At 50px per cell, the
 * maximum diagonal-edge inset is under 0.3px (96 slices).
 */
const CAPTURE_HIT_SLICES = 96;
const CAPTURE_RENDER_CELL_PX = 50;

export interface CaptureHitLine {
    points: [{row: number; col: number}, {row: number; col: number}];
    width: number;
    id: string;
}

export function captureControlLines(square: string): CaptureHitLine[] {
    const col = square.charCodeAt(0) - 97;
    const row = 8 - Number(square[1]);
    const step = 0.5 / CAPTURE_HIT_SLICES;
    const width = CAPTURE_RENDER_CELL_PX * step;
    const lines: CaptureHitLine[] = [];
    for (let i = 0; i < CAPTURE_HIT_SLICES; i++) {
        const y = row + (i + 0.5) * step;
        // Butt joins aren't configurable on the existing marker, so keep
        // its round stroke ends strictly within the diagonal boundary.
        const x0 = Math.min(col + 0.5 + (i + 1.5) * step, col + 1 - step / 2);
        const x1 = col + 1 - step / 2;
        const from = {row: y, col: x0};
        const to = {row: y, col: x1};
        lines.push({points: [from, to], width,
            id: `${from.col},${from.row}|${to.col},${to.row}`});
    }
    // Include the diagonal boundary itself. This tiny clickable stroke makes
    // edge clicks work without allowing a perceptible region outside the
    // triangle (0.35px of width against a 50px cell).
    const edgeFrom = {row, col: col + 0.5};
    const edgeTo = {row: row + 0.5, col: col + 1};
    lines.push({points: [edgeFrom, edgeTo], width: 0.35,
        id: `${edgeFrom.col},${edgeFrom.row}|${edgeTo.col},${edgeTo.row}`});
    return lines;
}

export function captureControlSquare(clickId: string | undefined): string | undefined {
    if (!clickId) return undefined;
    for (const trap of ["c3", "f3", "c6", "f6"]) {
        if (captureControlLines(trap).some(line => line.id === clickId)) {
            return trap;
        }
    }
    return undefined;
}

/**
 * Trap squares where the newest selection has both a surviving and a captured
 * legal ending. The renderer can draw the advanced-mode alternative control
 * only on these squares.
 */
export function captureAlternatives(
    board: Map<string, CellContents>, player: playerid, limit: number, move: string,
): string[] {
    let parsed: ReturnType<typeof parseMove>;
    try {
        parsed = parseMove(move, true);
    } catch {
        return [];
    }
    const selectionSquares = parsed.selections ?? [];
    if (selectionSquares.length === 0) {
        return [];
    }
    const {occupants} = projected(board, player, limit, parsed.tokens);
    const selected = selectionSquares.map(s => occupants.get(s));
    if (selected.some(p => p === undefined)) {
        return [];
    }
    const pieces = selected as Occupant[];
    const last = pieces[pieces.length - 1];
    const out: string[] = [];
    for (const trap of ["c3", "f3", "c6", "f6"]) {
        if (occupants.has(trap)) {
            continue;
        }
        const drawn = chainTokens(board, parsed.tokens, pieces, selectionSquares, trap);
        const capture = resolve(board, player, limit,
            [...drawn, captureToken(last.piece, last.owner, last.origin)], true);
        if (capture.status === "unsatisfiable") {
            continue;
        }
        const survive = resolve(board, player, limit,
            [...drawn, surviveToken(last.piece, last.owner, last.origin)], true);
        if (survive.status !== "unsatisfiable") {
            out.push(trap);
        }
    }
    return out;
}

export function inputClick(
    board: Map<string, CellContents>, player: playerid, limit: number,
    move: string, square: string, mode: ArimaaInputMode, alternativeCapture = false,
): InputClick {
    let parsed: ReturnType<typeof parseMove>;
    try {
        parsed = parseMove(move, true);
    } catch {
        parsed = {tokens: [], selections: []};
    }
    const tokens = parsed.tokens;
    const selections = parsed.selections ?? [];
    const stripped = tokens.map(t => t.text).join(" ");
    const preview = projected(board, player, limit, tokens);
    const occupancy = preview.occupants;
    const previewBoard = new Map<string, CellContents>(
        [...occupancy].map(([cell, p]): [string, CellContents] => [cell, [p.piece, p.owner]])
    );
    // A piece is selectable only if it can participate in a legal step,
    // push, or pull *after* the already-entered move, within the steps left.
    // In particular, merely having any prior token must never turn every
    // enemy piece into a selectable one.
    const movable = (cell: string): boolean => preview.resolved &&
        canMoveNow(previewBoard, player, limit - preview.stepsUsed, cell);
    const clicked = occupancy.get(square);
    const selectionPieces = selections.map(s => occupancy.get(s));
    const undo = (): InputClick => ({move: stripped.length ? tokens.slice(0, -1).map(t => t.text).join(" ") : ""});
    const select = (squares: string[]): InputClick => ({move: joinSelections(tokens, squares)});

    if (selections.length === 0) {
        if (clicked !== undefined && movable(square)) {
            return select([square]);
        }
        if (mode === "advanced") {
            // An emptied original square points at the piece that used to
            // stand there, but only if it is still on the board.
            if (clicked === undefined) {
                if (board.has(square)) {
                    for (const [current, p] of occupancy) {
                        if (p.origin === square && movable(current)) {
                            return select([current]);
                        }
                    }
                }
                const byTarget = targetSelection(board, player, limit, tokens, square);
                if (byTarget !== undefined) {
                    return {move: byTarget};
                }
            }
        }
        if (clicked === undefined && stripped.length > 0) {
            const r = resolve(board, player, limit, tokens, false);
            if (r.status === "resolved") {
                return {move: stripped, complete: true};
            }
        }
        // Only an enemy unable to move using the remaining steps undoes.
        if (clicked !== undefined && clicked.owner !== player && !movable(square)) {
            return undo();
        }
        return {move: stripped};
    }

    if (clicked === undefined) {
        if (selectionPieces.every(p => p !== undefined)) {
            const selected = selectionPieces as Occupant[];
            const proposed = chainTokens(board, tokens, selected, selections, square);
            if (alternativeCapture && mode === "advanced" && ["c3", "f3", "c6", "f6"].includes(square)) {
                const last = selected[selected.length - 1];
                proposed.push(last.owner === player ?
                    captureToken(last.piece, last.owner, last.origin) :
                    surviveToken(last.piece, last.owner, last.origin));
            }
            if (resolveChain(board, player, limit, proposed, selected, mode)) {
                return {move: proposed.map(t => t.text).join(" ")};
            }
        }
        if (mode === "advanced") {
            if (board.has(square)) {
                for (const [current, p] of occupancy) {
                    if (p.origin === square) {
                        return select([current]);
                    }
                }
            }
            const byTarget = targetSelection(board, player, limit, tokens, square);
            if (byTarget !== undefined) {
                return {move: byTarget};
            }
        }
        return {move: stripped};
    }
    const last = selectionPieces[selectionPieces.length - 1];
    if (!movable(square)) {
        // While selecting a chain, an immovable enemy cancels the selection
        // rather than becoming another selected piece.
        return {move: stripped};
    }
    if (last !== undefined) {
        // Selecting the piece to be displaced builds a chain. An immediate
        // return to the first square closes a cycle rather than leaving an
        // impossible pending selection.
        if (square === selections[0] && selections.length > 1) {
            const selected = selectionPieces as Occupant[];
            const proposed = chainTokens(board, tokens, selected, selections, square);
            if (resolveChain(board, player, limit, proposed, selected, mode)) {
                return {move: proposed.map(t => t.text).join(" ")};
            }
        }
        if (!selections.includes(square)) {
            return select([...selections, square]);
        }
    }
    if (mode === "basic" && selections.includes(square)) {
        return {move: stripped};
    }
    return select([square]);
}
