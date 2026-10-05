import { GameBase, IAPGameState, IClickResult, ICustomButton, IIndividualState, IRenderOpts, IScores, IStatus, IValidationResult, type ChatLogCollectContext, type ChatLogLine } from "./_base.js";
import type { APGamesInformation } from "../schemas/gameinfo.js";
import type { APRenderRep, AreaTrack, BoardBasic, Glyph, MarkerDots, MarkerLine, RowCol } from "@abstractplay/renderer/build/schemas/schema";
import type { APMoveResult } from "../schemas/moveresults.js";
import { reviver, shuffle, SnubSquareGraph, UserFacingError } from "../common/index.js";
import type { FlagContext, GameFlag } from "../common/flags.js";
import type { IGamePly, IGameRound, TurnModel } from "./_turn-model.js";
import { defaultShouldCloseRound } from "./_turn-plies.js";
import { sequencedShouldCloseRound } from "./_turn-sequenced.js";
import { makeGeometry, otherColour, passAliveStrings, signature, stringAt, type Board, type Geometry, type Stone } from "./killallgo.js";
import i18next from "i18next";

/**
 * Thue-Morse Go.
 *
 * Go under Tromp-Taylor rules in which the order of placements follows the Thue-Morse sequence
 * (0110 1001 1001 0110 …): placement n belongs to colour 1 when n has an even number of 1 bits
 * and to colour 2 otherwise. A move is a maximal run of placements by one colour, so every move
 * is one or two placements and the seats alternate moves exactly as in ordinary Go.
 *
 * Colours are seats in the standard game. In the Kill-All variant colour 1 is the Defender
 * (Red, who places first) and colour 2 the Attacker (Blue); `defenderSeat` records which seat
 * plays Red once pieboxing has decided it.
 */
type playerid = 1 | 2;

type Phase =
    | "hand-n"      // Kill-All handicap: Player 1 types the number of extra Attacker stones
    | "alt-place"   // Kill-All pieboxing: alternating Attacker stones until someone takes them
    | "komi"        // Reverse komi: Player 2 types the points added to their score
    | "play";       // Thue-Morse placements

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Board;
    lastmove?: string;
    phase: Phase;
    /** Index of the next placement; its Thue-Morse digit names the colour to place. */
    placed: number;
    /** Seats of the trailing run of moves that consisted only of voluntary passes. */
    passes: playerid[];
    /** Positions this move created other than the saved board (positional superko, repetition). */
    interim: string[];
    /** Whether the saved board is a position this move created (false after a move without a stone). */
    novel: boolean;
    /** Stones of the strings marked dead by the pending whole-move pass, in board order. */
    marks: string[];
    /** Whether this move was a whole-move pass that changed the marking it answered. */
    dispute: boolean;
    /** Whether both players have changed the marking in turn, after which passes carry none. */
    locked: boolean;
    /** The seat holding the button. */
    button?: playerid;
    /** The declared handicap: passes in the standard game, extra Attacker stones in Kill-All. */
    handicap?: number;
    /** Standard handicap: passes Player 2 still has to serve. */
    passesOwed?: number;
    /** Reverse komi: the points Player 2 chose to have added to their score. */
    komi?: number;
    defenderSeat?: playerid;
    /** The stones that decided a Kill-All game. */
    alive?: string[];
}

export interface IThueMorseGoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
}

interface ILegend {
    [key: string]: Glyph | [Glyph, ...Glyph[]];
}

/** An empty region of the board and the colour it scores for, when it reaches only one. */
interface IRegion {
    cells: string[];
    owner?: Stone;
}

/** One numbered stone of the on-board handicap picker. */
interface IPickerButton {
    cell: string;
    value: number;
}

/**
 * A move in progress: the board and bookkeeping as the placements of one move are applied, on a
 * scratch copy while validating and enumerating, and committed to the game when a move is made.
 */
interface ISim {
    board: Board;
    /** Occurrence counts of every position reached before this move (shared, never mutated). */
    base: Map<string, number>;
    results: APMoveResult[];
    /** The position at the start of the move. */
    start: string;
    /** Positions created so far in this move, in order; the last is the board as it stands. */
    created: string[];
    /** Opponent stones captured so far in this move. */
    captured: number;
    /** Own stones removed by suicide so far in this move. */
    suicided: number;
    /** Placements in this move. */
    length: number;
    /** Placements consumed so far, the handicap passes served at its start included. */
    placed: number;
    buttonTaken: boolean;
    placedStone: boolean;
    /** Checked weak eyes: whether the move's deferred clearing has happened. */
    cleared: boolean;
    /** Whether the game ended during this move (repetition draw). */
    over: boolean;
}

const UNDECIDED_COLOUR = "#999999";
const CELL_RE = /^[a-z]+\d+$/;
const TRACK_ROWS = 16;
const MIN_TRACK_DIGITS = 3;
/** sqrt(1/3): the small tracker glyphs have about a third of the area of the digit markers. */
const SMALL_SCALE = 0.57735;
const TRACK_TINT = 0.2;
/**
 * The marker glyphs name the border colour the `piece` glyph has anyway. That gives them their own
 * paint, and so their own symbol, in renderer builds that share one symbol per glyph and paint and
 * would otherwise draw the markers at the small glyphs' scale.
 */
const MARKER_BORDER = "#000";
const REPETITIONS_FOR_DRAW = 5;
const PICKER_MAX = 18;
/** The legend keys of the tracker's glyphs: the small stones s1/s2 and the digit markers m1d0 to m2df. */
const TRACK_KEY_RE = /^(s[12]|m[12]d[0-9a-f])$/;
/** Opacity of a stone marked dead. */
const DEAD_OPACITY = 0.4;
/** Diameter of a territory dot as a fraction of a cell, the size of the renderer's own dots. */
const DOT_SIZE = 0.2;
/** Diameter of a star point as a fraction of a cell, the size the renderer draws its own. */
const STAR_SIZE = 0.15;
/** Scale of the digit written on a tracker marker. */
const DIGIT_SCALE = 0.75;
/** Stroke width of the border around the tracker's columns, in the track board's own units. */
const TRACK_BORDER_WIDTH = 8;

const popcount = (n: number): number => {
    let count = 0;
    let rest = n;
    while (rest > 0) {
        count += rest & 1;
        rest = Math.floor(rest / 2);
    }
    return count;
};

const snubGeometryCache = new Map<number, Geometry>();

/** The snub square board as a `Geometry`, so the shared Go helpers can walk it. */
const makeSnubGeometry = (size: number): Geometry => {
    const cached = snubGeometryCache.get(size);
    if (cached !== undefined) {
        return cached;
    }
    const graph = new SnubSquareGraph(size, size);
    const cells: string[] = [];
    const neighbours = new Map<string, string[]>();
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const cell = graph.coords2algebraic(x, y);
            cells.push(cell);
            neighbours.set(cell, graph.neighbours(cell));
        }
    }
    const geo: Geometry = {
        size,
        cells,
        neighbours,
        coords2algebraic: (x: number, y: number) => graph.coords2algebraic(x, y),
        algebraic2coords: (cell: string) => graph.algebraic2coords(cell),
    };
    snubGeometryCache.set(size, geo);
    return geo;
};

/** Remove every string of `colour` that has no liberties; returns the strings removed. */
const clearColour = (board: Board, geo: Geometry, colour: Stone): string[][] => {
    const removed: string[][] = [];
    const seen = new Set<string>();
    for (const cell of geo.cells) {
        if (board.get(cell) !== colour || seen.has(cell)) {
            continue;
        }
        const info = stringAt(board, geo, cell);
        for (const stone of info.stones) {
            seen.add(stone);
        }
        if (info.liberties.size === 0) {
            for (const stone of info.stones) {
                board.delete(stone);
            }
            removed.push(info.stones);
        }
    }
    return removed;
};

export class ThueMorseGoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Thue-Morse Go",
        uid: "thuemorsego",
        playercounts: [2],
        version: "20261004",
        dateAdded: "2026-10-04",
        // i18next.t("apgames:descriptions.thuemorsego")
        description: "apgames:descriptions.thuemorsego",
        // i18next.t("apgames:notes.thuemorsego")
        notes: "apgames:notes.thuemorsego",
        urls: [
            "https://forums.online-go.com/t/thue-morse-fair-sharing-sequence-a-possible-alternative-to-komi/22547",
            "https://www.reddit.com/r/baduk/comments/65nx60/using_the_thuemorse_sequence_to_determine_whose/",
            "https://www.reddit.com/r/baduk/comments/92clfm/how_would_go_using_the_thuemorse_fairestsharing/",
            "https://www.youtube.com/watch?v=prh72BLNjIk",
            "https://www.chessvariants.com/multimove.dir/marseill.html",
            "https://en.wikipedia.org/wiki/Thue%E2%80%93Morse_sequence",
            "https://tromp.github.io/go.html",
        ],
        // The Thue-Morse order was proposed for Go independently at least three times; the Online
        // Go Forum community then built tools, ran tournaments and settled the rules used here.
        people: [
            {
                type: "designer",
                name: "atimholt",
                urls: ["https://www.reddit.com/r/baduk/comments/65nx60/using_the_thuemorse_sequence_to_determine_whose/"],
            },
            {
                type: "designer",
                name: "TheElvenAngelCatboy",
                urls: ["https://www.reddit.com/r/baduk/comments/92clfm/how_would_go_using_the_thuemorse_fairestsharing/"],
            },
            {
                type: "designer",
                name: "BHydden",
                urls: ["https://forums.online-go.com/t/thue-morse-fair-sharing-sequence-a-possible-alternative-to-komi/22547"],
            },
            {
                type: "other",
                name: "Online Go Forum community",
                urls: ["https://forums.online-go.com/t/thue-morse-fair-sharing-sequence-a-possible-alternative-to-komi/22547"],
            },
            {
                type: "coder",
                name: "Samraku",
                urls: [],
                apid: "6ea91933-1262-41a5-b5f3-a6af70692296",
            },
        ],
        variants: [
            { uid: "size-11", group: "board", fans: true },
            { uid: "#board", fans: true },
            { uid: "size-19", group: "board", fans: true },
            { uid: "size-23", group: "board", fans: true },
            { uid: "#connect", fans: true },
            { uid: "snub", group: "connect", fans: true },
            { uid: "#protocol", fans: true },
            {
                uid: "marseillais",
                group: "protocol",
                fans: true,
                people: [
                    {
                        type: "designer",
                        name: "Robert Bruce",
                        urls: ["https://www.chessvariants.com/multimove.dir/marseill.html"],
                    },
                ],
            },
            { uid: "handicap", unrated: true, fans: true },
            { uid: "reverse-komi", unrated: true, fans: true, conflictsWith: ["kill-all"] },
            { uid: "#repetition", fans: true },
            { uid: "repetition-draw", group: "repetition", fans: true, default: true },
            { uid: "weak-eyes", fans: true },
            { uid: "#button", fans: true },
            { uid: "button", group: "button", fans: true },
            { uid: "half-button", group: "button", fans: true },
            { uid: "kill-all", enabledWhen: { button: ["#button"] }, fans: true },
        ],
        categories: ["goal>area", "goal>cripple", "mechanic>place", "mechanic>capture", "mechanic>enclose", "board>shape>rect", "board>connect>rect", "board>connect>snub", "components>simple>1per"],
        flags: ["experimental", "scores", "custom-buttons", "no-moves", "custom-randomization"],
        displays: [{ uid: "rolling" }, { uid: "digits-down" }, { uid: "swap-colours" }, { uid: "hide-territory" }],
        customizations: [
            {
                num: 1,
                default: 1,
                explanation: "Colour of the stones placed at the Thue-Morse 0 placements: Player 1, or the Defender in Kill-All games",
            },
            {
                num: 2,
                default: 2,
                explanation: "Colour of the stones placed at the Thue-Morse 1 placements: Player 2, or the Attacker in Kill-All games",
            },
        ],
    };

    /** Kill-All games have no scores, and their colours follow roles rather than seats. */
    public static resolveFlags(context: FlagContext = {}): readonly GameFlag[] {
        const flags: GameFlag[] = [...(this.gameinfo.flags ?? [])];
        if (context.variants?.includes("kill-all")) {
            flags.push("custom-colours");
            return flags.filter((flag) => flag !== "scores");
        }
        return flags;
    }

    public numplayers = 2;
    public currplayer: playerid = 1;
    public board!: Board;
    public phase!: Phase;
    public placed = 0;
    public passes: playerid[] = [];
    public interim: string[] = [];
    public novel = false;
    public marks: string[] = [];
    public dispute = false;
    public locked = false;
    public button?: playerid;
    public handicap?: number;
    public passesOwed = 0;
    public komi?: number;
    public defenderSeat?: playerid;
    public alive?: string[];
    public gameover = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];
    private boardSize = 16;
    private geo!: Geometry;

    constructor(state?: IThueMorseGoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            if (variants !== undefined && variants.length > 0) {
                this.variants = this.applyVariantConstraints(variants);
            }
            let phase: Phase = "play";
            let currplayer: playerid = 1;
            if (this.variants.includes("kill-all")) {
                phase = this.variants.includes("handicap") ? "hand-n" : "alt-place";
            } else if (this.variants.includes("reverse-komi")) {
                // Player 2 sets the reverse komi before the first placement.
                phase = "komi";
                currplayer = 2;
            }
            const fresh: IMoveState = {
                _version: ThueMorseGoGame.gameinfo.version,
                _results: [],
                _timestamp: new Date(),
                currplayer,
                board: new Map(),
                phase,
                placed: 0,
                passes: [],
                interim: [],
                novel: false,
                marks: [],
                dispute: false,
                locked: false,
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                if (!state.startsWith("{") && !state.startsWith("[")) {
                    throw new Error("Compressed game state must be decompressed before constructing the engine.");
                }
                state = JSON.parse(state, reviver) as IThueMorseGoState;
            }
            if (state.game !== ThueMorseGoGame.gameinfo.uid) {
                throw new Error(`The Thue-Morse Go engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx = -1): ThueMorseGoGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if (idx < 0 || idx >= this.stack.length) {
            throw new Error("Could not load the requested state from the stack.");
        }
        const state = this.stack[idx];
        this.results = [...state._results];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.phase = state.phase;
        this.placed = state.placed;
        this.passes = [...state.passes];
        this.interim = [...state.interim];
        this.novel = state.novel;
        this.marks = [...state.marks];
        this.dispute = state.dispute;
        this.locked = state.locked;
        this.button = state.button;
        this.handicap = state.handicap;
        this.passesOwed = state.passesOwed ?? 0;
        this.komi = state.komi;
        this.defenderSeat = state.defenderSeat;
        this.alive = state.alive === undefined ? undefined : [...state.alive];
        this.boardSize = ThueMorseGoGame.sizeFromVariants(this.variants);
        this.geo = this.variants.includes("snub") ? makeSnubGeometry(this.boardSize) : makeGeometry(this.boardSize);
        return this;
    }

    private static sizeFromVariants(variants: string[]): number {
        if (variants.includes("size-11")) { return 11; }
        if (variants.includes("size-19")) { return 19; }
        if (variants.includes("size-23")) { return 23; }
        return 16;
    }

    // -----------------------------------------------------------------------
    // Variants
    // -----------------------------------------------------------------------

    private get killAll(): boolean {
        return this.variants.includes("kill-all");
    }

    private get handicapVariant(): boolean {
        return this.variants.includes("handicap");
    }

    private get reverseKomi(): boolean {
        return this.variants.includes("reverse-komi");
    }

    /** Reverse komi: the most points Player 2 may give either way, two short of the board. */
    private get maxKomi(): number {
        return this.points - 2;
    }

    /** Checked weak eyes: only the last placement of a move clears the board. */
    private get checkedEyes(): boolean {
        return this.variants.includes("weak-eyes");
    }

    private get repetitionDraw(): boolean {
        return this.variants.includes("repetition-draw");
    }

    private get buttonValue(): number {
        if (this.killAll) {
            return 0;
        }
        if (this.variants.includes("button")) {
            return 1;
        }
        return this.variants.includes("half-button") ? 0.5 : 0;
    }

    /** The period of a repeating protocol (Balanced Marseillais: ABBA), or 0 for the full sequence. */
    private get period(): number {
        return this.variants.includes("marseillais") ? 4 : 0;
    }

    /**
     * Vital regions a string needs to be pass-alive. With checked weak eyes the opponent can fill
     * two liberties before any clearing, so two vital regions are not enough: Benson's argument
     * then needs three, which the two-placement move cannot all empty at once.
     */
    private get minVital(): number {
        return this.checkedEyes ? 3 : 2;
    }

    // -----------------------------------------------------------------------
    // The sequence
    // -----------------------------------------------------------------------

    /** The Thue-Morse digit of placement `n`: the parity of its 1 bits (within one period of a repeating protocol). */
    public digitAt(n: number): 0 | 1 {
        const idx = this.period === 0 ? n : n % this.period;
        return (popcount(idx) % 2) as 0 | 1;
    }

    public colourAt(n: number): Stone {
        return this.digitAt(n) === 0 ? 1 : 2;
    }

    /** The number of placements in the move that starts at placement `n`: the run of its colour. */
    public moveLength(n: number): number {
        let length = 1;
        while (this.colourAt(n + length) === this.colourAt(n)) {
            length++;
        }
        return length;
    }

    // -----------------------------------------------------------------------
    // Turn model
    // -----------------------------------------------------------------------

    /**
     * Reverse komi opens the game with a ply by Player 2, which the sequential move table would
     * lay in Player 1's column. The sequenced model places plies by their actor; the komi takes
     * a row of its own, and the placements then pair up from Player 1 as usual.
     */
    public turnModel(): TurnModel {
        return this.reverseKomi ? "sequenced" : "sequential";
    }

    protected shouldCloseRound(roundPlies: IGamePly[], stackIndex: number): boolean {
        if (!this.reverseKomi) {
            return defaultShouldCloseRound(this, roundPlies);
        }
        if (this.stack[stackIndex - 1].phase === "komi") {
            return true;
        }
        return sequencedShouldCloseRound(this, roundPlies, stackIndex);
    }

    public getRounds(): IGameRound[] {
        if (!this.reverseKomi) {
            return super.getRounds();
        }
        return this.getPlies().map((ply) => this.buildRoundRow([ply]));
    }

    protected compactExportRounds(rounds: IGameRound[]): IGameRound[] {
        return this.reverseKomi ? rounds : super.compactExportRounds(rounds);
    }

    // -----------------------------------------------------------------------
    // Seats and colours
    // -----------------------------------------------------------------------

    private otherSeat(seat: playerid): playerid {
        return seat === 1 ? 2 : 1;
    }

    private get attackerSeat(): playerid | undefined {
        return this.defenderSeat === undefined ? undefined : this.otherSeat(this.defenderSeat);
    }

    private colourOfSeat(seat: playerid): Stone | undefined {
        if (!this.killAll) {
            return seat;
        }
        if (this.defenderSeat === undefined) {
            return undefined;
        }
        return seat === this.defenderSeat ? 1 : 2;
    }

    /** The palette slot a stone colour is drawn in; the swap display exchanges them in Kill-All games. */
    private paletteOfColour(colour: Stone, swap: boolean): number {
        if (this.killAll && swap) {
            return otherColour(colour);
        }
        return colour;
    }

    public getPlayerColour(p: playerid): number | string {
        if (!this.killAll) {
            return p;
        }
        if (this.defenderSeat === undefined) {
            return UNDECIDED_COLOUR;
        }
        return this.colourOfSeat(p)!;
    }

    public coords2algebraic(x: number, y: number): string {
        return this.geo.coords2algebraic(x, y);
    }

    public algebraic2coords(cell: string): [number, number] {
        return this.geo.algebraic2coords(cell);
    }

    private get points(): number {
        return this.boardSize * this.boardSize;
    }

    /**
     * The most Attacker stones one Kill-All setup phase may contribute: just under half the board,
     * so the two phases together can never cover every point, which is what keeps whole-board
     * suicide (and so a repeated position) out of the setup without simulating it.
     */
    private maxSetupStones(): number {
        return Math.floor((this.points - 1) / 2);
    }

    private isValidCell(cell: string): boolean {
        if (!CELL_RE.test(cell)) {
            return false;
        }
        try {
            const [x, y] = this.geo.algebraic2coords(cell);
            return x >= 0 && y >= 0 && x < this.boardSize && y < this.boardSize;
        } catch {
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // Turn structure
    // -----------------------------------------------------------------------

    /** Standard handicap: whether this is Player 2's first move, in which the handicap is set. */
    private declaring(): boolean {
        return this.handicapVariant && !this.killAll && this.phase === "play" && this.placed === 1 && this.currplayer === 2;
    }

    /** Standard handicap: the passes served at the start of the current move. */
    private forcedPasses(): number {
        if (this.killAll || this.phase !== "play" || this.currplayer !== 2 || this.passesOwed <= 0) {
            return 0;
        }
        return Math.min(this.passesOwed, this.moveLength(this.placed));
    }

    /** Kill-All handicap: stones the current player must add when taking the Attacker side now. */
    private handicapOwed(): number {
        if (this.phase === "alt-place" && this.handicapVariant && this.currplayer === 2) {
            return this.handicap ?? 0;
        }
        return 0;
    }

    // -----------------------------------------------------------------------
    // Dead strings
    // -----------------------------------------------------------------------

    /** The stones of the string at `cell`, which must hold a stone. */
    private stringOf(cell: string): string[] {
        return stringAt(this.board, this.geo, cell).stones;
    }

    /**
     * The marking that names the strings at `cells`: every stone of each, in board order. Cells
     * without a stone name nothing; validation reports them.
     */
    private canonicalMarks(cells: Iterable<string>): string[] {
        const marked = new Set<string>();
        for (const cell of cells) {
            if (this.board.has(cell) && !marked.has(cell)) {
                for (const stone of this.stringOf(cell)) {
                    marked.add(stone);
                }
            }
        }
        return this.geo.cells.filter((cell) => marked.has(cell));
    }

    /** The tokens that spell a marking: one per marked string, naming its first stone in board order. */
    private markTokens(marks: string[]): string[] {
        const named = new Set<string>();
        const tokens: string[] = [];
        for (const cell of marks) {
            if (!named.has(cell)) {
                tokens.push(`-${cell}`);
                for (const stone of this.stringOf(cell)) {
                    named.add(stone);
                }
            }
        }
        return tokens;
    }

    private sameMarks(a: string[], b: string[]): boolean {
        return a.length === b.length && a.every((cell, i) => cell === b[i]);
    }

    /** A move's placement tokens and the cells its mark tokens (`-cell`) name. */
    private splitMarks(tokens: string[]): { placements: string[]; marked: string[] } {
        const placements: string[] = [];
        const marked: string[] = [];
        for (const token of tokens) {
            if (token.startsWith("-")) {
                marked.push(token.substring(1));
            } else {
                placements.push(token);
            }
        }
        return { placements, marked };
    }

    /** Whether `placements` are the voluntary passes of a whole-move pass, which may carry a marking. */
    private passesWholeMove(placements: string[]): boolean {
        return !this.killAll && placements.length > 0 && placements.every((token) => token === "pass");
    }

    /**
     * The marking a whole-move pass by the current player answers: the pending one when the
     * opponent's last move was a whole-move pass, so that keeping it ends the game.
     */
    private inheritedMarks(): string[] | undefined {
        const n = this.passes.length;
        return n > 0 && this.passes[n - 1] !== this.currplayer ? this.marks : undefined;
    }

    /** The board with the marked strings removed. */
    private effectiveBoard(): Board {
        if (this.marks.length === 0) {
            return this.board;
        }
        const board = new Map(this.board);
        for (const cell of this.marks) {
            board.delete(cell);
        }
        return board;
    }

    private clearMarks(): void {
        this.marks = [];
        this.dispute = false;
    }

    // -----------------------------------------------------------------------
    // Positions and placements
    // -----------------------------------------------------------------------

    /**
     * How often each position has arisen so far: the initial board and every position a stone
     * placement created, including those partway through a move. Passes, taking the button and
     * the handicap's declaration and passes change nothing and create no position.
     */
    private positionCounts(): Map<string, number> {
        const counts = new Map<string, number>();
        const add = (sig: string): void => {
            counts.set(sig, (counts.get(sig) ?? 0) + 1);
        };
        add(signature(this.stack[0].board, this.geo));
        for (let i = 1; i < this.stack.length; i++) {
            const state = this.stack[i];
            for (const sig of state.interim) {
                add(sig);
            }
            if (state.novel) {
                add(signature(state.board, this.geo));
            }
        }
        return counts;
    }

    private newSim(length: number, placed: number, base?: Map<string, number>): ISim {
        return {
            board: new Map(this.board),
            base: base ?? this.positionCounts(),
            results: [],
            start: signature(this.board, this.geo),
            created: [],
            captured: 0,
            suicided: 0,
            length,
            placed,
            buttonTaken: false,
            placedStone: false,
            cleared: false,
            over: false,
        };
    }

    private copySim(sim: ISim): ISim {
        return { ...sim, board: new Map(sim.board), created: [...sim.created], results: [...sim.results] };
    }

    private occurrences(sim: ISim, sig: string): number {
        let count = sim.base.get(sig) ?? 0;
        for (const created of sim.created) {
            if (created === sig) {
                count++;
            }
        }
        return count;
    }

    /**
     * Record the position the board holds after a placement (or after the clearing a placement
     * owed). Returns the key of the validation message when positional superko forbids it: the
     * suicide message when the placement left the board as it was because its own stones were
     * removed, the plain one otherwise. Under the repetition variant, the fifth occurrence of a
     * position ends the game instead. `step` is what the clearing removed this time.
     */
    private recordPosition(sim: ISim, step: { captured: number; suicided: number }): string | undefined {
        const sig = signature(sim.board, this.geo);
        const seen = this.occurrences(sim, sig);
        if (!this.repetitionDraw && seen > 0) {
            const previous = sim.created.length > 0 ? sim.created[sim.created.length - 1] : sim.start;
            const unchanged = step.captured === 0 && step.suicided > 0 && (sig === previous || sig === sim.start);
            return unchanged ? "SUICIDE_REPEAT" : "KO_PSK";
        }
        sim.created.push(sig);
        if (this.repetitionDraw && seen + 1 >= REPETITIONS_FOR_DRAW) {
            sim.over = true;
        }
        return undefined;
    }

    /** Tromp-Taylor clearing after `colour` placed: opponent strings without liberties, then its own. */
    private clear(sim: ISim, colour: Stone): { captured: number; suicided: number } {
        const step = { captured: 0, suicided: 0 };
        for (const group of clearColour(sim.board, this.geo, otherColour(colour))) {
            sim.results.push({ type: "capture", where: group.join(","), count: group.length });
            step.captured += group.length;
        }
        for (const group of clearColour(sim.board, this.geo, colour)) {
            sim.results.push({ type: "capture", where: group.join(","), count: group.length, how: "suicide" });
            step.suicided += group.length;
        }
        sim.captured += step.captured;
        sim.suicided += step.suicided;
        return step;
    }

    /**
     * Checked weak eyes: the clearing deferred to the move's last placement, done once. When it
     * removes anything, the board it leaves is a position to record.
     */
    private clearAtEnd(sim: ISim, colour: Stone): string | undefined {
        if (!this.checkedEyes || sim.cleared || !sim.placedStone) {
            return undefined;
        }
        sim.cleared = true;
        const step = this.clear(sim, colour);
        if (step.captured + step.suicided === 0) {
            return undefined;
        }
        return this.recordPosition(sim, step);
    }

    /** Serve handicap passes at the start of a move. */
    private serveForced(sim: ISim, count: number): void {
        for (let i = 0; i < count; i++) {
            sim.results.push({ type: "pass", why: "handicap" });
            sim.placed++;
        }
    }

    /**
     * Apply one placement token (a cell, `pass`, or `button`) for `colour` to `sim`. Returns the
     * key of the validation message when the token is illegal. Every stone placement creates a
     * position, judged at once; with checked weak eyes the position after a placement that is not
     * the move's last is the board before any clearing.
     */
    private applyToken(sim: ISim, token: string, colour: Stone): string | undefined {
        if (sim.over) {
            return "OVER_MID_MOVE";
        }
        if (sim.placed >= sim.length) {
            return "TOO_MANY";
        }
        const final = sim.placed === sim.length - 1;
        if (token === "pass" || token === "button") {
            if (token === "pass") {
                if (this.killAll) {
                    return "NO_PASS";
                }
                sim.results.push({ type: "pass" });
            } else {
                if (this.buttonValue === 0) {
                    return "NO_BUTTON";
                }
                if (this.button !== undefined || sim.buttonTaken) {
                    return "BUTTON_TAKEN";
                }
                sim.buttonTaken = true;
                sim.results.push({ type: "button" });
            }
            sim.placed++;
            return final ? this.clearAtEnd(sim, colour) : undefined;
        }
        if (!this.isValidCell(token)) {
            return "INVALIDCELL";
        }
        if (sim.board.has(token)) {
            return "OCCUPIED";
        }
        sim.board.set(token, colour);
        sim.results.push({ type: "place", where: token });
        sim.placedStone = true;
        sim.placed++;
        if (!this.checkedEyes) {
            return this.recordPosition(sim, this.clear(sim, colour));
        }
        if (!final) {
            return this.recordPosition(sim, { captured: 0, suicided: 0 });
        }
        sim.cleared = true;
        return this.recordPosition(sim, this.clear(sim, colour));
    }

    /** Pass the placements a move string left unspecified (standard game only). */
    private finishMove(sim: ISim, colour: Stone): string | undefined {
        while (!sim.over && sim.placed < sim.length) {
            if (this.killAll) {
                return "INCOMPLETE";
            }
            const err = this.applyToken(sim, "pass", colour);
            if (err !== undefined) {
                return err;
            }
        }
        return undefined;
    }

    private tokenMessage(key: string, token: string): string {
        switch (key) {
            case "INVALIDCELL":
                return i18next.t("apgames:validation._general.INVALIDCELL", { cell: token });
            case "OCCUPIED":
                if (this.killAll || this.locked) {
                    return i18next.t("apgames:validation._general.OCCUPIED", { where: token });
                }
                return i18next.t("apgames:validation.thuemorsego.OCCUPIED_MARK", { where: token });
            case "INCOMPLETE":
                return i18next.t("apgames:validation._general.INCOMPLETE_MOVE");
            default:
                return i18next.t(`apgames:validation.thuemorsego.${key}`);
        }
    }

    /** The tokens that may come next in a move on `sim`. */
    private candidates(sim: ISim): string[] {
        const list: string[] = [];
        if (!this.killAll) {
            list.push("pass");
            if (this.buttonValue > 0 && this.button === undefined && !sim.buttonTaken) {
                list.push("button");
            }
        }
        for (const cell of this.geo.cells) {
            if (!sim.board.has(cell)) {
                list.push(cell);
            }
        }
        return list;
    }

    /** Whether some legal sequence of placements completes the move on `sim`. */
    private hasContinuation(sim: ISim, colour: Stone): boolean {
        if (sim.over || sim.placed >= sim.length) {
            return true;
        }
        for (const token of this.candidates(sim)) {
            const trial = this.copySim(sim);
            if (this.applyToken(trial, token, colour) !== undefined) {
                continue;
            }
            if (this.hasContinuation(trial, colour)) {
                return true;
            }
        }
        return false;
    }

    /** Every legal sequence of placements that completes the move on `sim`. */
    private completions(sim: ISim, colour: Stone): string[][] {
        if (sim.over || sim.placed >= sim.length) {
            return [[]];
        }
        const out: string[][] = [];
        for (const token of this.candidates(sim)) {
            const trial = this.copySim(sim);
            if (this.applyToken(trial, token, colour) !== undefined) {
                continue;
            }
            for (const rest of this.completions(trial, colour)) {
                out.push([token, ...rest]);
            }
        }
        return out;
    }

    /** A random legal sequence of placements that completes the move on `sim`. */
    private randomCompletion(sim: ISim, colour: Stone): string[] | undefined {
        if (sim.over || sim.placed >= sim.length) {
            return [];
        }
        for (const token of shuffle(this.candidates(sim)) as string[]) {
            const trial = this.copySim(sim);
            if (this.applyToken(trial, token, colour) !== undefined) {
                continue;
            }
            const rest = this.randomCompletion(trial, colour);
            if (rest !== undefined) {
                return [token, ...rest];
            }
        }
        return undefined;
    }

    private hasLegalMove(seat: playerid): boolean {
        const colour = this.colourOfSeat(seat)!;
        const length = this.moveLength(this.placed);
        const forced = seat === this.currplayer ? this.forcedPasses() : 0;
        const sim = this.newSim(length, 0);
        this.serveForced(sim, forced);
        return this.hasContinuation(sim, colour);
    }

    // -----------------------------------------------------------------------
    // Move lists
    // -----------------------------------------------------------------------

    /**
     * Legal moves. Two-placement moves are enumerated exhaustively, which is slow on large boards;
     * the game is flagged `no-moves` so that only tests and tooling call this.
     */
    public moves(): string[] {
        if (this.gameover) { return []; }
        const moves: string[] = [];
        switch (this.phase) {
            case "hand-n":
                for (let n = 1; n <= this.maxSetupStones(); n++) {
                    moves.push(n.toString());
                }
                break;
            case "alt-place":
                if (this.board.size < this.maxSetupStones()) {
                    for (const cell of this.geo.cells) {
                        if (!this.board.has(cell)) {
                            moves.push(cell);
                        }
                    }
                }
                if (this.handicapOwed() === 0) {
                    moves.push("attacker");
                }
                break;
            case "komi":
                for (let n = -this.maxKomi; n <= this.maxKomi; n++) {
                    moves.push(n.toString());
                }
                break;
            case "play":
                moves.push(...this.playMoves());
                break;
        }
        return moves;
    }

    private playMoves(): string[] {
        const colour = this.colourOfSeat(this.currplayer)!;
        const length = this.moveLength(this.placed);
        const base = this.positionCounts();
        const moves: string[] = [];
        if (this.declaring() && this.handicap === undefined) {
            for (let n = 1; n <= this.points; n++) {
                const forced = Math.min(n, length);
                if (forced === length) {
                    moves.push(n.toString());
                    continue;
                }
                const sim = this.newSim(length, forced, base);
                for (const rest of this.completions(sim, colour)) {
                    moves.push([n.toString(), ...rest].join(","));
                }
            }
            return moves;
        }
        const forced = this.forcedPasses();
        if (forced === length) {
            return [Array<string>(length).fill("pass").join(",")];
        }
        const sim = this.newSim(length, forced, base);
        return this.completions(sim, colour).map((tokens) => this.withMarks(tokens).join(","));
    }

    /** A whole-move pass keeps the pending marking, which is the pass that can end the game. */
    private withMarks(tokens: string[]): string[] {
        return this.passesWholeMove(tokens) ? [...tokens, ...this.markTokens(this.marks)] : tokens;
    }

    public randomMove(): string {
        if (this.phase === "komi") {
            // A modest komi either way, rather than one from the whole range.
            return (Math.floor(Math.random() * 19) - 9).toString();
        }
        if (this.phase !== "play") {
            const moves = this.moves();
            return moves[Math.floor(Math.random() * moves.length)];
        }
        const colour = this.colourOfSeat(this.currplayer)!;
        const length = this.moveLength(this.placed);
        let forced: number;
        let prefix: string[] = [];
        if (this.declaring() && this.handicap === undefined) {
            const n = 1 + Math.floor(Math.random() * Math.min(9, this.points));
            forced = Math.min(n, length);
            prefix = [n.toString()];
        } else {
            forced = this.forcedPasses();
        }
        const sim = this.newSim(length, forced);
        const rest = this.randomCompletion(sim, colour) ?? [];
        const tokens = prefix.length > 0 ? [...prefix, ...rest] : this.withMarks(rest);
        return tokens.length > 0 ? tokens.join(",") : Array<string>(length).fill("pass").join(",");
    }

    // -----------------------------------------------------------------------
    // Pickers and buttons
    // -----------------------------------------------------------------------

    /**
     * The numbered stones offered while a handicap is set: the values 1 to 18 in two centred rows
     * of nine, the odd values just above the centre point and the even values just below it, so
     * each column holds a consecutive pair. Cells already holding a stone offer nothing; larger
     * handicaps, and any value whose stone is covered, are entered manually.
     */
    private pickerLayout(max: number): IPickerButton[] {
        const centre = Math.floor(this.boardSize / 2);
        const left = centre - 4;
        const buttons: IPickerButton[] = [];
        for (let value = 1; value <= Math.min(PICKER_MAX, max); value++) {
            const row = value % 2 === 1 ? centre - 1 : centre + 1;
            const cell = this.coords2algebraic(left + Math.floor((value - 1) / 2), row);
            if (!this.board.has(cell)) {
                buttons.push({ cell, value });
            }
        }
        return buttons;
    }

    /** The picker the current state shows, if any, and the value chosen so far. */
    private picker(): { buttons: IPickerButton[]; chosen?: number } | undefined {
        if (this.gameover) {
            return undefined;
        }
        if (this.phase === "hand-n") {
            return { buttons: this.pickerLayout(this.maxSetupStones()), chosen: this.handicap };
        }
        // A handicap of one pass leaves a placement to make, so the board is shown instead.
        if (this.phase === "play" && this.declaring() && this.handicap !== 1) {
            return { buttons: this.pickerLayout(this.points), chosen: this.handicap };
        }
        return undefined;
    }

    /**
     * The move that passes every placement of the current move the player controls, keeping the
     * pending marking so that clicks on strings change it rather than start it over.
     */
    private wholeMovePass(): string {
        const free = Math.max(1, this.moveLength(this.placed) - this.forcedPasses());
        return [...Array<string>(free).fill("pass"), ...this.markTokens(this.marks)].join(",");
    }

    /** The move a `_btn_` click stands for: `pass` passes the whole move, other values are moves. */
    private buttonMove(value: string): string {
        return value === "pass" && this.phase === "play" ? this.wholeMovePass() : value;
    }

    public getButtons(): ICustomButton[] {
        if (this.gameover) {
            return [];
        }
        if (this.phase === "alt-place") {
            return [{ label: "apgames:buttons.thuemorsego.attacker", move: "attacker" }];
        }
        if (this.phase !== "play" || this.killAll) {
            return [];
        }
        if (this.declaring() && this.handicap === undefined) {
            return [];
        }
        if (this.forcedPasses() === this.moveLength(this.placed)) {
            return [];
        }
        // The Pass button passes the whole move; a single click on the board can still fill a placement.
        const buttons: ICustomButton[] = [{ label: "apgames:buttons.pass", move: this.wholeMovePass() }];
        if (this.buttonValue > 0 && this.button === undefined) {
            buttons.push({ label: "apgames:buttons.takebutton", move: "button" });
        }
        return buttons;
    }

    // -----------------------------------------------------------------------
    // Clicks
    // -----------------------------------------------------------------------

    public handleClick(move: string, row: number, col: number, piece?: string): IClickResult {
        try {
            // Renderer builds before August 2026 pass clicks on the tracker's glyphs to the game
            // with the tracker's own rows and columns. They change nothing.
            if (piece !== undefined && TRACK_KEY_RE.test(piece)) {
                return { ...this.validateMove(move), move };
            }
            if (row < 0 || col < 0) {
                // Button clicks replace whatever move is in progress.
                if (piece === undefined || !piece.startsWith("_btn_")) {
                    return { move, valid: false, message: i18next.t("apgames:validation._general.UNKNOWN_CLICK") };
                }
                const newmove = this.buttonMove(piece.substring("_btn_".length));
                const result = this.validateMove(newmove) as IClickResult;
                result.move = result.valid ? newmove : move;
                return result;
            }
            if (this.phase === "komi") {
                return { move, valid: false, message: i18next.t("apgames:validation.thuemorsego.KOMI_CLICK") };
            }
            const cell = this.coords2algebraic(col, row);
            const newmove = this.clickCell(move.toLowerCase().replace(/\s+/g, ""), cell);
            if (newmove === undefined) {
                return {
                    move,
                    valid: false,
                    message: i18next.t("apgames:validation.thuemorsego.NOT_A_NUMBERED_STONE", { where: cell }),
                };
            }
            const result = this.validateMove(newmove) as IClickResult;
            result.move = result.valid ? newmove : move;
            return result;
        } catch (e) {
            return {
                move,
                valid: false,
                message: i18next.t("apgames:validation._general.GENERIC", { move, row, col, piece, emessage: (e as Error).message }),
            };
        }
    }

    private parseTokens(move: string): string[] {
        return move.length === 0 ? [] : move.split(",");
    }

    /** Extend `move` with a click on `cell`, or undefined when the click means nothing now. */
    private clickCell(move: string, cell: string): string | undefined {
        const pickerValue = (): string | undefined => this.picker()?.buttons.find((btn) => btn.cell === cell)?.value.toString();
        const toggle = (list: string): string => {
            const cells = this.parseTokens(list);
            const next = cells.includes(cell) ? cells.filter((c) => c !== cell) : [...cells, cell];
            return next.join(",");
        };
        switch (this.phase) {
            case "hand-n":
                return pickerValue();
            case "komi":
                return undefined;
            case "alt-place":
                if (move.startsWith("attacker")) {
                    return `attacker:${toggle(move.substring("attacker:".length))}`;
                }
                return cell;
            case "play": {
                const tokens = this.parseTokens(move);
                const length = this.moveLength(this.placed);
                if (this.declaring() && this.handicap === undefined) {
                    if (tokens.length === 0) {
                        return pickerValue();
                    }
                    if (tokens[0] === "1" && length > 1) {
                        // The second placement of the move follows a handicap of one pass.
                        return tokens.length > 1 && tokens[1] === cell ? "1" : `1,${cell}`;
                    }
                    return pickerValue();
                }
                const free = length - this.forcedPasses();
                const { placements, marked } = this.splitMarks(tokens);
                if (this.board.has(cell) && this.passesWholeMove(placements)) {
                    // A stone clicked while the move passes every placement: its string is marked
                    // dead, or unmarked again.
                    const marks = new Set(this.canonicalMarks(marked));
                    const stones = this.stringOf(cell);
                    if (stones.every((stone) => marks.has(stone))) {
                        for (const stone of stones) { marks.delete(stone); }
                    } else {
                        for (const stone of stones) { marks.add(stone); }
                    }
                    const passes = Array<string>(free).fill("pass");
                    return [...passes, ...this.markTokens(this.geo.cells.filter((c) => marks.has(c)))].join(",");
                }
                // A placement, which drops any marking; a click on a stone is left to fail as occupied.
                if (placements.length > 0 && placements[placements.length - 1] === cell) {
                    return placements.slice(0, -1).join(",");
                }
                if (placements.length < free) {
                    return [...placements, cell].join(",");
                }
                return [...placements.slice(0, -1), cell].join(",");
            }
        }
    }

    // -----------------------------------------------------------------------
    // Validation
    // -----------------------------------------------------------------------

    public validateMove(m: string): IValidationResult {
        const result: IValidationResult = { valid: false, message: i18next.t("apgames:validation._general.DEFAULT_HANDLER") };
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (this.gameover) {
            return this.fail(result, i18next.t("apgames:MOVES_GAMEOVER"));
        }
        switch (this.phase) {
            case "hand-n":
                return this.validateHandicapStones(m, result);
            case "alt-place":
                return this.validateAltPlace(m, result);
            case "komi":
                return this.validateKomi(m, result);
            case "play":
                return this.validatePlay(m, result);
        }
    }

    private validateKomi(m: string, result: IValidationResult): IValidationResult {
        const max = this.maxKomi;
        if (m.length === 0) {
            return this.ok(result, -1, i18next.t("apgames:validation.thuemorsego.INSTRUCTIONS_KOMI", { max }));
        }
        if (!/^-?\d+$/.test(m)) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.KOMI_INVALID"));
        }
        const n = parseInt(m, 10) || 0;
        if (n < -max || n > max) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.KOMI_RANGE", { max }));
        }
        return this.ok(result, 1, i18next.t("apgames:validation.thuemorsego.KOMI_OK", { count: n }), true);
    }

    private ok(result: IValidationResult, complete: -1 | 0 | 1, message: string, canrender = false): IValidationResult {
        result.valid = true;
        result.complete = complete;
        result.canrender = canrender;
        result.message = message;
        return result;
    }

    private fail(result: IValidationResult, message: string): IValidationResult {
        result.valid = false;
        result.message = message;
        return result;
    }

    private validateHandicapStones(m: string, result: IValidationResult): IValidationResult {
        const max = this.maxSetupStones();
        if (m.length === 0) {
            return this.ok(result, -1, i18next.t("apgames:validation.thuemorsego.INSTRUCTIONS_HANDICAP", { max }));
        }
        if (!/^\d+$/.test(m)) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.HANDICAP_INVALID"));
        }
        const n = parseInt(m, 10);
        if (n < 1 || n > max) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.HANDICAP_RANGE", { max }));
        }
        return this.ok(result, 0, i18next.t("apgames:validation.thuemorsego.HANDICAP_OK", { count: n }), true);
    }

    /** Setup placements: known cells, empty, no duplicates (see `maxSetupStones` for why no superko check is needed). */
    private checkSetupCells(cells: string[], result: IValidationResult): IValidationResult | undefined {
        const named = new Set<string>();
        for (const cell of cells) {
            if (!this.isValidCell(cell)) {
                return this.fail(result, i18next.t("apgames:validation._general.INVALIDCELL", { cell }));
            }
            if (this.board.has(cell)) {
                return this.fail(result, i18next.t("apgames:validation._general.OCCUPIED", { where: cell }));
            }
            if (named.has(cell)) {
                return this.fail(result, i18next.t("apgames:validation.thuemorsego.DUPLICATE_CELL", { where: cell }));
            }
            named.add(cell);
        }
        return undefined;
    }

    private validateAltPlace(m: string, result: IValidationResult): IValidationResult {
        const owed = this.handicapOwed();
        if (m.length === 0) {
            if (owed > 0) {
                return this.ok(result, -1, i18next.t("apgames:validation.thuemorsego.INSTRUCTIONS_ALT_HANDICAP", { count: owed }));
            }
            return this.ok(result, -1, i18next.t("apgames:validation.thuemorsego.INSTRUCTIONS_ALT"));
        }
        if (m === "attacker" || m.startsWith("attacker:")) {
            const cells = this.parseTokens(m.substring("attacker:".length));
            if (owed === 0) {
                if (cells.length > 0) {
                    return this.fail(result, i18next.t("apgames:validation.thuemorsego.ATTACKER_NO_STONES"));
                }
                return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"));
            }
            const err = this.checkSetupCells(cells, result);
            if (err !== undefined) { return err; }
            if (cells.length > owed) {
                return this.fail(result, i18next.t("apgames:validation.thuemorsego.BATCH_TOO_MANY", { count: owed }));
            }
            if (cells.length < owed) {
                return this.ok(result, -1, i18next.t("apgames:validation.thuemorsego.STONES_LEFT", { count: owed - cells.length }), cells.length > 0);
            }
            return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"), true);
        }
        if (m === "pass") {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.INVALID_PASS"));
        }
        if (this.board.size >= this.maxSetupStones()) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.SETUP_FULL", { max: this.maxSetupStones() }));
        }
        const err = this.checkSetupCells([m], result);
        if (err !== undefined) { return err; }
        return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"), true);
    }

    private instructions(length: number, free: number): string {
        if (this.killAll) {
            const key = this.currplayer === this.defenderSeat ? "INSTRUCTIONS_PLAY_DEFENDER" : "INSTRUCTIONS_PLAY_ATTACKER";
            return i18next.t(`apgames:validation.thuemorsego.${key}`, { count: length });
        }
        const button = this.buttonValue > 0 && this.button === undefined;
        if (free < length) {
            return i18next.t(`apgames:validation.thuemorsego.${button ? "INSTRUCTIONS_PLAY_FORCED_BUTTON" : "INSTRUCTIONS_PLAY_FORCED"}`, { points: this.buttonValue });
        }
        return i18next.t(`apgames:validation.thuemorsego.${button ? "INSTRUCTIONS_PLAY_BUTTON" : "INSTRUCTIONS_PLAY"}`, { count: free, points: this.buttonValue });
    }

    private validatePlay(m: string, result: IValidationResult): IValidationResult {
        const colour = this.colourOfSeat(this.currplayer)!;
        const length = this.moveLength(this.placed);
        if (this.declaring() && this.handicap === undefined) {
            return this.validateDeclaration(m, result, colour, length);
        }
        const forced = this.forcedPasses();
        const free = length - forced;
        if (m.length === 0) {
            return this.ok(result, -1, this.instructions(length, free));
        }
        const { placements: tokens, marked } = this.splitMarks(m.split(","));
        if (free === 0) {
            // The whole move is served automatically; accept the passes that spell it out.
            if (marked.length === 0 && tokens.length <= length && tokens.every((token) => token === "pass")) {
                return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"));
            }
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.FORCED_MOVE"));
        }
        if (tokens.length > free) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.TOO_MANY", { count: free }));
        }
        const sim = this.newSim(length, 0);
        this.serveForced(sim, forced);
        const err = this.applyTokens(sim, tokens, colour, result);
        if (err !== undefined) { return err; }
        if (marked.length > 0) {
            const bad = this.checkMarks(tokens, marked);
            if (bad !== undefined) { return this.fail(result, bad); }
        }
        // A whole-move pass stays open for marking strings dead. A pass that leaves placements to
        // fill does too once a marking is pending, since submitting it answers that marking.
        if (this.passesWholeMove(tokens) && (marked.length > 0 || tokens.length === free || this.marks.length > 0)) {
            return this.passVerdict(marked, result);
        }
        return this.completeness(sim, colour, result);
    }

    /** The validation message when the mark tokens of a move are not allowed, if they are not. */
    private checkMarks(placements: string[], marked: string[]): string | undefined {
        if (!this.passesWholeMove(placements)) {
            return i18next.t("apgames:validation.thuemorsego.MARKS_NEED_PASS");
        }
        for (const cell of marked) {
            if (!this.isValidCell(cell)) {
                return i18next.t("apgames:validation._general.INVALIDCELL", { cell });
            }
            if (!this.board.has(cell)) {
                return i18next.t("apgames:validation.thuemorsego.MARK_EMPTY", { where: cell });
            }
        }
        return undefined;
    }

    /**
     * The verdict on a whole-move pass: what submitting it does to the marking and to the game.
     * The pass is left open (`complete` 0) while strings can still be clicked.
     */
    private passVerdict(marked: string[], result: IValidationResult): IValidationResult {
        const marks = this.canonicalMarks(marked);
        const count = marks.length;
        const unchanged = this.sameMarks(marks, this.marks);
        const inherited = this.inheritedMarks();
        if (this.locked) {
            if (!unchanged) {
                return this.fail(result, i18next.t("apgames:validation.thuemorsego.MARKS_LOCKED"));
            }
            const key = inherited === undefined ? "PASS_LOCKED" : "PASS_LOCKED_ENDS";
            return this.ok(result, 1, i18next.t(`apgames:validation.thuemorsego.${key}`, { count }), true);
        }
        let key: string;
        if (inherited === undefined) {
            key = "PASS_OPEN";
        } else if (unchanged) {
            key = "PASS_AGREE";
        } else {
            key = this.dispute ? "PASS_DISPUTE_LAST" : "PASS_DISPUTE";
        }
        return this.ok(result, 0, i18next.t(`apgames:validation.thuemorsego.${key}`, { count }), true);
    }

    private validateDeclaration(m: string, result: IValidationResult, colour: Stone, length: number): IValidationResult {
        const max = this.points;
        if (m.length === 0) {
            return this.ok(result, -1, i18next.t("apgames:validation.thuemorsego.INSTRUCTIONS_DECLARE", { max }));
        }
        const tokens = m.split(",");
        if (!/^\d+$/.test(tokens[0])) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.DECLARE_INVALID"));
        }
        const n = parseInt(tokens[0], 10);
        if (n < 1 || n > max) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.DECLARE_RANGE", { max }));
        }
        // The declaration itself is the first pass served.
        const forced = Math.min(n, length);
        const free = length - forced;
        const rest = tokens.slice(1);
        if (free === 0) {
            if (rest.length > 0) {
                return this.fail(result, i18next.t("apgames:validation.thuemorsego.DECLARE_NO_PLACEMENT", { count: n }));
            }
            return this.ok(result, 0, i18next.t("apgames:validation.thuemorsego.DECLARE_OK", { count: n }), true);
        }
        if (rest.length > free) {
            return this.fail(result, i18next.t("apgames:validation.thuemorsego.TOO_MANY", { count: free }));
        }
        const sim = this.newSim(length, forced);
        const err = this.applyTokens(sim, rest, colour, result);
        if (err !== undefined) { return err; }
        if (rest.length === 0) {
            return this.ok(result, 0, i18next.t("apgames:validation.thuemorsego.DECLARE_ONE"), true);
        }
        return this.completeness(sim, colour, result);
    }

    private applyTokens(sim: ISim, tokens: string[], colour: Stone, result: IValidationResult): IValidationResult | undefined {
        for (const token of tokens) {
            const err = this.applyToken(sim, token, colour);
            if (err !== undefined) {
                return this.fail(result, this.tokenMessage(err, token));
            }
        }
        return undefined;
    }

    /** The verdict on a move whose explicit placements were all legal. */
    private completeness(sim: ISim, colour: Stone, result: IValidationResult): IValidationResult {
        if (sim.over || sim.placed === sim.length) {
            return this.ok(result, 1, i18next.t("apgames:validation._general.VALID_MOVE"), true);
        }
        const left = sim.length - sim.placed;
        if (this.killAll) {
            if (!this.hasContinuation(sim, colour)) {
                return this.fail(result, i18next.t("apgames:validation.thuemorsego.DEAD_END"));
            }
            return this.ok(result, -1, i18next.t("apgames:validation.thuemorsego.PLACE_MORE", { count: left }), true);
        }
        // Submitting now passes the rest of the move; with checked weak eyes the clearing that
        // ends the move can then leave a forbidden position.
        const err = this.finishMove(this.copySim(sim), colour);
        if (err !== undefined) {
            const key = err === "SUICIDE_REPEAT" ? "MUST_CONTINUE_SUICIDE" : "MUST_CONTINUE";
            return this.ok(result, -1, i18next.t(`apgames:validation.thuemorsego.${key}`), true);
        }
        const button = this.buttonValue > 0 && this.button === undefined && !sim.buttonTaken;
        return this.ok(result, 0, i18next.t(`apgames:validation.thuemorsego.${button ? "MORE_OR_SUBMIT_BUTTON" : "MORE_OR_SUBMIT"}`, { count: left }), true);
    }

    // -----------------------------------------------------------------------
    // Moves
    // -----------------------------------------------------------------------

    public move(m: string, { partial = false, trusted = false } = {}): ThueMorseGoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (!trusted) {
            const result = this.validateMove(m);
            if (!result.valid) {
                throw new UserFacingError("VALIDATION_GENERAL", result.message);
            }
            if (!partial && result.complete === -1) {
                throw new UserFacingError("VALIDATION_GENERAL", i18next.t("apgames:validation._general.INCOMPLETE_MOVE"));
            }
        }
        if (m.length === 0) { return this; }

        this.results = [];
        this.interim = [];
        this.novel = false;
        this.alive = undefined;

        let committed: boolean;
        switch (this.phase) {
            case "hand-n":
                committed = this.moveHandicapStones(m, partial);
                break;
            case "alt-place":
                committed = this.moveAltPlace(m, partial);
                break;
            case "komi":
                committed = this.moveKomi(m, partial);
                break;
            case "play":
                committed = this.movePlay(m, partial);
                break;
        }
        if (!committed) {
            return this;
        }
        // Every move that leaves the board in play, the claim included, may have settled a
        // Kill-All game or left the next player without a legal move.
        if (this.killAll && this.phase === "play") {
            this.checkLifeAndDeath();
            this.checkStalemate();
        }
        this.saveState();
        this.serveForcedMoves();
        return this;
    }

    private moveHandicapStones(m: string, partial: boolean): boolean {
        const n = parseInt(m, 10);
        this.handicap = n;
        this.results.push({ type: "declare", count: n });
        if (partial) { return false; }
        this.phase = "alt-place";
        this.currplayer = 2;
        this.lastmove = m;
        return true;
    }

    /** Reverse komi: Player 2 sets the points added to their score, and Player 1 makes placement 0. */
    private moveKomi(m: string, partial: boolean): boolean {
        const n = parseInt(m, 10) || 0;
        this.komi = n;
        this.results.push({ type: "komi", value: n });
        if (partial) { return false; }
        this.phase = "play";
        this.currplayer = 1;
        this.lastmove = n.toString();
        return true;
    }

    /** Opening stones for the Attacker (no captures are possible before the Defender has moved). */
    private placeSetupStones(cells: string[]): void {
        const created: string[] = [];
        for (const cell of cells) {
            this.board.set(cell, 2);
            this.results.push({ type: "place", where: cell, what: "setup" });
            created.push(signature(this.board, this.geo));
        }
        this.interim = created.slice(0, -1);
        this.novel = created.length > 0;
    }

    private moveAltPlace(m: string, partial: boolean): boolean {
        if (m === "attacker" || m.startsWith("attacker:")) {
            this.results.push({ type: "claim", how: "attacker" });
            this.placeSetupStones(this.parseTokens(m.substring("attacker:".length)));
            if (partial) { return false; }
            this.defenderSeat = this.otherSeat(this.currplayer);
            this.phase = "play";
            this.placed = 0;
            this.currplayer = this.defenderSeat;
        } else {
            this.placeSetupStones([m]);
            if (partial) { return false; }
            this.currplayer = this.otherSeat(this.currplayer);
        }
        this.lastmove = m;
        return true;
    }

    private movePlay(m: string, partial: boolean): boolean {
        const seat = this.currplayer;
        const colour = this.colourOfSeat(seat)!;
        const length = this.moveLength(this.placed);
        const split = this.splitMarks(m.split(","));
        const marked = split.marked;
        let tokens = split.placements;
        let declared: number | undefined;
        let forced: number;
        if (this.declaring() && this.handicap === undefined) {
            declared = parseInt(tokens[0], 10);
            tokens = tokens.slice(1);
            forced = Math.min(declared, length);
        } else {
            forced = this.forcedPasses();
            if (forced === length) {
                // The passes that spell out a move served entirely by the handicap.
                tokens = [];
            }
        }
        const sim = this.newSim(length, 0);
        if (declared !== undefined) {
            sim.results.push({ type: "declare", count: declared });
            sim.placed++;
            this.serveForced(sim, forced - 1);
        } else {
            this.serveForced(sim, forced);
        }
        for (const token of tokens) {
            const err = this.applyToken(sim, token, colour);
            if (err !== undefined) {
                throw new UserFacingError("VALIDATION_GENERAL", this.tokenMessage(err, token));
            }
        }
        if (partial) {
            this.commitSim(sim, seat, declared, forced);
            // Show the marking the move would leave: its own when it passes, none once it places.
            if (declared === undefined && this.passesWholeMove(tokens)) {
                this.marks = this.canonicalMarks(marked);
            } else if (tokens.some((token) => token !== "pass")) {
                this.marks = [];
            }
            return false;
        }
        const err = this.finishMove(sim, colour);
        if (err !== undefined) {
            throw new UserFacingError("VALIDATION_GENERAL", this.tokenMessage(err, "pass"));
        }
        const spelled = [...tokens, ...Array<string>(sim.placed - forced - tokens.length).fill("pass")];
        this.commitSim(sim, seat, declared, forced);
        this.interim = sim.created.slice(0, -1);
        this.novel = sim.created.length > 0;
        let agreed = false;
        if (declared !== undefined) {
            this.lastmove = [declared.toString(), ...spelled].join(",");
            this.passes = [];
            this.clearMarks();
        } else if (forced === length) {
            // Automatic passes neither count towards ending the game nor interrupt a run of
            // passes, and leave the pending marking as it is.
            this.lastmove = Array<string>(length).fill("pass").join(",");
        } else if (this.passesWholeMove(spelled)) {
            agreed = this.recordPass(seat, spelled, marked);
        } else {
            this.lastmove = spelled.join(",");
            this.passes = [];
            this.clearMarks();
        }
        this.currplayer = this.otherSeat(seat);

        if (sim.over) {
            this.endGame([1, 2], "repetition");
        } else if (agreed) {
            this.endByAgreement();
        }
        return true;
    }

    /**
     * Record a whole-move pass and the marking it carries. When the opponent's last move was a
     * whole-move pass, this pass answers its marking: keeping it ends the game, which is what
     * the result reports, and changing it is allowed until both players have done so in turn.
     */
    private recordPass(seat: playerid, spelled: string[], marked: string[]): boolean {
        const marks = this.canonicalMarks(marked);
        const inherited = this.inheritedMarks();
        const changed = inherited !== undefined && !this.sameMarks(marks, inherited);
        if (changed || (inherited === undefined && marks.length > 0)) {
            const how = !changed ? "marked" : marks.length > 0 ? "changed" : "cleared";
            this.results.push({ type: "select", what: "dead", how, ...(marks.length > 0 ? { where: marks.join(",") } : {}) });
        }
        if (changed && this.dispute) {
            this.locked = true;
        }
        this.dispute = changed;
        this.marks = marks;
        this.passes = [...this.passes, seat];
        this.lastmove = [...spelled, ...this.markTokens(marks)].join(",");
        return inherited !== undefined && !changed;
    }

    /** Copy the outcome of a move in progress into the game. */
    private commitSim(sim: ISim, seat: playerid, declared: number | undefined, forced: number): void {
        this.board = sim.board;
        this.results = sim.results;
        this.placed += sim.placed;
        if (sim.buttonTaken) {
            this.button = seat;
        }
        if (declared !== undefined) {
            this.handicap = declared;
            this.passesOwed = declared - forced;
        } else {
            this.passesOwed -= forced;
        }
    }

    /** Standard handicap: serve every following move of Player 2 that the handicap passes cover. */
    private serveForcedMoves(): void {
        while (!this.gameover && this.phase === "play" && !this.killAll && this.currplayer === 2 && this.passesOwed > 0) {
            const length = this.moveLength(this.placed);
            if (this.passesOwed < length) {
                return;
            }
            this.results = [];
            for (let i = 0; i < length; i++) {
                this.results.push({ type: "pass", why: "handicap" });
            }
            this.interim = [];
            this.novel = false;
            this.alive = undefined;
            this.passesOwed -= length;
            this.placed += length;
            this.lastmove = Array<string>(length).fill("pass").join(",");
            this.currplayer = 1;
            this.saveState();
        }
    }

    // -----------------------------------------------------------------------
    // Ends of games
    // -----------------------------------------------------------------------

    private endGame(winners: playerid[], reason: string, alive?: string[]): void {
        this.gameover = true;
        this.winner = [...winners];
        this.alive = alive;
        this.results.push(
            { type: "eog", reason },
            { type: "winners", players: [...winners] },
        );
    }

    /**
     * The standard game ends when a player passes their whole move keeping the marking the
     * opponent's whole-move pass left: the marked strings are removed and the board is scored.
     */
    private endByAgreement(): void {
        if (this.marks.length > 0) {
            for (const cell of this.marks) {
                this.board.delete(cell);
            }
            this.results.push({ type: "remove", where: this.marks.join(","), num: this.marks.length, how: "dead" });
            this.marks = [];
        }
        const scores = [this.getPlayerScore(1), this.getPlayerScore(2)];
        let winners: playerid[] = [1, 2];
        if (scores[0] !== scores[1]) {
            winners = scores[0] > scores[1] ? [1] : [2];
        }
        this.endGame(winners, "consecutive-passes");
    }

    /**
     * Kill-All: the Defender wins once a Red string is pass-alive, and the Attacker wins once that
     * can never happen, because the Attacker's own pass-alive stones leave no room for the eyes
     * such a string needs. The two cannot coincide, as a pass-alive Red string has that room.
     */
    private checkLifeAndDeath(): void {
        if (this.gameover) {
            return;
        }
        const minVital = this.minVital;
        const alive = passAliveStrings(this.board, this.geo, 1, { suicideAllowed: true, minVital });
        if (alive.length > 0) {
            this.endGame([this.defenderSeat!], "pass-alive", alive.flat());
            return;
        }
        const permanent = passAliveStrings(this.board, this.geo, 2, { suicideAllowed: true, minVital }).flat();
        if (!this.roomForEyes(new Set(permanent), minVital)) {
            this.endGame([this.attackerSeat!], "no-room", permanent);
        }
    }

    /** Kill-All: passing is not allowed, so a player with no legal move loses. */
    private checkStalemate(): void {
        if (this.gameover) {
            return;
        }
        if (!this.hasLegalMove(this.currplayer)) {
            this.endGame([this.otherSeat(this.currplayer)], "no-moves");
        }
    }

    /**
     * Whether the board still has room for the `eyes` vital regions a pass-alive Defender string
     * needs, given the Attacker's pass-alive stones `permanent`. Those can never be captured, and
     * a point next to one of them can never lie in a vital region of a pass-alive Defender string,
     * so the regions lie among the points touching no permanent stone, in one component of the
     * board minus those stones, and are pairwise non-adjacent. The test is sound but not complete:
     * it never gives up on a Defender who could still live, but does not recognise every hopeless
     * position.
     */
    private roomForEyes(permanent: Set<string>, eyes: number): boolean {
        if (permanent.size === 0) {
            return true;
        }
        const seen = new Set<string>();
        for (const start of this.geo.cells) {
            if (permanent.has(start) || seen.has(start)) {
                continue;
            }
            const eyePoints: string[] = [];
            const todo = [start];
            seen.add(start);
            while (todo.length > 0) {
                const cur = todo.pop()!;
                const adj = this.geo.neighbours.get(cur)!;
                if (!adj.some((n) => permanent.has(n))) {
                    eyePoints.push(cur);
                }
                for (const n of adj) {
                    if (!permanent.has(n) && !seen.has(n)) {
                        seen.add(n);
                        todo.push(n);
                    }
                }
            }
            if (this.hasIndependentPoints(eyePoints, eyes)) {
                return true;
            }
        }
        return false;
    }

    /** Whether `points` include `count` that are pairwise non-adjacent. */
    private hasIndependentPoints(points: string[], count: number): boolean {
        // The board graph is planar, so (four colours) any n points include n/4 non-adjacent ones.
        if (points.length >= 4 * count) {
            return true;
        }
        const adjacent = (a: string, b: string): boolean => this.geo.neighbours.get(a)!.includes(b);
        const search = (from: number, chosen: string[]): boolean => {
            if (chosen.length === count) {
                return true;
            }
            for (let i = from; i < points.length; i++) {
                if (chosen.some((c) => adjacent(c, points[i]))) {
                    continue;
                }
                if (search(i + 1, [...chosen, points[i]])) {
                    return true;
                }
            }
            return false;
        };
        return search(0, []);
    }

    // -----------------------------------------------------------------------
    // Scores
    // -----------------------------------------------------------------------

    /** Tromp-Taylor area: stones of `colour` plus the empty points that reach only that colour. */
    /** The empty regions of `board`, each with the colour it reaches when that is a single one. */
    private regions(board: Board): IRegion[] {
        const regions: IRegion[] = [];
        const seen = new Set<string>();
        for (const cell of this.geo.cells) {
            if (board.has(cell) || seen.has(cell)) {
                continue;
            }
            const cells: string[] = [];
            const reached = new Set<Stone>();
            const todo = [cell];
            seen.add(cell);
            while (todo.length > 0) {
                const cur = todo.pop()!;
                cells.push(cur);
                for (const n of this.geo.neighbours.get(cur)!) {
                    const occupant = board.get(n);
                    if (occupant === undefined) {
                        if (!seen.has(n)) {
                            seen.add(n);
                            todo.push(n);
                        }
                    } else {
                        reached.add(occupant);
                    }
                }
            }
            const region: IRegion = { cells };
            if (reached.size === 1) {
                region.owner = [...reached][0];
            }
            regions.push(region);
        }
        return regions;
    }

    /** Tromp-Taylor area on `board`: stones of `colour` plus the empty points reaching only them. */
    private area(colour: Stone, board: Board): number {
        let score = 0;
        for (const stone of board.values()) {
            if (stone === colour) {
                score++;
            }
        }
        for (const region of this.regions(board)) {
            if (region.owner === colour) {
                score += region.cells.length;
            }
        }
        return score;
    }

    /** Tromp-Taylor area, with the strings marked dead removed, plus the button. */
    public getPlayerScore(player: playerid): number {
        const colour = this.colourOfSeat(player);
        if (colour === undefined) {
            return 0;
        }
        const komi = player === 2 ? this.komi ?? 0 : 0;
        return this.area(colour, this.effectiveBoard()) + (this.button === player ? this.buttonValue : 0) + komi;
    }

    public sidebarScores(): IScores[] {
        if (this.killAll) {
            return [];
        }
        return [{
            name: this.neutralAreaLabel("apgames:status.SCORES"),
            scores: [this.getPlayerScore(1), this.getPlayerScore(2)],
        }];
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    public state(): IThueMorseGoState {
        return {
            game: ThueMorseGoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack],
        };
    }

    public moveState(): IMoveState {
        const state: IMoveState = {
            _version: ThueMorseGoGame.gameinfo.version,
            _results: [...this.results],
            _timestamp: new Date(),
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            phase: this.phase,
            placed: this.placed,
            passes: [...this.passes],
            interim: [...this.interim],
            novel: this.novel,
            marks: [...this.marks],
            dispute: this.dispute,
            locked: this.locked,
        };
        if (this.button !== undefined) { state.button = this.button; }
        if (this.handicap !== undefined) { state.handicap = this.handicap; }
        if (this.passesOwed > 0) { state.passesOwed = this.passesOwed; }
        if (this.komi !== undefined) { state.komi = this.komi; }
        if (this.defenderSeat !== undefined) { state.defenderSeat = this.defenderSeat; }
        if (this.alive !== undefined) { state.alive = [...this.alive]; }
        return state;
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    /**
     * The numbered stones of the current picker, added to `legend` and returned as a cell map,
     * along with the cell of the value chosen so far. The stones are Attacker stones in Kill-All
     * games and neutral when they stand for passes.
     */
    private pickerOverlay(legend: ILegend, swap: boolean): { overlay: Map<string, string>; chosen: string[] } {
        const overlay = new Map<string, string>();
        const chosen: string[] = [];
        const picker = this.picker();
        if (picker === undefined) {
            return { overlay, chosen };
        }
        const fill = this.killAll ? this.paletteOfColour(2, swap) : UNDECIDED_COLOUR;
        for (const btn of picker.buttons) {
            const key = `n${btn.value}`;
            legend[key] = [{ name: "piece", paint: { fill } }, { text: btn.value.toString(), scale: 0.75, rotate: null }];
            overlay.set(btn.cell, key);
            if (btn.value === picker.chosen) {
                chosen.push(btn.cell);
            }
        }
        return { overlay, chosen };
    }

    /**
     * The star points of the board: those the renderer draws on a square board of this size, except
     * that the 11x11 board takes the 4-4 points and no centre.
     */
    private starPoints(): RowCol[] {
        const size = this.boardSize;
        const d = size === 11 || size > 12 ? 4 : 3;
        const lo = d - 1;
        const hi = size - d;
        const points: RowCol[] = [{ row: lo, col: lo }, { row: lo, col: hi }, { row: hi, col: hi }, { row: hi, col: lo }];
        if (size % 2 === 1 && size !== 11) {
            const mid = Math.floor(size / 2);
            points.push({ row: mid, col: mid });
            if (size >= 15) {
                points.push({ row: lo, col: mid }, { row: mid, col: hi }, { row: hi, col: mid }, { row: mid, col: lo });
            }
        }
        return points;
    }

    /**
     * The territory the board scores as it stands, with the strings marked dead removed: a dot on
     * every empty point that reaches only one colour, and the marked stones faded, each with a dot
     * of the colour the point under it counts for, so a lone first stone claims the whole board.
     * Shown in the standard game unless the display hides it; the marked stones are faded regardless.
     * Returns the legend keys of the marked stones by cell and the dots for the empty points.
     */
    private territoryOverlay(legend: ILegend, hide: boolean): { dead: Map<string, string>; dots: MarkerDots[] } {
        const dead = new Map<string, string>();
        const dots: MarkerDots[] = [];
        if (this.killAll) {
            return { dead, dots };
        }
        const owner = new Map<string, Stone>();
        if (!hide) {
            for (const region of this.regions(this.effectiveBoard())) {
                if (region.owner !== undefined) {
                    for (const cell of region.cells) {
                        owner.set(cell, region.owner);
                    }
                }
            }
        }
        // Colours are seats in the standard game, so they name their palette slots directly.
        for (const cell of this.marks) {
            const stone = this.board.get(cell);
            if (stone === undefined) {
                continue;
            }
            const under = owner.get(cell);
            const key = under === undefined ? `D${stone}` : `D${stone}T${under}`;
            if (!(key in legend)) {
                const faded: Glyph = { name: "piece", paint: { fill: stone }, opacity: DEAD_OPACITY };
                legend[key] = under === undefined ? [faded] : [faded, { name: "piece-borderless", paint: { fill: under }, scale: DOT_SIZE }];
            }
            dead.set(cell, key);
        }
        const points: [RowCol[], RowCol[]] = [[], []];
        for (const [cell, colour] of owner) {
            if (!this.board.has(cell)) {
                const [x, y] = this.algebraic2coords(cell);
                points[colour - 1].push({ row: y, col: x });
            }
        }
        for (const colour of [1, 2] as const) {
            const pts = points[colour - 1];
            if (pts.length > 0) {
                dots.push({ type: "dots", colour, size: DOT_SIZE, points: pts as [RowCol, ...RowCol[]] });
            }
        }
        return { dead, dots };
    }

    /**
     * The Thue-Morse tracker, a column of 16 cells per hexadecimal digit of the index of the next
     * placement, least significant on the right, with the rows running 0 to f up (or down) each
     * column and a marker on each digit's current value. A column shows, for each value of its
     * digit, the colour of the placement with that value there, the current values above it and
     * zeros below: the rightmost column is the colours of the placements still to come before the
     * next carry, and every other column is the colour of the 0 row of the column to its right.
     * The rolling display shows one column of the next 16 placements instead, marking those of the
     * next move. The tint behind the columns is the colour of the next placement. Blank columns
     * separate the columns and keep the last one clear of the board's row labels. A repeating
     * protocol needs no tracker.
     */
    private trackArea(legend: ILegend, swap: boolean, downward: boolean, rolling: boolean): AreaTrack | undefined {
        if (this.period > 0) {
            return undefined;
        }
        const next = this.placed;
        const nextFill = this.paletteOfColour(this.colourAt(next), swap);
        const tint: Glyph = { name: "piece-square", paint: { fill: nextFill }, opacity: TRACK_TINT };
        // Keys that differ only in case would be confused by a page in quirks mode, where id lookups
        // ignore case, so the small glyphs are s1/s2 and the markers m1d0 to m2df, by their digit.
        const small = (colour: Stone): string => {
            const key = `s${colour}`;
            if (!(key in legend)) {
                legend[key] = [tint, { name: "piece", paint: { fill: this.paletteOfColour(colour, swap) }, scale: SMALL_SCALE }];
            }
            return key;
        };
        const marker = (colour: Stone, digit: number): string => {
            const key = `m${colour}d${digit.toString(16)}`;
            if (!(key in legend)) {
                legend[key] = [
                    tint,
                    { name: "piece", paint: { fill: this.paletteOfColour(colour, swap), border: MARKER_BORDER } },
                    { text: digit.toString(16), scale: DIGIT_SCALE, rotate: null },
                ];
            }
            return key;
        };

        // Each column top to bottom, as legend keys.
        const columns: string[][] = [];
        if (rolling) {
            const length = this.moveLength(next);
            const column: string[] = [];
            for (let row = 0; row < TRACK_ROWS; row++) {
                const i = downward ? row : TRACK_ROWS - 1 - row;
                const colour = this.colourAt(next + i);
                column.push(i < length ? marker(colour, (next + i) % TRACK_ROWS) : small(colour));
            }
            columns.push(column);
        } else {
            const digits = Math.max(MIN_TRACK_DIGITS, next.toString(16).length);
            for (let d = 0; d < digits; d++) {
                const unit = Math.pow(16, digits - 1 - d);
                const above = Math.floor(next / (unit * 16));
                const current = Math.floor(next / unit) % 16;
                const column: string[] = [];
                for (let row = 0; row < TRACK_ROWS; row++) {
                    const digit = downward ? row : TRACK_ROWS - 1 - row;
                    const colour = this.colourAt((above * 16 + digit) * unit);
                    column.push(digit === current ? marker(colour, digit) : small(colour));
                }
                columns.push(column);
            }
        }

        // A blank frame surrounds the columns, with a blank column between digits. The frame makes
        // room for the border and keeps the tracker clear of the board's row labels.
        const width = 2 * columns.length + 1;
        const height = TRACK_ROWS + 2;
        const blocked: RowCol[] = [];
        const rows: string[] = [];
        for (let row = 0; row < height; row++) {
            const cells: string[] = [];
            for (let col = 0; col < width; col++) {
                if (row >= 1 && row <= TRACK_ROWS && col % 2 === 1) {
                    cells.push(columns[(col - 1) / 2][row - 1]);
                } else {
                    cells.push("-");
                    blocked.push({ row, col });
                }
            }
            // Multi-character keys need the comma-delimited form.
            rows.push(cells.join(","));
        }
        // A thick border around the columns in the colour of the next placement; the line points
        // of a squares board are cell corners.
        const corners: RowCol[] = [
            { row: 1, col: 1 },
            { row: 1, col: width - 1 },
            { row: height - 1, col: width - 1 },
            { row: height - 1, col: 1 },
        ];
        const border: MarkerLine[] = corners.map((from, i) => ({
            type: "line",
            points: [from, corners[(i + 1) % corners.length]],
            colour: nextFill,
            width: TRACK_BORDER_WIDTH,
        }));
        return {
            type: "track",
            position: "left",
            board: {
                style: "squares",
                width,
                height,
                blocked: blocked as [RowCol, ...RowCol[]],
                markers: border,
            },
            pieces: rows.join("\n"),
        };
    }

    /**
     * The results the board annotates: the loaded state's own, unless that state is a move served
     * automatically by the handicap, which changed nothing on the board; the last placements are
     * then those of the move before it.
     */
    private annotationResults(): APMoveResult[] {
        if (this.results.length === 0 || !this.results.every((r) => r.type === "pass" && r.why === "handicap")) {
            return this.results;
        }
        const idx = this.stack.findIndex((state) => state.placed === this.placed && state.currplayer === this.currplayer);
        return idx > 0 ? this.stack[idx - 1]._results : this.results;
    }

    public render(opts?: IRenderOpts): APRenderRep {
        const swap = this.killAll && this.hasDisplay(opts, "swap-colours");
        const downward = this.hasDisplay(opts, "digits-down");
        const rolling = this.hasDisplay(opts, "rolling");
        const hideDots = this.hasDisplay(opts, "hide-territory");
        const legend: ILegend = {
            A: [{ name: "piece", paint: { fill: this.paletteOfColour(1, swap) } }],
            B: [{ name: "piece", paint: { fill: this.paletteOfColour(2, swap) } }],
        };
        const { overlay, chosen } = this.pickerOverlay(legend, swap);
        const { dead, dots } = this.territoryOverlay(legend, hideDots);

        const rows: string[] = [];
        for (let row = 0; row < this.boardSize; row++) {
            const cells: string[] = [];
            for (let col = 0; col < this.boardSize; col++) {
                const cell = this.coords2algebraic(col, row);
                const contents = this.board.get(cell);
                cells.push(overlay.get(cell) ?? dead.get(cell) ?? (contents === 1 ? "A" : contents === 2 ? "B" : "-"));
            }
            if (cells.every((c) => c === "-")) {
                rows.push("_");
            } else {
                // Multi-character keys need the comma-delimited form.
                rows.push(overlay.size > 0 || dead.size > 0 ? cells.join(",") : cells.join(""));
            }
        }

        const rep: APRenderRep = {
            board: {
                style: this.variants.includes("snub") ? "snubsquare" : "vertex",
                width: this.boardSize,
                height: this.boardSize,
            },
            legend,
            pieces: rows.join("\n"),
        };
        // The renderer's own star points serve every square board but the 11x11, which takes the
        // 4-4 points without a centre; snub square boards get those of the square board of their size.
        const snub = this.variants.includes("snub");
        const markers: MarkerDots[] = [];
        if (snub || this.boardSize === 11) {
            markers.push({ type: "dots", size: STAR_SIZE, points: this.starPoints() as [RowCol, ...RowCol[]] });
        }
        markers.push(...dots);
        if (markers.length > 0) {
            (rep.board as BoardBasic).markers = markers;
        }
        if (!snub && this.boardSize === 11) {
            rep.options = ["hide-star-points"];
        }
        const track = this.trackArea(legend, swap, downward, rolling);
        if (track !== undefined) {
            rep.areas = [track];
        }

        const toRowCol = (cell: string): RowCol => {
            const [x, y] = this.algebraic2coords(cell);
            return { row: y, col: x };
        };
        const annotations: NonNullable<APRenderRep["annotations"]> = [];
        for (const r of this.annotationResults()) {
            if (r.type === "place") {
                annotations.push({ type: "enter", targets: [toRowCol(r.where!)] });
            } else if (r.type === "capture" || r.type === "remove") {
                const targets = r.where!.split(",").map(toRowCol);
                annotations.push({ type: "exit", targets: targets as [RowCol, ...RowCol[]] });
            }
        }
        if (this.gameover && this.alive !== undefined && this.alive.length > 0) {
            annotations.push({ type: "enter", targets: this.alive.map(toRowCol) as [RowCol, ...RowCol[]] });
        }
        for (const cell of chosen) {
            annotations.push({ type: "enter", targets: [toRowCol(cell)] });
        }
        if (annotations.length > 0) {
            rep.annotations = annotations;
        }
        return rep;
    }

    public sidebarStatuses(): IStatus[] {
        const statuses: IStatus[] = [];
        statuses.push({
            key: this.neutralAreaLabel("apgames:status.thuemorsego.NEXT_PLACEMENT"),
            value: [`0x${this.placed.toString(16)}`],
        });
        const upcoming = [];
        for (let i = 0; i < 8; i++) {
            upcoming.push(this.statusSheetGlyph("piece", this.colourAt(this.placed + i)));
        }
        statuses.push({
            key: this.neutralAreaLabel("apgames:status.thuemorsego.UPCOMING"),
            value: upcoming,
        });
        if (this.killAll) {
            const undecided = this.neutralAreaLabel("apgames:status.thuemorsego.UNDECIDED");
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.thuemorsego.DEFENDER"),
                value: [this.defenderSeat === undefined ? undecided : this.seatStatusValue(this.defenderSeat)],
            });
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.thuemorsego.ATTACKER"),
                value: [this.attackerSeat === undefined ? undecided : this.seatStatusValue(this.attackerSeat)],
            });
            if (this.handicap !== undefined) {
                statuses.push({
                    key: this.neutralAreaLabel("apgames:status.thuemorsego.HANDICAP"),
                    value: [this.handicap.toString()],
                });
            }
            if (this.phase !== "play" && !this.gameover) {
                const phaseKey = this.phase.replace(/-/g, "_").toUpperCase();
                statuses.push({
                    key: this.neutralAreaLabel("apgames:status.PHASE"),
                    value: [this.seatAreaLabel(this.currplayer, `apgames:status.thuemorsego.PHASE_${phaseKey}`)],
                });
            }
            return statuses;
        }
        if (this.buttonValue > 0) {
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.thuemorsego.BUTTON"),
                value: [this.button === undefined ? this.neutralAreaLabel("apgames:status.thuemorsego.BUTTON_AVAILABLE") : this.seatStatusValue(this.button)],
            });
        }
        if (this.reverseKomi) {
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.thuemorsego.KOMI"),
                value: [this.komi === undefined ? this.neutralAreaLabel("apgames:status.thuemorsego.UNDECIDED") : this.komi.toString()],
            });
        }
        if (this.phase === "komi" && !this.gameover) {
            statuses.push({
                key: this.neutralAreaLabel("apgames:status.PHASE"),
                value: [this.seatAreaLabel(this.currplayer, "apgames:status.thuemorsego.PHASE_KOMI")],
            });
        }
        if (!this.gameover && (this.marks.length > 0 || this.locked)) {
            const value = [];
            if (this.marks.length > 0) {
                value.push(this.neutralAreaLabel("apgames:status.thuemorsego.MARKING_COUNT", { count: this.marks.length }));
            }
            if (this.locked) {
                value.push(this.neutralAreaLabel("apgames:status.thuemorsego.MARKING_LOCKED"));
            }
            statuses.push({ key: this.neutralAreaLabel("apgames:status.thuemorsego.MARKING"), value });
        }
        if (this.handicapVariant && !this.gameover) {
            if (this.declaring() && this.handicap === undefined) {
                statuses.push({
                    key: this.neutralAreaLabel("apgames:status.PHASE"),
                    value: [this.seatAreaLabel(this.currplayer, "apgames:status.thuemorsego.PHASE_DECLARE")],
                });
            } else if (this.passesOwed > 0) {
                statuses.push({
                    key: this.neutralAreaLabel("apgames:status.thuemorsego.PASSES_OWED"),
                    value: [this.passesOwed.toString()],
                });
            }
        }
        return statuses;
    }

    public collectChatLogLine(lines: ChatLogLine[], r: APMoveResult, ctx: ChatLogCollectContext): boolean {
        switch (r.type) {
            case "place":
                if (r.what === "setup") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.thuemorsego_setup", { where: r.where! });
                } else {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PLACE.nowhat", { where: r.where! });
                }
                return true;
            case "capture":
                if (r.how === "suicide") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CAPTURE.thuemorsego_suicide", { count: r.count! });
                } else {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CAPTURE.noperson.group_nowhere", { count: r.count! });
                }
                return true;
            case "pass":
                if (r.why === "handicap") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PASS.thuemorsego_handicap");
                } else {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:PASS.simple");
                }
                return true;
            case "declare":
                if (this.killAll) {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:DECLARE.thuemorsego_stones", { count: r.count! });
                } else {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:DECLARE.thuemorsego_passes", { count: r.count! });
                }
                return true;
            case "claim":
                if (r.how === "attacker") {
                    this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:CLAIM.thuemorsego_attacker");
                    return true;
                }
                return super.collectChatLogLine(lines, r, ctx);
            case "select":
                if (r.what === "dead") {
                    const count = r.where === undefined ? 0 : r.where.split(",").length;
                    this.pushSeatChatLine(lines, ctx.defaultSeat, `apresults:SELECT.thuemorsego_${r.how!}`, { count });
                    return true;
                }
                return super.collectChatLogLine(lines, r, ctx);
            case "remove":
                if (r.how === "dead") {
                    this.pushNeutralChatLine(lines, "apresults:REMOVE.thuemorsego_dead", { count: r.num! });
                    return true;
                }
                return super.collectChatLogLine(lines, r, ctx);
            case "komi":
                this.pushSeatChatLine(lines, ctx.defaultSeat, "apresults:DECLARE.thuemorsego_komi", { count: r.value });
                return true;
            case "eog":
                switch (r.reason) {
                    case "consecutive-passes":
                        this.pushNeutralChatLine(lines, "apresults:EOG.consecutive_passes");
                        break;
                    case "repetition":
                        this.pushNeutralChatLine(lines, "apresults:EOG.thuemorsego_repetition");
                        break;
                    case "pass-alive":
                        this.pushNeutralChatLine(lines, "apresults:EOG.thuemorsego_pass_alive");
                        break;
                    case "no-room":
                        this.pushNeutralChatLine(lines, "apresults:EOG.thuemorsego_no_room");
                        break;
                    case "no-moves":
                        this.pushNeutralChatLine(lines, "apresults:EOG.thuemorsego_no_moves");
                        break;
                    default:
                        this.pushNeutralChatLine(lines, "apresults:EOG.default");
                }
                return true;
            default:
                return super.collectChatLogLine(lines, r, ctx);
        }
    }

    public clone(): ThueMorseGoGame {
        return new ThueMorseGoGame(this.serialize());
    }
}
