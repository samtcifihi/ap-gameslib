/**
 * Historical Arimaa input-mode replay and bounded shortest-click search.
 *
 * Usage:
 *   npx tsx scripts/bench-arimaa-input.ts /path/to/arimaa-games-2026-11-07.json
 *   npx tsx scripts/bench-arimaa-input.ts /path/to/archive.json --max-expansions=80 --limit-games=25
 *
 * The full historical archive is deliberately not checked into the repository.
 * The input paths are breadth-first searched with a per-move expansion limit;
 * 'not found' means unverified, not necessarily impossible. Completion clicks
 * are excluded from the click count. Old illegal games remain readable using
 * trusted replay but are excluded from input and click statistics.
 */
import { readFileSync } from "node:fs";
import { ArimaaGame, type CellContents, type Piece, type playerid } from "../src/games/arimaa.js";

type StepResult = {type: string; from?: string; to?: string; where?: string};
type Ply = {move: string; result?: StepResult[]};
type ArchiveGame = {
    header: {game: {variants: string[]}; startingPosition?: string; site?: {gameid?: string}};
    moves: Ply[][];
};
type Mode = "status-quo" | "basic" | "advanced";

const argv = process.argv.slice(2);
const archive = argv.find(s => !s.startsWith("--"));
if (archive === undefined) {
    throw new Error("Pass the path of the Arimaa historical-game JSON archive.");
}
const argNumber = (key: string, fallback: number): number => {
    const value = argv.find(a => a.startsWith(`--${key}=`));
    const num = value === undefined ? fallback : Number(value.split("=")[1]);
    if (!Number.isInteger(num) || num <= 0) {
        throw new Error(`Invalid --${key}`);
    }
    return num;
};
const maxExpansions = argNumber("max-expansions", 80);
const maxClicks = argNumber("max-clicks", 12);
const limitGames = argNumber("limit-games", 2147483647);
const gameRecords = JSON.parse(readFileSync(archive, "utf8")) as ArchiveGame[];
const modes: Mode[] = ["status-quo", "basic", "advanced"];
const total = Object.fromEntries(modes.map(mode => [mode, {found: 0, missing: 0, clicks: 0, capped: 0}])) as
    Record<Mode, {found: number; missing: number; clicks: number; capped: number}>;
let legalPlies = 0, illegalPlies = 0, setupPlies = 0, skippedFirstEEE = 0, replays = 0;
const missing: Array<{game: string; ply: number; mode: Mode; move: string}> = [];

const cell = (square: string): [number, number] => {
    const [x, y] = ArimaaGame.algebraic2coords(square);
    return [y, x];
};
const signature = (game: ArimaaGame, notation: string): string | undefined => {
    try {
        const copy = game.clone();
        copy.move(notation, {trusted: true, partial: true});
        return copy.signature();
    } catch {
        return undefined;
    }
};
const opts = (step: Ply, game: ArimaaGame): string[] => {
    const interest = new Set<string>();
    for (const r of step.result ?? []) {
        for (const sq of [r.from, r.to, r.where]) {
            if (sq !== undefined && /^[a-h][1-8]$/.test(sq)) interest.add(sq);
        }
    }
    // Include neighbours, particularly the friendly pusher/puller which may
    // not have moved in the archived notation until a later step.
    for (const sq of [...interest]) {
        const [r, c] = cell(sq);
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                interest.add(ArimaaGame.coords2algebraic(nc, nr));
            }
        }
    }
    for (const square of game.board.keys()) {
        if (interest.size === 0) interest.add(square);
    }
    for (const trap of ["c3", "f3", "c6", "f6"]) {
        interest.add(trap);
    }
    return [...interest];
};
const find = (game: ArimaaGame, step: Ply, expected: string, mode: Mode): {clicks?: number; capped: boolean} => {
    const candidates = opts(step, game);
    const queue: Array<{move: string; clicks: number}> = [{move: "", clicks: 0}];
    const seen = new Set([""]);
    let expanded = 0;
    for (let head = 0; head < queue.length && expanded < maxExpansions; head++) {
        const state = queue[head];
        if (state.move.length > 0 && signature(game, state.move) === expected) {
            return {clicks: state.clicks, capped: false};
        }
        if (state.clicks >= maxClicks) continue;
        expanded++;
        for (const sq of candidates) {
            let result: ReturnType<ArimaaGame["handleClick"]>;
            try {
                result = game.handleClick(state.move, ...cell(sq), undefined, {inputMode: mode});
            } catch {
                continue;
            }
            if (!result.valid || result.move === undefined || result.move === state.move || seen.has(result.move)) continue;
            seen.add(result.move);
            queue.push({move: result.move, clicks: state.clicks + 1});
        }
    }
    return {capped: expanded >= maxExpansions};
};
const initialPosition = (s: string): Map<string, CellContents> => {
    const board = new Map<string, CellContents>();
    for (const term of s.split(",").filter(Boolean)) {
        const owner: playerid = term[0] === term[0].toUpperCase() ? 1 : 2;
        board.set(term.slice(1), [term[0].toUpperCase() as Piece, owner]);
    }
    return board;
};
for (const record of gameRecords.slice(0, limitGames)) {
    const vv = record.header.game.variants;
    const eee = vv.includes("Endless endgame");
    const variants = eee ? ["eee"] : vv.includes("Free placement") ? ["free"] : [];
    const game = new ArimaaGame(undefined, variants);
    if (eee && record.header.startingPosition) {
        const board = initialPosition(record.header.startingPosition);
        game.board = board;
        game.stack[0].board = new Map(board);
    }
    let number = 0;
    for (const round of record.moves) {
        for (const ply of round) {
            number++;
            console.error(`Game ${record.header.site?.gameid ?? "unknown"}, ply ${number}`);
            const actions = ply.result ?? [];
            const playable = actions.some(a => a.type === "move");
            const setup = actions.some(a => a.type === "place");
            if (setup) setupPlies++;
            if (eee && number === 1) skippedFirstEEE++;
            const before = game.clone();
            const legal = playable && before.validateMove(ply.move).valid;
            const eligible = legal && !setup && !(eee && number === 1);
            if (playable && !legal) illegalPlies++;
            let expected: string | undefined;
            if (eligible) {
                expected = signature(before, ply.move);
                if (expected !== undefined) {
                    legalPlies++;
                    for (const mode of modes) {
                        const result = find(before, ply, expected, mode);
                        if (result.clicks !== undefined) {
                            total[mode].found++;
                            total[mode].clicks += result.clicks;
                        } else {
                            total[mode].missing++;
                            if (result.capped) total[mode].capped++;
                            if (missing.length < 200) {
                                missing.push({game: record.header.site?.gameid ?? "unknown", ply: number, mode, move: ply.move});
                            }
                        }
                    }
                }
            }
            // Historical games with illegal plies are always replayed so they
            // remain browsable, but they never contaminate input statistics.
            if (playable || setup) {
                try {
                    game.move(ply.move, {trusted: true});
                    replays++;
                } catch (e) {
                    throw new Error(`Archive replay failed at ${record.header.site?.gameid}, ply ${number}: ${String(e)}`);
                }
            }
        }
    }
}
console.log(JSON.stringify({
    games: Math.min(gameRecords.length, limitGames), replays, legalPlies,
    illegalPlies, setupPlies, skippedFirstEEE,
    search: {maxExpansions, maxClicks, completionClickCounted: false},
    modes: Object.fromEntries(modes.map(mode => [mode, {
        ...total[mode],
        averageClicksOnFound: total[mode].found === 0 ? null : total[mode].clicks / total[mode].found,
    }])), examplesNotFound: missing,
}, null, 2));
