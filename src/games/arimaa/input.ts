import {
    arrowToken, captureToken, joinSelections, parseMove, surviveToken,
    type Token, type Piece, type playerid,
} from "./notation.js";
import { canMoveNow, canMoveWithin, resolve, serializeTurn, sqIndex, sqName, type CellContents, type Turn } from "./turns.js";

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

function resolveChain(
    board: Map<string, CellContents>, player: playerid, limit: number,
    tokens: Token[], selected: Occupant[], mode: ArimaaInputMode, closedLoop = false,
): string | undefined {
    // A chained entry vacates its squares from newest selection to oldest.
    // Basic additionally forbids movement or capture of unselected pieces.
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
        // A square specifier can be witnessed by another piece that passes
        // through it. A click chain, however, refers to the actual selected
        // occupants. Every one must finish at its explicitly clicked target,
        // not merely be a possible witness for a token.
        for (const piece of selected) {
            const destination = tokens.find(t =>
                t.spec.square === piece.origin && t.prop.kind === "dest");
            const tr = turn.trajectories.find(t => t.start === sqIndex(piece.origin));
            if (destination?.prop.kind !== "dest" || tr === undefined ||
                tr.visited.length < 2 || tr.final !== sqIndex(destination.prop.square)) {
                return false;
            }
        }
        // A closed chain has no first square to vacate: one piece must make
        // a preparatory move to open the loop, then finish after other pieces.
        // Imposing a reverse order on *final* steps rejects such valid turns.
        // The explicit endpoints and the rules of movement determine whether
        // this rotation is possible without moving an unselected piece.
        if (closedLoop) {
            return true;
        }
        // The next piece must vacate its square before the preceding piece
        // finishes there. A pusher can take preparatory steps *before* the
        // pushed piece moves (for example f3-e3, e4-d4, e3-e4), so comparing
        // first steps would wrongly reject a fully explicit chain.
        const order = selected.map(p => {
            const tr = turn.trajectories.find(t => t.start === sqIndex(p.origin));
            if (tr === undefined || tr.visited.length < 2) {
                return -1;
            }
            const pid = turn.steps[tr.firstStep]?.pid;
            if (pid === undefined) {
                return -1;
            }
            let last = tr.firstStep;
            for (let i = last + 1; i < turn.steps.length; i++) {
                if (turn.steps[i].pid === pid) {
                    last = i;
                }
            }
            return last;
        });
        return order.every((step, i) => step >= 0 && (i === 0 || order[i - 1] > step));
    });
    const entered = tokens.map(t => t.text).join(" ");
    if (mode === "advanced") {
        return r.status === "unsatisfiable" ? undefined : entered;
    }
    if (r.status === "resolved") {
        return r.turn.trajectories.some(tr => chain.has(tr.start)) ? entered : undefined;
    }
    if (r.status !== "ambiguous") {
        return undefined;
    }

    // When selected pieces reach the same squares but a friendly trap occupant
    // can either survive or die, prefer survival and encode the step order.
    // Other ambiguities still require explicit disambiguation.
    const shape = (turn: Turn): string => turn.trajectories
        .map(tr => `${tr.owner}:${tr.type}:${tr.start}:${tr.final}`).sort().join("|");
    if (new Set(r.candidates.map(shape)).size !== 1) {
        return undefined;
    }
    const fewestOwnCaptures = Math.min(...r.candidates.map(turn => turn.ownCaptured));
    if (r.candidates.every(turn => turn.ownCaptured === fewestOwnCaptures)) {
        return undefined;
    }
    const survivors = r.candidates.filter(turn => turn.ownCaptured === fewestOwnCaptures);
    if (survivors.length !== 1 || !survivors[0].trajectories.some(tr => chain.has(tr.start))) {
        return undefined;
    }
    const explicit = serializeTurn(board, player, limit, survivors[0]);
    return explicit !== undefined && resolve(board, player, limit, parseMove(explicit).tokens, false).status === "resolved" ?
        explicit : undefined;
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
 * Reserved renderer-only legend key for the Advanced alternative trap outcome.
 *
 * This is not a real board occupant. It is a single custom SVG triangle in
 * the render representation, and the renderer forwards its identifier with
 * ordinary board-piece clicks.
 */
export const ARIMAA_CAPTURE_CHOICE = "ARIMAA_CAPTURE_CHOICE";

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
    // Pieces may become movable after supporting steps. When the notation is
    // ambiguous, keep the original board selectable for disambiguating clicks.
    const remaining = preview.resolved ? limit - preview.stepsUsed : limit;
    // An inferred pusher in the displayed resolution is not an explicit
    // instruction. The player may still specify a *different* valid pusher,
    // even when the preview has used all four steps or moved the original
    // occupant away from its starting square.
    const original = (cell: string): Occupant | undefined => {
        const piece = board.get(cell);
        if (piece === undefined || tokens.some(t => t.spec.square === cell)) {
            return undefined;
        }
        return {piece: piece[0], owner: piece[1], origin: cell};
    };
    const canEditOriginal = (cell: string): boolean => {
        if (tokens.length === 0 || original(cell) === undefined ||
            !canMoveWithin(board, player, limit, cell)) {
            return false;
        }
        const at = sqIndex(cell);
        const r = resolve(board, player, limit, tokens, true, true, turn =>
            turn.trajectories.some(tr => tr.start === at && tr.visited.length > 1));
        return r.status !== "unsatisfiable";
    };
    const movable = (cell: string): boolean => {
        if (remaining > 0 && occupancy.has(cell) &&
            (canMoveNow(previewBoard, player, remaining, cell) ||
                canMoveWithin(previewBoard, player, remaining, cell))) {
            return true;
        }
        const shown = occupancy.get(cell);
        return (shown === undefined || shown.origin === cell) && canEditOriginal(cell);
    };
    const clicked = occupancy.get(square) ?? (mode === "advanced" ? original(square) : undefined);
    const selectionPieces = selections.map(s =>
        occupancy.get(s) ?? (mode === "advanced" ? original(s) : undefined));
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
            const r = resolve(board, player, limit, tokens, true);
            if (r.status === "resolved") {
                // The preview may be leniently resolved while the notation
                // still admits different outcomes. An explicit completion
                // commits the displayed result with strict, replayable tokens.
                const committed = r.lenient ? serializeTurn(board, player, limit, r.turn) : stripped;
                if (committed !== undefined) {
                    return {move: committed, complete: true};
                }
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
            const resolved = resolveChain(board, player, limit, proposed, selected, mode);
            if (resolved !== undefined) {
                return {move: resolved};
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
    // A return click to the first selection is a request to close a loop,
    // not a request to reselect it. Check the fully specified rotation before
    // applying the ordinary occupied-square selection priorities.
    if (square === selections[0] && selections.length > 1 &&
        selectionPieces.every(p => p !== undefined)) {
        const selected = selectionPieces as Occupant[];
        const proposed = chainTokens(board, tokens, selected, selections, square);
        const resolved = resolveChain(board, player, limit, proposed, selected, mode, true);
        if (resolved !== undefined) {
            return {move: resolved};
        }
    }
    if (!movable(square)) {
        // While selecting a chain, an immovable enemy cancels the selection
        // rather than becoming another selected piece.
        return {move: stripped};
    }
    if (last !== undefined) {
        // Selecting the piece to be displaced builds a chain; closed loops
        // were already handled above, before the ordinary mobility gate.
        if (!selections.includes(square)) {
            return select([...selections, square]);
        }
    }
    if (mode === "basic" && selections.includes(square)) {
        return {move: stripped};
    }
    return select([square]);
}
