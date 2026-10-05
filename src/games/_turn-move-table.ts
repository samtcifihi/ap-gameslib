import type { GameBase } from "./_base.js";
// GameBase methods call into this module; keep `import type` only to avoid circular runtime imports.
import type { IGamePly, IGameRound, IGameRoundSlot, TurnModel } from "./_turn-model.js";
import { SIMULTANEOUS_ELIM_TOKEN } from "./_turn-simultaneous.js";

export type MoveTableDensity = "compact" | "sparse";

export interface IGetMoveTableRoundsOptions {
    density?: MoveTableDensity;
    /** Exploration / focus depth (0 = use full stack move count). */
    pathLength?: number;
}

export interface IPathIndexForMoveTableCellOptions {
    density?: MoveTableDensity;
    /** Front layout model (sequenced, simultaneous, …). */
    model: TurnModel;
    useRoundGrid: boolean;
    numcolumns: number;
    rowIdx: number;
    seatIdx: number;
    pathLength: number;
    path?: Array<Array<{ move?: unknown }>> | null;
}

function plyToRoundSlot(ply: IGamePly): string | IGameRoundSlot {
    const results = ply.results ?? [];
    if (ply.playOrder !== ply.actor) {
        if (results.length > 0) {
            return { move: ply.move, sequence: ply.playOrder, result: [...results] };
        }
        return { move: ply.move, sequence: ply.playOrder };
    }
    if (results.length > 0) {
        return { move: ply.move, result: [...results] };
    }
    return ply.move;
}

function buildSparseRowFromPly(ply: IGamePly, numPlayers: number): IGameRound {
    const row: IGameRound = new Array(numPlayers).fill(null);
    row[ply.actor - 1] = plyToRoundSlot(ply);
    return row;
}

function buildDenseRowFromPlies(
    plies: IGamePly[],
    numPlayers: number,
    buildRoundRow: (roundPlies: IGamePly[]) => IGameRound,
): IGameRound {
    return buildRoundRow(plies);
}

function roundGroupHasDuplicateActor(plies: IGamePly[]): boolean {
    const seen = new Set<number>();
    for (const ply of plies) {
        if (seen.has(ply.actor)) {
            return true;
        }
        seen.add(ply.actor);
    }
    return false;
}

/** Compact move-table rows: group by ply.round; duplicate actors → one sparse row per ply. */
export function packPliesForMoveTable(
    plies: IGamePly[],
    numPlayers: number,
    buildRoundRow: (roundPlies: IGamePly[]) => IGameRound,
): IGameRound[] {
    if (numPlayers < 1) {
        throw new Error("packPliesForMoveTable requires numPlayers >= 1");
    }
    const groups = new Map<number, IGamePly[]>();
    for (const ply of plies) {
        const list = groups.get(ply.round);
        if (list) {
            list.push(ply);
        } else {
            groups.set(ply.round, [ply]);
        }
    }
    const roundIds = [...groups.keys()].sort((a, b) => a - b);
    const displayRounds: IGameRound[] = [];
    for (const roundId of roundIds) {
        const group = groups.get(roundId);
        if (!group || group.length === 0) {
            continue;
        }
        if (roundGroupHasDuplicateActor(group)) {
            for (const ply of group) {
                displayRounds.push(buildSparseRowFromPly(ply, numPlayers));
            }
        } else {
            displayRounds.push(buildDenseRowFromPlies(group, numPlayers, buildRoundRow));
        }
    }
    return displayRounds;
}

export function stackMoveCount(engine: { stack?: unknown[] }): number {
    if (engine.stack && Array.isArray(engine.stack) && engine.stack.length > 1) {
        return engine.stack.length - 1;
    }
    return 0;
}

export function hasMultiplePliesPerStackIndex(plies: IGamePly[]): boolean {
    const counts = new Map<number, number>();
    for (const ply of plies) {
        if (ply.stackIndex == null) {
            continue;
        }
        counts.set(ply.stackIndex, (counts.get(ply.stackIndex) ?? 0) + 1);
    }
    for (const count of counts.values()) {
        if (count > 1) {
            return true;
        }
    }
    return false;
}

export function isStackAlignedRounds(rounds: IGameRound[] | null | undefined, pathLength: number): boolean {
    return Array.isArray(rounds) && pathLength > 0 && rounds.length === pathLength;
}

function roundsLookStackIndexed(fromRounds: IGameRound[], numPlayers: number): boolean {
    if (!Array.isArray(fromRounds) || fromRounds.length === 0 || numPlayers < 1) {
        return false;
    }
    return fromRounds.every((row) => Array.isArray(row) && row.length === numPlayers);
}

function stackRoundsLookComplete(
    fromRounds: IGameRound[] | undefined,
    alignLen: number,
    numPlayers: number,
    engine: { stack?: unknown[] },
): boolean {
    if (
        !Array.isArray(fromRounds) ||
        !roundsLookStackIndexed(fromRounds, numPlayers) ||
        fromRounds.length !== alignLen ||
        stackMoveCount(engine) !== alignLen
    ) {
        return false;
    }
    for (let i = 0; i < alignLen; i++) {
        const row = fromRounds[i]!;
        for (let s = 0; s < numPlayers; s++) {
            const slot = row[s];
            if (slot == null) {
                continue;
            }
            const text = roundSlotToMoveText(slot);
            if (
                text.includes(",") &&
                wireMoveTokenForSeat(text, 0, numPlayers) !== null
            ) {
                return false;
            }
        }
    }
    return true;
}

function trimMoveTableRounds(
    rounds: IGameRound[],
    pathLength: number,
    numPlayers: number,
): IGameRound[] {
    if (pathLength <= 0 || rounds.length <= pathLength) {
        return rounds;
    }
    if (roundsLookStackIndexed(rounds, numPlayers)) {
        return rounds.slice(0, pathLength);
    }
    return rounds;
}

/** Map front `auto` density to gameslib compact. */
export function normalizeMoveTableDensity(
    density: MoveTableDensity | "auto" | undefined,
): MoveTableDensity {
    if (density === "sparse") {
        return "sparse";
    }
    return "compact";
}

/**
 * Move-table presentation rows (not gamerecord export — see `getRounds()`).
 */
export function getMoveTableRoundsForEngine(
    game: GameBase,
    opts: IGetMoveTableRoundsOptions = {},
    buildRoundRow?: (roundPlies: IGamePly[]) => IGameRound,
): IGameRound[] {
    const density = opts.density ?? "compact";
    const pathLength = opts.pathLength ?? 0;
    const alignLen = pathLength > 0 ? pathLength : stackMoveCount(game);
    const numPlayers = game.numplayers;
    const model =
        typeof game.turnModel === "function" ? game.turnModel() : "sequenced";
    const plies = game.getPlies();
    const fromRounds =
        typeof game.getRounds === "function" ? game.getRounds() : [];

    if (
        roundsLookStackIndexed(fromRounds, numPlayers) &&
        fromRounds.length > alignLen &&
        alignLen > 0
    ) {
        return fromRounds.slice(0, alignLen);
    }

    if (model === "simultaneous" || hasMultiplePliesPerStackIndex(plies)) {
        return trimMoveTableRounds(fromRounds, alignLen, numPlayers);
    }

    if (density === "sparse" && stackRoundsLookComplete(fromRounds, alignLen, numPlayers, game)) {
        return fromRounds;
    }

    if (density === "sparse" || model !== "sequenced") {
        return trimMoveTableRounds(fromRounds, alignLen, numPlayers);
    }

    if (!buildRoundRow) {
        return trimMoveTableRounds(fromRounds, alignLen, numPlayers);
    }
    const compact = packPliesForMoveTable(plies, numPlayers, buildRoundRow);
    return trimMoveTableRounds(compact, alignLen, numPlayers);
}

export function roundSlotToMoveText(slot: string | IGameRoundSlot | null | undefined): string {
    if (slot == null) {
        return "";
    }
    if (typeof slot === "string") {
        return slot;
    }
    return String(slot.move ?? "");
}

/** Split N-part simultaneous wire move text for one seat; null if not wire-shaped. */
export function wireMoveTokenForSeat(
    move: unknown,
    seatIdx: number,
    numPlayers: number,
): string | null {
    if (Array.isArray(move)) {
        return String(move[seatIdx] ?? "");
    }
    if (typeof move !== "string" || !move.includes(",")) {
        return null;
    }
    const parts = move.split(/\s*,\s*/);
    if (parts.length !== numPlayers) {
        return null;
    }
    const token = parts[seatIdx] ?? "";
    if (token === "" || token === SIMULTANEOUS_ELIM_TOKEN) {
        return "";
    }
    return token;
}

export function moveTextForMoveTableSlot(
    slot: string | IGameRoundSlot | null | undefined,
    seatIdx: number,
    numPlayers: number,
): string {
    const slotText = roundSlotToMoveText(slot);
    if (numPlayers > 1) {
        const wire = wireMoveTokenForSeat(slotText, seatIdx, numPlayers);
        if (wire !== null) {
            return wire;
        }
    }
    return slotText;
}

export function explorationPathHasNPartWireRows(
    path: Array<Array<{ move?: unknown }>> | null | undefined,
    pathLength: number,
    numPlayers: number,
): boolean {
    if (!Array.isArray(path) || pathLength < 1 || numPlayers < 2) {
        return false;
    }
    for (let i = 0; i < pathLength; i++) {
        const move = path[i]?.[0]?.move;
        if (wireMoveTokenForSeat(move, 0, numPlayers) !== null) {
            return true;
        }
    }
    return false;
}

/** Exploration path nodes still store combined wire lastmoves — split per seat per path index. */
export function moveTableRoundsFromExplorationPath(
    path: Array<Array<{ move?: unknown }>>,
    numPlayers: number,
    pathLength: number,
): IGameRound[] {
    const rows: IGameRound[] = [];
    for (let i = 0; i < pathLength; i++) {
        const row: IGameRound = new Array(numPlayers).fill(null);
        const move = path[i]?.[0]?.move;
        for (let seatIdx = 0; seatIdx < numPlayers; seatIdx++) {
            const wire = wireMoveTokenForSeat(move, seatIdx, numPlayers);
            if (wire !== null && wire !== "") {
                row[seatIdx] = wire;
            }
        }
        rows.push(row);
    }
    return rows;
}

function pathIndexFromWireRow(
    rowIdx: number,
    seatIdx: number,
    pathLength: number,
    layout: { useRoundGrid: boolean; numcolumns: number },
    path: Array<Array<{ move?: unknown }>> | null | undefined,
): number | null {
    if (!layout.useRoundGrid || !Array.isArray(path) || rowIdx >= pathLength || layout.numcolumns < 2) {
        return null;
    }
    const move = path[rowIdx]?.[0]?.move;
    const wire = wireMoveTokenForSeat(move, seatIdx, layout.numcolumns);
    if (wire === null || wire === "") {
        return null;
    }
    return rowIdx;
}

/** Where a slot came in its row's play order: its `sequence`, or its seat when it played in seat order. */
function slotPlayOrder(row: IGameRound, seatIdx: number): number {
    const slot = row[seatIdx];
    if (typeof slot === "object" && slot !== null && slot.sequence !== undefined) {
        return slot.sequence;
    }
    return seatIdx + 1;
}

/**
 * Which ply, counting from the first, a cell of packed rows shows. The rows are in
 * order, and within a row each slot's play order says where it came, so the count
 * identifies the ply even when the row did not open with seat 1. Matching by move text
 * would not: a repeated move, such as a second "pass", would find its first occurrence.
 */
function plyIndexForMoveTableCell(rounds: IGameRound[], rowIdx: number, seatIdx: number): number {
    let plyIndex = 0;
    for (let r = 0; r < rowIdx; r++) {
        for (const slot of rounds[r]!) {
            if (slot !== null) {
                plyIndex++;
            }
        }
    }
    const row = rounds[rowIdx]!;
    const order = slotPlayOrder(row, seatIdx);
    for (let s = 0; s < row.length; s++) {
        if (s !== seatIdx && row[s] !== null && slotPlayOrder(row, s) < order) {
            plyIndex++;
        }
    }
    return plyIndex;
}

/**
 * Resolve move-table rounds for layout, including exploration wire fallback.
 */
export function resolveMoveTableRounds(
    game: GameBase,
    ctx: {
        density: MoveTableDensity;
        model: TurnModel;
        pathLength: number;
        path?: Array<Array<{ move?: unknown }>> | null;
    },
): IGameRound[] {
    const { density, model, pathLength, path } = ctx;
    const numPlayers = game.numplayers;
    const stackCount = stackMoveCount(game);
    const rounds = game.getMoveTableRounds({ density, pathLength });

    if (
        pathLength > 0 &&
        Array.isArray(path) &&
        model === "sequenced" &&
        numPlayers > 1 &&
        stackCount >= pathLength &&
        explorationPathHasNPartWireRows(path, pathLength, numPlayers)
    ) {
        const wireRows = moveTableRoundsFromExplorationPath(path, numPlayers, pathLength);
        const fromRounds = game.getRounds();
        if (
            density === "sparse" &&
            stackRoundsLookComplete(fromRounds, pathLength, numPlayers, game)
        ) {
            return fromRounds;
        }
        if (hasMultiplePliesPerStackIndex(game.getPlies())) {
            return rounds;
        }
        return wireRows;
    }

    return rounds;
}

export function pathIndexForMoveTableCell(
    game: GameBase,
    opts: IPathIndexForMoveTableCellOptions,
): number | null {
    const {
        density = "compact",
        model,
        useRoundGrid,
        numcolumns,
        rowIdx,
        seatIdx,
        pathLength,
        path = null,
    } = opts;

    if (!useRoundGrid) {
        const movenum = numcolumns * rowIdx + seatIdx;
        return movenum < pathLength ? movenum : null;
    }

    const rounds = resolveMoveTableRounds(game, { density, model, pathLength, path });
    const layout = { useRoundGrid, numcolumns };

    if (!Array.isArray(rounds) || rowIdx >= rounds.length) {
        const movenum = numcolumns * rowIdx + seatIdx;
        return movenum < pathLength ? movenum : null;
    }

    const row = rounds[rowIdx];
    if (!Array.isArray(row) || seatIdx >= row.length) {
        return pathIndexFromWireRow(rowIdx, seatIdx, pathLength, layout, path);
    }

    if (row[seatIdx] === null) {
        return pathIndexFromWireRow(rowIdx, seatIdx, pathLength, layout, path);
    }

    if (model === "simultaneous") {
        return rowIdx < pathLength ? rowIdx : null;
    }

    if (model === "sequenced" && isStackAlignedRounds(rounds, pathLength)) {
        return rowIdx < pathLength ? rowIdx : null;
    }

    // The cell's ply is at its stack entry, which is the ply's own number when the plies
    // carry no stack index.
    const plyIndex = plyIndexForMoveTableCell(rounds, rowIdx, seatIdx);
    let stackIndex: number | undefined;
    try {
        stackIndex = game.getPlies()[plyIndex]?.stackIndex;
    } catch {
        stackIndex = undefined;
    }
    const pathIdx = stackIndex != null ? stackIndex - 1 : plyIndex;
    return pathIdx < pathLength ? pathIdx : null;
}

export function moveTableRowCountForEngine(
    game: GameBase,
    ctx: {
        density: MoveTableDensity;
        model: TurnModel;
        pathLength: number;
        useRoundGrid: boolean;
        numcolumns: number;
        path?: Array<Array<{ move?: unknown }>> | null;
    },
): number {
    const { pathLength, useRoundGrid, numcolumns, density, model, path } = ctx;
    if (!useRoundGrid) {
        return Math.ceil(pathLength / numcolumns);
    }
    const rounds = resolveMoveTableRounds(game, {
        density,
        model,
        pathLength,
        path,
    });
    if (Array.isArray(rounds) && rounds.length > 0) {
        if (model === "simultaneous") {
            return Math.min(rounds.length, pathLength);
        }
        if (isStackAlignedRounds(rounds, pathLength)) {
            return Math.min(rounds.length, pathLength);
        }
        return rounds.length;
    }
    return Math.ceil(pathLength / numcolumns);
}
