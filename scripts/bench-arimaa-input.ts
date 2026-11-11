/**
 * Arimaa input-mode regression check and click-count benchmark over an archive
 * of recorded games (the archive is not checked in).
 *
 * Usage:
 *   npx tsx scripts/bench-arimaa-input.ts <archive.json> [options]
 *     --game-stride=N     take every Nth game (default 1)
 *     --ply-stride=N      take every Nth eligible ply (default 1)
 *     --shard=I/N         of the games taken, this run handles those at I, I+N, ... (default 0/1)
 *     --max-expansions=N  click-search effort per ply and mode (default 150)
 *     --modes=a,b         of status-quo, basic, advanced (default all three)
 *
 * Every game is replayed in full, trusted, so old games holding moves the
 * rules no longer allow still have to load; those plies are counted and left
 * out of everything else. For each other movement ply (setup and the half
 * turn that opens Endless endgame aside) and each mode, the script looks for
 * the fewest clicks that enter the recorded position: first by clicking the
 * recorded steps in order, then with a best-first search over clicks on the
 * squares involved, capped at --max-expansions. The click that completes a
 * move is not counted. A capped search cannot tell a ply nobody found a way
 * to enter from one that cannot be entered, so those are listed.
 *
 * Whatever is found is checked as well: it has to be a move that can be
 * submitted and reaches the recorded position, is stored without input-only
 * markers, and compares equal to the recorded move both ways, which is what
 * premoves rely on.
 */
/* eslint-disable no-console -- CLI benchmark output */
import { readFileSync } from "node:fs";
import { ArimaaGame, type CellContents, type Piece, type playerid } from "../src/games/arimaa.js";
import { ARIMAA_CAPTURE_CHOICE, captureAlternatives } from "../src/games/arimaa/input.js";

type StepResult = {type: string; from?: string; to?: string; where?: string};
type Ply = {move: string; result?: StepResult[]};
type ArchiveGame = {
    header: {game: {variants: string[]}; startingPosition?: string; site?: {gameid?: string}};
    moves: Array<Array<Ply | null>>;
};
type Mode = "status-quo" | "basic" | "advanced";
type Found = {clicks: number; move: string};
type Step = [string, string];

const argv = process.argv.slice(2);
const archive = argv.find(a => !a.startsWith("--"));
if (archive === undefined) {
    throw new Error("Pass the path of the Arimaa historical-game JSON archive.");
}
const option = (key: string): string | undefined => argv.find(a => a.startsWith(`--${key}=`))?.split("=")[1];
const count = (key: string, fallback: number): number => {
    const n = Number(option(key) ?? fallback);
    if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Invalid --${key}`);
    }
    return n;
};
const gameStride = count("game-stride", 1);
const plyStride = count("ply-stride", 1);
const maxExpansions = count("max-expansions", 150);
const [shard, shards] = (option("shard") ?? "0/1").split("/").map(Number);
const modes = (option("modes") ?? "status-quo,basic,advanced").split(",") as Mode[];
const MAX_CLICKS = 16;

const cell = (square: string): [number, number] => {
    const [x, y] = ArimaaGame.algebraic2coords(square);
    return [y, x];
};
const neighbours = (square: string): string[] => {
    const [x, y] = ArimaaGame.algebraic2coords(square);
    return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
        .filter(([nx, ny]) => nx >= 0 && nx < 8 && ny >= 0 && ny < 8)
        .map(([nx, ny]) => ArimaaGame.coords2algebraic(nx, ny));
};
// Mirror ArimaaGame.maxSteps() (private), including Dicey Moves and the EEE opening.
const stepLimit = (game: ArimaaGame): number =>
    game.die?.steps ?? (game.variants.includes("eee") && game.stack.length === 1 ? 2 : 4);
const trajectories = (game: ArimaaGame): string[] => ArimaaGame.trajectoriesFromResults(game.results)
    .filter(t => t.captured || t.start !== t.final)
    .map(t => `${t.start}>${t.final}${t.captured ? "x" : ""}`);
const preview = (game: ArimaaGame, move: string): {signature?: string; moved: string[]} => {
    try {
        const copy = game.clone();
        copy.move(move, {trusted: true, partial: true});
        return {signature: copy.signature(), moved: trajectories(copy)};
    } catch {
        return {moved: []};
    }
};
const click = (game: ArimaaGame, move: string, target: string, mode: Mode): string | undefined => {
    try {
        const r = game.handleClick(move, ...cell(target.replace("^", "")), target.startsWith("^") ? ARIMAA_CAPTURE_CHOICE : undefined, {inputMode: mode});
        return r.valid ? r.move : undefined;
    } catch {
        return undefined;
    }
};
const submittable = (game: ArimaaGame, move: string, expected: string): boolean => {
    if (move.length === 0 || preview(game, move).signature !== expected) {
        return false;
    }
    const v = game.validateMove(move);
    return v.valid && (v.complete ?? -1) >= 0;
};

// The recorded steps as clicks: a piece and where its run of steps ends
// (`merge`) or each step on its own; pusher, pushed piece and where that
// goes; pulled piece, puller and where that goes.
const stepClicks = (game: ArimaaGame, steps: Step[], merge: boolean): string[] => {
    const owner = new Map([...game.board].map(([sq, [, o]]): [string, number] => [sq, o]));
    const mine = (sq: string): boolean => owner.get(sq) === game.currplayer;
    const go = (from: string, to: string): void => {
        owner.set(to, owner.get(from)!);
        owner.delete(from);
    };
    const out: string[][] = [];
    for (let i = 0; i < steps.length; i++) {
        const [from, to] = steps[i];
        const next = steps[i + 1];
        if (next !== undefined && next[1] === from && owner.has(next[0]) && mine(next[0]) !== mine(from)) {
            out.push([next[0], from, to]);
            go(from, to);
            go(next[0], next[1]);
            i++;
            continue;
        }
        const last = out[out.length - 1];
        if (merge && last !== undefined && last.length === 2 && last[1] === from) {
            last[1] = to;
        } else {
            out.push([from, to]);
        }
        go(from, to);
    }
    return out.flat();
};
// What a player would do first: the recorded steps in order, or in the old
// arrow entry one arrow for each piece that ends up somewhere else.
const straightforward = (game: ArimaaGame, steps: Step[], wanted: string[], expected: string, mode: Mode): Found | undefined => {
    const attempts = mode === "status-quo" ?
        [wanted.filter(w => !w.endsWith("x")).flatMap(w => w.split(">"))] :
        [stepClicks(game, steps, true), stepClicks(game, steps, false)];
    let best: Found | undefined;
    for (const squares of attempts) {
        let move = "";
        for (const sq of squares) {
            move = click(game, move, sq, mode) ?? move;
        }
        if (submittable(game, move, expected) && (best === undefined || squares.length < best.clicks)) {
            best = {clicks: squares.length, move};
        }
    }
    return best;
};
// Best-first over click sequences, ordered by clicks made plus how far the
// preview is from the recorded trajectories, for anything under `bound` clicks.
const search = (game: ArimaaGame, steps: Step[], wanted: string[], expected: string, mode: Mode, bound: number): Found | undefined => {
    const squares = new Set<string>();
    for (const [from, to] of steps) {
        for (const sq of [from, to, ...neighbours(from), ...neighbours(to)]) {
            squares.add(sq);
        }
    }
    const want = new Set(wanted);
    const distance = (move: string): number => {
        const moved = preview(game, move).moved;
        return wanted.filter(w => !moved.includes(w)).length + moved.filter(m => !want.has(m)).length +
            (/ ?[a-h][1-8]$/.test(move) ? 0.5 : 0);
    };
    const open: Array<{move: string; clicks: number; f: number}> = [{move: "", clicks: 0, f: wanted.length}];
    const seen = new Set([""]);
    for (let expanded = 0; open.length > 0 && expanded < maxExpansions;) {
        open.sort((a, b) => a.f - b.f || a.clicks - b.clicks);
        const state = open.shift()!;
        if (submittable(game, state.move, expected)) {
            return {clicks: state.clicks, move: state.move};
        }
        if (state.clicks >= Math.min(MAX_CLICKS, bound - 1)) {
            continue;
        }
        expanded++;
        const targets = [...squares];
        if (mode === "advanced") {
            targets.push(...captureAlternatives(game.board, game.currplayer, stepLimit(game), state.move).map(t => `^${t}`));
        }
        for (const target of targets) {
            const move = click(game, state.move, target, mode);
            if (move === undefined || move === state.move || seen.has(move)) {
                continue;
            }
            seen.add(move);
            open.push({move, clicks: state.clicks + 1, f: state.clicks + 1 + 2.5 * distance(move)});
        }
    }
    return undefined;
};

const initialPosition = (s: string): Map<string, CellContents> => {
    const board = new Map<string, CellContents>();
    for (const term of s.split(",").filter(Boolean)) {
        const owner: playerid = term[0] === term[0].toUpperCase() ? 1 : 2;
        board.set(term.slice(1), [term[0].toUpperCase() as Piece, owner]);
    }
    return board;
};

const records = (JSON.parse(readFileSync(archive, "utf8")) as ArchiveGame[])
    .filter((_, i) => i % gameStride === 0)
    .filter((_, i) => i % shards === shard);
const tally = Object.fromEntries(modes.map(mode => [mode, {found: 0, missing: 0, clicks: 0, seconds: 0}])) as
    Record<Mode, {found: number; missing: number; clicks: number; seconds: number}>;
const common = {plies: 0, clicks: Object.fromEntries(modes.map(mode => [mode, 0])) as Record<Mode, number>};
const notFound: string[] = [];
const problems: Array<Record<string, string | number>> = [];
let replayed = 0, eligible = 0, measured = 0, illegal = 0, setup = 0, skippedOpening = 0;

for (const record of records) {
    const id = record.header.site?.gameid ?? "unknown";
    const names = record.header.game.variants;
    const eee = names.includes("Endless endgame");
    const game = new ArimaaGame(undefined, eee ? ["eee"] : names.includes("Free placement") ? ["free"] : []);
    if (eee && record.header.startingPosition) {
        const board = initialPosition(record.header.startingPosition);
        game.board = board;
        game.stack[0].board = new Map(board);
    }
    let number = 0;
    for (const ply of record.moves.flat()) {
        number++;
        const actions = ply?.result ?? [];
        const moving = actions.some(a => a.type === "move");
        const placing = actions.some(a => a.type === "place");
        if (ply === null || !(moving || placing)) {
            continue;
        }
        if (placing) {
            setup++;
        } else if (eee && number === 1) {
            skippedOpening++;
        } else {
            const before = game.clone();
            const validation = before.validateMove(ply.move);
            if (!validation.valid || (validation.complete ?? -1) < 0) {
                illegal++;
            } else if (eligible++ % plyStride === 0) {
                measured++;
                const reference = before.clone().move(ply.move);
                const expected = reference.signature();
                const wanted = trajectories(reference);
                const steps = actions.filter(a => a.type === "move").map((a): Step => [a.from!, a.to!]);
                const best: Partial<Record<Mode, Found>> = {};
                for (const mode of modes) {
                    const started = Date.now();
                    const direct = straightforward(before, steps, wanted, expected, mode);
                    const found = search(before, steps, wanted, expected, mode, direct?.clicks ?? Infinity) ?? direct;
                    tally[mode].seconds += (Date.now() - started) / 1000;
                    if (found === undefined) {
                        tally[mode].missing++;
                        notFound.push(`${mode} ${id} ply ${number}: ${ply.move}`);
                        continue;
                    }
                    best[mode] = found;
                    tally[mode].found++;
                    tally[mode].clicks += found.clicks;
                    if (mode === "status-quo") {
                        continue;
                    }
                    const fail = (kind: string): number => problems.push({kind, mode, game: id, ply: number, entered: found.move, recorded: ply.move});
                    try {
                        const after = before.clone().move(found.move);
                        if (after.signature() !== expected) fail("submits a different position");
                        if (/[a-h1-8EMHDCRemhdcr]o( |$)/.test(after.lastmove ?? "")) fail("stores an input-only marker");
                        if (!reference.sameMove(reference.lastmove!, found.move)) fail("recorded move does not compare equal to the entry");
                        if (!after.sameMove(after.lastmove!, ply.move)) fail("entry does not compare equal to the recorded move");
                    } catch (e) {
                        fail(`cannot be submitted: ${String(e)}`);
                    }
                }
                if (modes.every(mode => best[mode] !== undefined)) {
                    common.plies++;
                    for (const mode of modes) {
                        common.clicks[mode] += best[mode]!.clicks;
                    }
                }
            }
        }
        // Old games with illegal plies are replayed all the same, so they stay browsable.
        try {
            game.move(ply.move, {trusted: true});
            replayed++;
        } catch (e) {
            throw new Error(`Archive replay failed at ${id}, ply ${number}: ${String(e)}`);
        }
    }
    console.error(`${id}: ${measured} plies measured so far`);
}

const round = (n: number): number => Math.round(n * 100) / 100;
console.log(JSON.stringify({
    games: records.length, replayedPlies: replayed, setupPlies: setup, skippedEndlessEndgameOpenings: skippedOpening,
    illegalPliesLeftOut: illegal, eligiblePlies: eligible, measuredPlies: measured,
    search: {maxExpansions, maxClicks: MAX_CLICKS, completionClickCounted: false},
    modes: Object.fromEntries(modes.map(mode => [mode, {
        found: tally[mode].found,
        notFound: tally[mode].missing,
        averageClicks: tally[mode].found === 0 ? null : round(tally[mode].clicks / tally[mode].found),
        secondsPerPly: measured === 0 ? null : round(tally[mode].seconds / measured),
    }])),
    foundInEveryMode: {
        plies: common.plies,
        averageClicks: Object.fromEntries(modes.map(mode => [mode, common.plies === 0 ? null : round(common.clicks[mode] / common.plies)])),
    },
    problems,
    notFound,
}, null, 2));
