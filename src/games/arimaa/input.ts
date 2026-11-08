import {
    arrowToken, captureToken, joinSelections, parseMove, surviveToken,
    type Token, type Piece, type playerid,
} from "./notation.js";
import { resolve, serializeTurn, sqIndex, sqName, type CellContents, type Turn } from "./turns.js";

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
function projected(board: Map<string, CellContents>, player: playerid, limit: number, tokens: Token[]): Map<string, Occupant> {
    const out = new Map<string, Occupant>();
    for (const [square, [piece, owner]] of board) {
        out.set(square, {piece, owner, origin: square});
    }
    if (tokens.length === 0) {
        return out;
    }
    const r = resolve(board, player, limit, tokens, true);
    if (r.status !== "resolved") {
        return out;
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
    return out;
}

function distinctMoves(turn: Turn, allowed: Set<number>): boolean {
    return turn.trajectories.every(tr => allowed.has(tr.start));
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
    if (mode === "advanced") {
        return resolve(board, player, limit, tokens, true).status !== "unsatisfiable";
    }
    // Basic means each moved (or captured) piece must have been explicitly
    // named, including pieces that move away and come back.
    const allowed = new Set<number>();
    for (const t of tokens) {
        if (t.spec.square !== undefined) {
            allowed.add(sqIndex(t.spec.square));
        }
    }
    const chain = new Set(selected.map(p => sqIndex(p.origin)));
    const r = resolve(board, player, limit, tokens, false, true, turn => {
        if (!distinctMoves(turn, allowed)) {
            return false;
        }
        // The newest selection vacates first. Chained entries are not
        // permitted to silently reverse which occupant vacates a square.
        const order = selected.map(p => turn.trajectories.find(tr => tr.start === sqIndex(p.origin))?.firstStep ?? -1);
        return order.every((step, i) => i === 0 || step >= 0 && order[i - 1] > step);
    });
    return r.status === "resolved" && r.turn.trajectories.some(tr => chain.has(tr.start));
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
    const occupancy = projected(board, player, limit, tokens);
    const clicked = occupancy.get(square);
    const selectionPieces = selections.map(s => occupancy.get(s));
    const undo = (): InputClick => ({move: stripped.length ? tokens.slice(0, -1).map(t => t.text).join(" ") : ""});
    const select = (squares: string[]): InputClick => ({move: joinSelections(tokens, squares)});

    if (selections.length === 0) {
        if (clicked !== undefined) {
            return select([square]);
        }
        if (mode === "advanced") {
            // An emptied original square points at the piece that used to
            // stand there, but only if it is still on the board.
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
        if (stripped.length > 0) {
            const r = resolve(board, player, limit, tokens, false);
            if (r.status === "resolved") {
                return {move: stripped, complete: true};
            }
        }
        if (clicked === undefined) {
            return {move: stripped};
        }
        return undo();
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
