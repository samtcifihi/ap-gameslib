/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { replacer, resolveDisplayGroups, reviver } from "../../src/common";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import {
    IIcePalaceState,
    IcePalaceGame,
    PieceId,
    Structure,
    cellOf,
    legalCellsFor,
    legalPalacePlacement,
    maximumBuild,
    placeInto,
    sizeOf,
} from "../../src/games/icepalace";

const countOfSize = (hand: PieceId[], size: 1 | 2 | 3): number =>
    hand.filter(p => sizeOf(p) === size).length;

/** Pins hands and Pool so a dealt game stops being random. */
const rig = (g: IcePalaceGame, hands: PieceId[][], pool?: PieceId[]): IcePalaceGame => {
    g.hands = hands.map(h => [...h]);
    if (pool !== undefined) {
        g.pool = [...pool];
    }
    return g;
};

/** A Pool with plenty of everything, so replenishing never ends the game mid-test. */
const fatPool = (): PieceId[] => {
    const pool: PieceId[] = [];
    for (let i = 0; i < 12; i++) {
        pool.push("1S", "1M", "1L");
    }
    return pool;
};

describe("Ice Palace: setup", () => {
    it("deals every player two pyramids of each size", () => {
        for (const n of [3, 4, 5, 6]) {
            const g = new IcePalaceGame(n);
            expect(g.hands.length).to.equal(n);
            for (const hand of g.hands) {
                expect(hand.length).to.equal(6);
                expect(countOfSize(hand, 1)).to.equal(2);
                expect(countOfSize(hand, 2)).to.equal(2);
                expect(countOfSize(hand, 3)).to.equal(2);
            }
        }
    });

    it("guarantees each player one of each size in their own colour", () => {
        const g = new IcePalaceGame(4);
        for (let p = 1; p <= 4; p++) {
            for (const size of ["S", "M", "L"]) {
                expect(g.hands[p - 1]).to.include(`${p}${size}`);
            }
        }
    });

    it("puts the rest of every stash plus Black and White into the Pool", () => {
        for (const n of [3, 4, 5, 6]) {
            const g = new IcePalaceGame(n);
            // Stashes total 15 each for n players plus Black and White, less six per hand.
            expect(g.pool.length).to.equal(15 * (n + 2) - 6 * n);
            for (const size of [1, 2, 3] as const) {
                expect(countOfSize(g.pool, size)).to.equal(3 * n + 10);
            }
        }
    });

    it("falls back to three players for a count it does not offer", () => {
        // The front previews every multi-count game with two players.
        expect(new IcePalaceGame(2).numplayers).to.equal(3);
        expect(new IcePalaceGame(7).numplayers).to.equal(3);
    });
});

describe("Ice Palace: playing a hand", () => {
    it("accepts typed moves, but founds an empty structure only at the origin", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        // Case and spaces do not matter.
        expect(g.validateMove(" 1m @ 0.0 ").valid).to.be.true;
        // The lead cannot found the Yard anywhere else.
        expect(g.validateMove("1M@5.7").valid).to.be.false;
        expect(g.validateMove("1M@1.0").valid).to.be.false;
    });

    it("will not let the lead pass", () => {
        const g = rig(new IcePalaceGame(3), [["1L"], ["2L"], ["3L"]]);
        expect(g.validateMove("pass").valid).to.be.false;
        expect(() => g.move("pass")).to.throw();
    });

    it("lets the lead place anything anywhere", () => {
        const g = rig(new IcePalaceGame(3), [["BS"], ["2L"], ["3L"]]);
        g.move("BS@0.0");
        expect(g.topOfCell("yard", "0.0")).to.equal("BS");
        expect(g.currplayer).to.equal(2);
    });

    it("stacks bigger over smaller regardless of colour", () => {
        const g = rig(new IcePalaceGame(3), [["1S"], ["BM"], ["3S"]]);
        g.move("1S@0.0");
        // Black stacks fine; only its colour matching is crippled.
        g.move("BM@0.0");
        expect(g.topOfCell("yard", "0.0")).to.equal("BM");
        // Nothing may go under, and a small cannot cover a medium.
        expect(g.validateMove("3S@0.0").valid).to.be.false;
    });

    it("refuses to stack anything over a large", () => {
        const g = rig(new IcePalaceGame(3), [["1L"], ["2L"], ["3S"]]);
        g.move("1L@0.0");
        expect(g.validateMove("2L@0.0").valid).to.be.false;
    });

    it("founds a new stack only next to a matching top", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S", "2S"], ["3S"]]);
        g.move("1M@0.0");
        expect(g.validateMove("2S@1.0").valid).to.be.false;
        expect(g.validateMove("1S@1.0").valid).to.be.true;
    });

    it("treats White as wild and Black as matching nothing", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["WS", "BS"], ["3S"]]);
        g.move("1M@0.0");
        expect(g.validateMove("WS@1.0").valid).to.be.true;
        expect(g.validateMove("BS@1.0").valid).to.be.false;
    });

    it("rejects diagonal placements", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3S"]]);
        g.move("1M@0.0");
        expect(g.validateMove("1S@1.1").valid).to.be.false;
        expect(g.validateMove("1S@0.1").valid).to.be.true;
    });

    it("ends the hand only after every player has passed in a row", () => {
        const g = rig(new IcePalaceGame(3), [["1L", "1M"], ["2S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        g.move("pass");
        g.move("pass");
        expect(g.phase).to.equal("hand");
        // Back to the player who placed, who must also decline before the hand closes.
        expect(g.currplayer).to.equal(1);
        g.move("pass");
        expect(g.phase).to.equal("build");
        expect(g.currplayer).to.equal(1);
    });

    it("lets the last placer keep extending instead of closing the hand", () => {
        const g = rig(new IcePalaceGame(3), [["1L", "1M"], ["2S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        g.move("pass");
        g.move("pass");
        g.move("1L@0.0");
        expect(g.phase).to.equal("hand");
        expect(g.passes).to.equal(0);
    });

    it("hands the build to whoever placed last", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        g.move("1S@0.1");
        g.move("pass");
        g.move("pass");
        g.move("pass");
        expect(g.phase).to.equal("build");
        expect(g.currplayer).to.equal(2);
    });
});

describe("Ice Palace: move lists and auto-passing", () => {
    it("offers a stuck player nothing but a pass, which is what triggers auto-pass", () => {
        // A small Black cannot be played at all: nothing is smaller for it to cover, and
        // Black matches no colour, so it can never found a stack either.
        const g = rig(new IcePalaceGame(3), [["1M"], ["BS"], ["3S"]], fatPool());
        g.move("1M@0.0");
        expect(g.moves()).to.deep.equal(["pass"]);
    });

    it("keeps pass on offer for a player who could place instead", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        const moves = g.moves();
        expect(moves).to.include("pass");
        expect(moves.length).to.be.greaterThan(1);
    });

    it("never offers the lead a pass", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1S"], ["1S"], ["3S"]], fatPool());
        expect(g.moves()).to.not.include("pass");
    });

    it("does not enumerate builds, but still supplies one on request", () => {
        const g = rig(new IcePalaceGame(3), [["1L", "1M"], ["2L"], ["3L"]], fatPool());
        g.move("1M@0.0");
        g.move("pass");
        g.move("pass");
        g.move("1L@0.0");
        while (g.phase === "hand") {
            g.move("pass");
        }
        expect(g.buildMin).to.be.greaterThan(0);
        // Offering a single worked build in the dropdown would imply it were the only one.
        expect(g.moves()).to.be.empty;
        const suggested = g.randomMove();
        const check = g.validateMove(suggested);
        expect(check.valid, check.message).to.be.true;
        expect(check.complete).to.equal(0);
    });

    it("declares autopass and does not declare no-moves", () => {
        const flags = IcePalaceGame.gameinfo.flags ?? [];
        expect(flags).to.include("autopass");
        expect(flags).to.not.include("no-moves");
    });
});

describe("Ice Palace: building the Palace", () => {
    const toBuild = (hands: PieceId[][], lead: string, rest: string[] = []): IcePalaceGame => {
        const g = rig(new IcePalaceGame(3), hands, fatPool());
        g.move(lead);
        for (const m of rest) {
            g.move(m);
        }
        while (g.phase === "hand") {
            g.move("pass");
        }
        return g;
    };
    /** The 3D display, whose one board steps through a build as frames. */
    const deep = (g: IcePalaceGame) => g.render({ altDisplays: ["perspective"] });
    /** A stack's pyramids, without the placeholders that lift them onto the 3D board. */
    const keys = (stack: string[]): string => stack.filter(k => k !== "-").join(",");

    it("discards Black and White on the way out of the Yard", () => {
        const g = toBuild([["BL"], ["2L"], ["3L"]], "BL@0.0");
        expect(g.phase).to.equal("build");
        expect(g.stock).to.be.empty;
        expect(g.buildMin).to.equal(0);
    });

    it("auto-resolves a build with nothing placeable", () => {
        const g = toBuild([["BL"], ["2L"], ["3L"]], "BL@0.0");
        expect(g.moves()).to.deep.equal(["pass"]);
        g.move("pass");
        expect(g.phase).to.equal("hand");
    });

    it("reports the maximum the builder must reach", () => {
        const g = toBuild([["1L", "1M"], ["2L"], ["3L"]], "1M@0.0", ["pass", "pass", "1L@0.0"]);
        expect(g.stock.sort()).to.deep.equal(["1L", "1M"]);
        expect(g.buildMin).to.equal(2);
    });

    it("refuses a build that stops short of the maximum", () => {
        const g = toBuild([["1L", "1M"], ["2L"], ["3L"]], "1M@0.0", ["pass", "pass", "1L@0.0"]);
        const short = g.validateMove("1L@0.0");
        expect(short.valid).to.be.true;
        expect(short.complete).to.equal(-1);
    });

    it("never auto-commits a completed build", () => {
        const g = toBuild([["1L", "1M"], ["2L"], ["3L"]], "1M@0.0", ["pass", "pass", "1L@0.0"]);
        const full = g.validateMove("1L@0.0;1M@0.0");
        expect(full.valid).to.be.true;
        expect(full.complete).to.equal(0);
    });

    it("applies a build and starts the next hand with the token moved on", () => {
        const g = toBuild([["1L", "1M"], ["2L"], ["3L"]], "1M@0.0", ["pass", "pass", "1L@0.0"]);
        g.move("1L@0.0;1M@0.0");
        expect(g.phase).to.equal("hand");
        expect(g.lead).to.equal(2);
        expect(g.currplayer).to.equal(2);
        expect(g.palace.get("0.0")).to.deep.equal(["1L", "1M"]);
    });

    it("renders a build on the 3D board as frames, one per placement, on the final layout", () => {
        const g = toBuild([["1L", "1M"], ["2L"], ["3L"]], "1M@0.0", ["pass", "pass", "1L@0.0"]);
        type Rep = { pieces: string[][][]; areas?: { stash?: string[][]; label?: { textKey?: string } }[] };
        // Before the build there is nothing to step through.
        expect(Array.isArray(deep(g))).to.be.false;
        g.move("1L@0.0;1M@0.0");
        const reps = deep(g) as unknown as Rep[];
        expect(reps).to.have.length(3);
        // Before, after the first placement, and the game as it stands, all the same size.
        const stacks = reps.map(rep => rep.pieces.flat().filter(s => s.length > 0).map(keys));
        expect(stacks[0]).to.deep.equal([]);
        expect(stacks[1]).to.deep.equal(["p1L"]);
        expect(stacks[2]).to.deep.equal(["p1L,p1M"]);
        expect(new Set(reps.map(rep => `${rep.pieces.length}x${rep.pieces[0].length}`)).size).to.equal(1);
        // The stock dwindles through the frames, then the next hand is offered.
        expect(reps[0].areas![0].label?.textKey).to.equal("apgames:status.icepalace.STOCK");
        expect(reps[0].areas![0].stash!.flat()).to.deep.equal(["s1M", "s1L"]);
        expect(reps[1].areas![0].stash!.flat()).to.deep.equal(["s1M"]);
        expect(reps[2].areas![0].label?.textKey).to.equal("apgames:status.icepalace.HAND");
        // Rendering leaves the game as it was, and the frames survive a round trip.
        expect(g.phase).to.equal("hand");
        expect(g.palace.get("0.0")).to.deep.equal(["1L", "1M"]);
        expect((deep(g.clone()) as unknown as Rep[]).length).to.equal(3);
        // Frames belong to the build alone: the next move renders singly again.
        g.move(g.moves()[0]);
        expect(Array.isArray(deep(g))).to.be.false;
    });

    it("outlines the cells the last move placed into on the 3D board", () => {
        type Rep = { pieces: string[][][]; annotations?: { type: string; targets: { row: number; col: number }[] }[] };
        const g = toBuild([["1L", "1M"], ["2L"], ["3L"]], "1M@0.0", ["pass", "pass", "1L@0.0"]);
        // The pass that ended the hand placed nothing.
        expect((deep(g) as unknown as Rep).annotations).to.be.undefined;
        // A build in progress outlines its pending placements in the Palace.
        const pending = deep(g.clone().move("1L@0.0", { partial: true })) as unknown as Rep;
        expect(pending.annotations).to.have.length(1);
        expect(pending.annotations![0].targets.map(t => keys(pending.pieces[t.row][t.col]))).to.deep.equal(["p1L"]);
        // A finished build: each frame outlines its own placement, the last frame all of them.
        g.move("1L@0.0;1M@0.0");
        const reps = deep(g) as unknown as Rep[];
        // (Once the next hand opens the Yard shows too, so the Palace sits further right.)
        const outlined = (rep: Rep) => rep.annotations![0].targets.map(t => keys(rep.pieces[t.row][t.col]));
        expect(reps[0].annotations).to.be.undefined;
        expect(reps[1].annotations![0].type).to.equal("enter");
        expect(outlined(reps[1])).to.deep.equal(["p1L"]);
        expect(outlined(reps[2])).to.deep.equal(["p1L,p1M"]);
        // A Yard placement outlines its cell.
        g.move(g.moves()[0]);
        const yard = deep(g) as unknown as Rep;
        const [{ row: yr, col: yc }] = yard.annotations![0].targets;
        expect(yard.pieces[yr][yc].filter(k => k !== "-")).to.have.length(1);
    });

    it("keeps no frames for a partial build or a build of nothing", () => {
        const g = toBuild([["1L", "1M"], ["2L"], ["3L"]], "1M@0.0", ["pass", "pass", "1L@0.0"]);
        g.move("1L@0.0", { partial: true });
        expect(Array.isArray(deep(g))).to.be.false;
        expect(Array.isArray(g.render())).to.be.false;
        const empty = toBuild([["BL"], ["2L"], ["3L"]], "BL@0.0");
        empty.move("pass");
        expect(Array.isArray(deep(empty))).to.be.false;
        expect(Array.isArray(empty.render())).to.be.false;
    });

    it("refuses a build that breaks the Palace code", () => {
        const g = toBuild([["1L", "1M"], ["2L"], ["3L"]], "1M@0.0", ["pass", "pass", "1L@0.0"]);
        // Small over large is fine, large over medium is not.
        expect(g.validateMove("1M@0.0;1L@0.0").valid).to.be.false;
    });
});

describe("Ice Palace: scoring and ending", () => {
    it("scores each stack for whoever is on top", () => {
        const g = new IcePalaceGame(3);
        g.palace = new Map([
            ["0.0", ["1L", "2M", "3S"]],
            ["1.0", ["2L", "1M"]],
            ["2.0", ["3L"]],
        ]);
        expect(g.getPlayerScore(1)).to.equal(2);
        expect(g.getPlayerScore(2)).to.equal(0);
        expect(g.getPlayerScore(3)).to.equal(4);
    });

    it("ends the game when the Pool cannot replenish every hand", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2L"], ["3L"]], []);
        g.palace = new Map([["5.5", ["1L", "2M"]]]);
        g.move("1M@0.0");
        while (g.phase === "hand") {
            g.move("pass");
        }
        g.move(g.moves()[0]);
        expect(g.gameover).to.be.true;
    });

    it("declares every top scorer a winner, which AP shows as a draw", () => {
        // A Black lead is discarded rather than built, so the rigged Palace is the final one.
        const g = rig(new IcePalaceGame(3), [["BL"], ["2L"], ["3L"]], []);
        // Two stacks of equal height topped by different players.
        g.palace = new Map([
            ["5.5", ["2L", "1M"]],
            ["6.5", ["2L", "3M"]],
        ]);
        g.move("BL@0.0");
        while (g.phase === "hand") {
            g.move("pass");
        }
        g.move(g.moves()[0]);
        expect(g.gameover).to.be.true;
        expect(g.winner.length).to.be.greaterThan(1);
    });
});

describe("Ice Palace: board interaction", () => {
    type Rep = {
        renderer?: string;
        board?: { width: number; height: number; stackOffset?: number };
        legend?: { [k: string]: { name?: string; opacity?: number } };
        pieces: string[][][];
        areas?: { type?: string; pieces?: string[]; stash?: string[][] }[];
        annotations?: { type: string; targets: { row: number; col: number }[] }[];
    };

    /** Board row and column at which a cell's stack is drawn. */
    /** The perspective display, which several checks here are about. */
    const persp = (g: IcePalaceGame): Rep => g.render({ altDisplays: ["perspective", "perspective-hand", "perspective-pool"] }) as unknown as Rep;
    const drawnAt = (rep: Rep, piece: string): [number, number] => {
        for (let row = 0; row < rep.pieces.length; row++) {
            for (let col = 0; col < rep.pieces[row].length; col++) {
                // Yard pyramids use `p` keys; the top-down Palace has `a` keys of its own.
                if (rep.pieces[row][col].includes("p" + piece) || rep.pieces[row][col].includes("a" + piece)) {
                    return [row, col];
                }
            }
        }
        throw new Error(`${piece} is not drawn anywhere`);
    };

    it("maps a click on a drawn stack back to its cell", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2L"], ["3S"]], fatPool());
        g.move("1M@0.0");
        const [row, col] = drawnAt(persp(g), "1M");
        // stacking-3D reports a click on a stacked pyramid with its stack index.
        const click = g.handleClick("2L", row, col, "0");
        expect(click.valid, click.message).to.be.true;
        expect(click.move).to.equal("2L@0.0");
    });

    it("offers frontier space to found new stacks into", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        const [row, col] = drawnAt(persp(g), "1M");
        // The cell to the right is empty padding, and an empty-cell click carries "".
        const click = g.handleClick("1S", row, col + 1, "");
        expect(click.valid, click.message).to.be.true;
        expect(click.move).to.equal("1S@1.0");
    });

    it("never places on the Palace during a hand; a click there drops the pick", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3S"]], fatPool());
        g.palace = new Map([["0.0", ["2L"]]]);
        g.move("1M@0.0");
        const [row, col] = drawnAt(persp(g), "2L");
        const click = g.handleClick("1S", row, col, "0");
        expect(click.move).to.equal("");
        // With nothing picked, the same click is simply refused.
        expect(g.handleClick("", row, col, "0").valid).to.be.false;
    });

    it("switches the pick when another pyramid is clicked", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S", "2L"], ["3S"]], fatPool());
        g.move("1M@0.0");
        const click = g.handleClick("1S", -1, -1, "p2L");
        expect(click.valid).to.be.true;
        expect(click.move).to.equal("2L");
        // During a build, only the unplaced pick is switched.
        const b = rig(new IcePalaceGame(3), [["1M", "1S"], ["2S"], ["3S"]], fatPool());
        b.move("1M@0.0");
        b.move("pass");
        b.move("pass");
        b.move("1S@1.0");
        b.move("pass");
        b.move("pass");
        b.move("pass");
        expect(b.phase).to.equal("build");
        expect(b.handleClick("1M@0.0;1M", -1, -1, "p1S").move).to.equal("1M@0.0;1S");
    });

    it("maps build clicks against the Palace as drawn, pending placements included", () => {
        const b = rig(new IcePalaceGame(3), [["1M", "1S"], ["2S"], ["3S"]], fatPool());
        b.palace = new Map([["0.0", ["1L"]], ["1.0", ["1L"]], ["2.0", ["1L"]]]);
        b.move("1M@0.0");
        b.move("pass");
        b.move("pass");
        b.move("1S@1.0");
        b.move("pass");
        b.move("pass");
        b.move("pass");
        expect(b.phase).to.equal("build");
        // Founding at 3.0 widens the Palace by a column, shifting the board as drawn.
        const partial = b.clone();
        partial.move("1M@3.0;1S", { partial: true });
        const rep = persp(partial);
        const [row, col] = drawnAt(rep, "1M");
        const click = b.handleClick("1M@3.0;1S", row, col, "");
        expect(click.move).to.equal("1M@3.0;1S@3.0");
    });

    it("drops the pick when clicking a cell it cannot go to, keeping earlier placements", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        // A player-2 small cannot found beside a player-1 medium; the Yard origin is row 3, col 3.
        const click = g.handleClick("2S", 3, 4, "");
        expect(click.valid).to.be.true;
        expect(click.move).to.equal("");
        const b = rig(new IcePalaceGame(3), [["1M", "1S"], ["2S"], ["3S"]], fatPool());
        b.move("1M@0.0");
        b.move("pass");
        b.move("pass");
        b.move("1S@1.0");
        b.move("pass");
        b.move("pass");
        b.move("pass");
        // A far corner of the Palace touches nothing the small could found beside.
        const cancel = b.handleClick("1M@0.0;1S", 0, 0, "");
        expect(cancel.move).to.equal("1M@0.0");
        expect(cancel.valid).to.be.true;
    });

    it("selects a pyramid when its entry in the pieces area is clicked", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2L", "2S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        // The pieces area passes the legend key, which carries a letter prefix.
        const click = g.handleClick("", -1, -1, "p2L");
        expect(click.valid, click.message).to.be.true;
        expect(click.move).to.equal("2L");
    });

    it("offers the current hand while a hand is played, and the stock while building", () => {
        const g = rig(new IcePalaceGame(3), [["1L", "1M"], ["2L", "2S"], ["3L"]], fatPool());
        g.move("1M@0.0");
        // The hand is a stash of one-pyramid stacks, labelled with the player's name.
        const hand = (persp(g) as Rep).areas![0].stash!;
        expect(hand.flat().filter(k => k !== "-")).to.deep.equal(["h2S", "h2L"]);
        // With the hand in 3D, each column is dense; 3D silhouette spacing is in the glyphs.
        expect(hand).to.deep.equal([["h2S"], ["h2L"]]);
        g.move("pass");
        g.move("pass");
        g.move("1L@0.0");
        while (g.phase === "hand") {
            g.move("pass");
        }
        expect(g.phase).to.equal("build");
        expect((persp(g) as Rep).areas?.[0].stash?.flat().filter(k => k !== "-").sort()).to.deep.equal(["h1L", "h1M"]);
    });

    it("stacks pyramids the way Volcano does, one index above the last", () => {
        // The -3D glyphs put a small's base on the cell at index 0, a medium's one rise-step
        // lower and a large's two lower. Volcano sits each piece one index above the last
        // and spends "-" placeholders only to keep a base from sinking below the ground.
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        // The lone medium is a colour no other stack holds, so drawnAt finds only it.
        g.palace = new Map([["0.0", ["1L", "2M", "3S"]], ["1.0", ["2L"]], ["2.0", ["3M"]]]);
        g.yard = new Map([["0.0", ["1S", "2M", "3L"]]]);
        const rep = persp(g) as unknown as Rep & { board: { stackOffset?: number }; legend: Record<string, { nudge?: unknown }> };
        expect(rep.board.stackOffset).to.equal(0.15);
        expect(rep.legend.p1L.nudge).to.be.undefined;
        // A Palace tower: the large is lifted onto the ground, then each piece sits one up.
        const [tr, tc] = drawnAt(rep, "3S");
        expect(rep.pieces[tr][tc]).to.deep.equal(["-", "-", "p1L", "p2M", "p3S"]);
        // Lone pieces need only enough lift to reach the ground.
        const [lr, lc] = drawnAt(rep, "2L");
        expect(rep.pieces[lr][lc]).to.deep.equal(["-", "-", "p2L"]);
        const [mr, mc] = drawnAt(rep, "3M");
        expect(rep.pieces[mr][mc]).to.deep.equal(["-", "p3M"]);
        // A Yard stack grows upward in size, so every base already clears the ground.
        const [yr, yc] = drawnAt(rep, "3L");
        expect(rep.pieces[yr][yc]).to.deep.equal(["p1S", "p2M", "p3L"]);
    });

    it("keeps a minimum footprint around the origin and one column between structures", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        // Both structures show from the start, empty as they are: each a five-cell box plus
        // padding each side, one empty column apart.
        let rep = persp(g);
        expect(rep.pieces.length).to.equal(7);
        expect(rep.pieces[0].length).to.equal(7 + 1 + 7);
        // The lead goes in the middle, wherever in the empty Yard it is clicked.
        const click = g.handleClick("1M", 0, 0, "");
        expect(click.move).to.equal("1M@0.0");
        // A click in the Palace is no Yard placement; it drops the pyramid picked.
        expect(g.handleClick("1M", 3, 7 + 1 + 3, "").move).to.equal("");
        g.move("1M@0.0");
        // The Yard sits on the left and the Palace on the right.
        g.palace = new Map([["0.0", ["2L"]]]);
        rep = persp(g);
        expect(rep.pieces[0].length).to.equal(7 + 1 + 7);
        expect(drawnAt(rep, "1M")[1]).to.equal(3);
        expect(drawnAt(rep, "2L")[1]).to.equal(7 + 1 + 3);
        // Growing past the minimum extends the board only in that direction.
        g.yard.set("4.0", ["1S"]);
        rep = persp(g);
        expect(rep.pieces[0].length).to.equal(9 + 1 + 7);
        expect(drawnAt(rep, "2L")[1]).to.equal(9 + 1 + 3);
        // During the build the Yard stands empty but keeps its place, so the board holds
        // its shape from one phase to the next; a click there is no Palace placement.
        g.phase = "build";
        g.currplayer = 1;
        g.stock = ["1M", "1S"];
        g.yard = new Map();
        g.buildMin = 0;
        rep = persp(g);
        expect(rep.pieces[0].length).to.equal(7 + 1 + 7);
        expect(drawnAt(rep, "2L")[1]).to.equal(7 + 1 + 3);
        expect(g.handleClick("1S", 3, 3, "").move).to.equal("");
        expect(g.handleClick("1S", 3, 7 + 1 + 3, "").move).to.equal("1S@0.0");
    });

    it("blanks out cells nothing can reach on the 3D board, leaving stacks and their orthogonal neighbours", () => {
        type Board = { width: number; height: number; blocked: { row: number; col: number }[] };
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        // An empty structure keeps only its centre, where its first pyramid goes: the
        // Yard's, where the lead goes, and the Palace's too, to show where it will stand.
        let board = persp(g).board as unknown as Board;
        expect(board.blocked).to.have.length(board.width * board.height - 2);
        expect(board.blocked).to.not.deep.include({ row: 3, col: 3 });
        expect(board.blocked).to.not.deep.include({ row: 3, col: 7 + 1 + 3 });
        g.move("1M@0.0");
        board = persp(g).board as unknown as Board;
        const open = [];
        for (let row = 0; row < board.height; row++) {
            for (let col = 0; col < board.width; col++) {
                if (!board.blocked.some(b => b.row === row && b.col === col)) {
                    open.push(`${row},${col}`);
                }
            }
        }
        expect(open.sort()).to.deep.equal(["2,3", "3,11", "3,2", "3,3", "3,4", "4,3"]);
    });

    it("shows the Pool below the hand for reference, and ignores clicks on it", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], ["2S", "1L", "WM", "1S"]);
        const rep = persp(g) as Rep & { areas: { type?: string; stash?: string[][]; label?: { textKey?: string } }[] };
        expect(rep.areas).to.have.length(2);
        expect(rep.areas[0].type).to.equal("localStash");
        expect(rep.areas[1].type).to.equal("localStash");
        expect(rep.areas[1].label?.textKey).to.equal("apgames:status.icepalace.IN_POOL");
        // One dense column per colour, largest at the bottom; the renderer stacks 3D silhouettes.
        expect(rep.areas[1].stash).to.deep.equal([
            ["b1L", "b1S"],
            ["b2S"],
            ["bWM"],
        ]);
        // A hand pyramid comes first, under an invisible square that widens its click target.
        const legend = (persp(g) as unknown as { legend: Record<string, unknown> }).legend;
        expect(legend.h1M).to.be.an("array").with.length(2);
        expect((legend.h1M as { name?: string }[])[0].name).to.equal("pyramid-up-medium-3D");
        expect((legend.h1M as { paint?: unknown }[])[1].paint).to.deep.equal({ fill: { colour: "_context_background", opacity: 0 } });
        // Clicking a spacer is like clicking the Pool.
        expect(g.handleClick("", -1, -1, "gap").valid).to.be.false;
        // A click on the Pool changes nothing, whether or not a pyramid is picked.
        let click = g.handleClick("", -1, -1, "b1S");
        expect(click.valid).to.be.false;
        expect(click.move).to.equal("");
        click = g.handleClick("1M", -1, -1, "bWM");
        expect(click.valid).to.be.false;
        expect(click.move).to.equal("1M");
        // An empty Pool shows no area at all.
        g.pool = [];
        expect((persp(g) as Rep).areas).to.have.length(1);
    });

    it("counts the pyramids placed so far against the number to build", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1S"], ["2S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        g.move("pass");
        g.move("pass");
        g.move("1S@1.0");
        g.move("pass");
        g.move("pass");
        g.move("pass");
        expect(g.phase).to.equal("build");
        const placed = () => g.sidebarStatuses().find(st =>
            typeof st.key === "object" && st.key !== null && "textKey" in st.key && st.key.textKey === "apgames:status.icepalace.PLACED")!.value;
        expect(placed()).to.deep.equal(["0 / 2"]);
        const tmp = g.clone();
        tmp.move("1M@0.0", { partial: true });
        expect(tmp.sidebarStatuses().find(st =>
            typeof st.key === "object" && st.key !== null && "textKey" in st.key && st.key.textKey === "apgames:status.icepalace.PLACED")!.value)
            .to.deep.equal(["1 / 2"]);
    });

    it("lists every hand in the status panel, with the button beside the lead's", () => {
        const g = rig(new IcePalaceGame(3), [["1L", "1M"], ["2S"], ["3L", "3M", "3S"]], fatPool());
        const statuses = g.sidebarStatuses();
        expect(statuses.length).to.be.greaterThan(3);
        // Seat 1 leads the first hand, so its row starts with the button.
        expect(statuses[0].value.length).to.equal(3);
        // The button is a meeple in the leader's colour.
        expect(statuses[0].value[0]).to.deep.equal({ kind: "sheet", name: "meeple", colour: 1 });
        expect(statuses[1].value.length).to.equal(1);
        // A pyramid is sent as its legend glyph, so the sidebar paints it as the board does.
        expect(statuses[1].value[0]).to.deep.equal({
            kind: "legend",
            entry: { name: "pyramid-flattened-small", paint: { fill: 2 } },
        });
        expect(statuses[2].value.length).to.equal(3);
        g.lead = 2;
        expect(g.sidebarStatuses()[0].value.length).to.equal(2);
        expect(g.sidebarStatuses()[1].value[0]).to.deep.equal({ kind: "sheet", name: "meeple", colour: 2 });
    });

    it("dots the legal cells once a pyramid is picked, and only then", () => {
        const dotted = (rep: Rep): string[] => {
            const cells: string[] = [];
            rep.pieces.forEach((line, row) => line.forEach((stack, col) => {
                if (stack.includes("dot")) {
                    cells.push(`${row},${col}`);
                }
            }));
            return cells.sort();
        };
        const g = rig(new IcePalaceGame(3), [["1M"], ["2L", "1S"], ["3S"]], fatPool());
        // Nothing picked, nothing dotted; the empty Yard offers only the origin.
        expect(dotted(persp(g) as Rep)).to.deep.equal([]);
        g.move("1M", { partial: true });
        expect(dotted(persp(g) as Rep)).to.deep.equal(["3,3"]);
        g.move("1M@0.0");
        // A large of the wrong colour can only go on top of the medium at the origin, so
        // the dot rides on that stack rather than replacing it.
        g.move("2L", { partial: true });
        const rep = persp(g) as Rep;
        expect(dotted(rep)).to.deep.equal(["3,3"]);
        expect(rep.pieces[3][3]).to.deep.equal(["-", "p1M", "dot"]);
        // A matching small cannot climb onto the medium, so it founds a stack beside it.
        g.move("1S", { partial: true });
        expect(dotted(persp(g) as Rep)).to.deep.equal(["2,3", "3,2", "3,4", "4,3"]);
        // Completing the placement clears the dots.
        g.move("1S@1.0");
        expect(dotted(persp(g) as Rep)).to.deep.equal([]);
    });
});

describe("Ice Palace: top-down display", () => {
    type Rep = {
        renderer?: string;
        options?: string[];
        board?: {
            style?: string;
            width: number;
            height: number;
            stackOffset?: number;
            blocked?: unknown;
            markers?: { type: string; points: { row: number; col: number }[]; colour?: unknown; opacity?: number }[];
        } | null;
        legend?: Record<string, { name?: string; paint?: unknown } | { name?: string }[]>;
        pieces: string[][][];
        areas?: { type?: string; stash?: string[][]; stack?: string[]; width?: number; label?: { textKey?: string } }[];
        annotations?: { type: string; targets: { row: number; col: number }[] }[];
    };
    type Board = NonNullable<Rep["board"]>;
    type Panel = { id: string; label?: { textKey?: string; actor?: { kind: string; seat?: number } }; render: Rep };
    type Composite = { kind: string; layout: { arrangement: string; columns?: number; gap?: number; align?: string }; panels: Panel[] };
    /** The default display: a board for each structure, and a rack of what is on offer. */
    const boards = (g: IcePalaceGame, areas: string[] = []): Composite =>
        g.render({ altDisplays: areas }) as unknown as Composite;
    const panel = (c: Composite, id: string): Panel => {
        const found = c.panels.find(p => p.id === id);
        expect(found, id).to.not.be.undefined;
        return found!;
    };
    /** The board position a panel draws a legend key at. */
    const drawnAt = (rep: Rep, key: string): [number, number] => {
        for (let row = 0; row < rep.pieces.length; row++) {
            for (let col = 0; col < rep.pieces[row].length; col++) {
                if (rep.pieces[row][col].includes(key)) {
                    return [row, col];
                }
            }
        }
        throw new Error(`${key} is not drawn anywhere`);
    };
    const dotted = (rep: Rep): string[] => {
        const cells: string[] = [];
        rep.pieces.forEach((line, row) => line.forEach((stack, col) => {
            if (stack.includes("dot")) {
                cells.push(`${row},${col}`);
            }
        }));
        return cells.sort();
    };
    /** The grid a board's line markers draw, as unit edges between cell corners, each "row,col-row,col". */
    const edgesDrawn = (board: Board): string[] => {
        const edges: string[] = [];
        for (const line of (board.markers ?? []).filter(m => m.type === "line")) {
            // The board's own lines are hidden, so these must be drawn at full strength.
            expect(line.opacity).to.equal(1);
            const [from, to] = line.points;
            const across = from.row === to.row;
            expect(across || from.col === to.col, "a line along the grid").to.be.true;
            const steps = across ? to.col - from.col : to.row - from.row;
            expect(steps).to.be.greaterThan(0);
            for (let i = 0; i < steps; i++) {
                const [row, col] = across ? [from.row, from.col + i] : [from.row + i, from.col];
                edges.push(across ? `${row},${col}-${row},${col + 1}` : `${row},${col}-${row + 1},${col}`);
            }
        }
        expect(new Set(edges).size, "an edge drawn twice").to.equal(edges.length);
        return edges.sort();
    };
    /** The unit edges around some cells, each given as "row,col". */
    const edgesAround = (cells: readonly string[]): string[] => {
        const edges = new Set<string>();
        for (const cell of cells) {
            const [row, col] = cell.split(",").map(Number);
            edges.add(`${row},${col}-${row},${col + 1}`);
            edges.add(`${row + 1},${col}-${row + 1},${col + 1}`);
            edges.add(`${row},${col}-${row + 1},${col}`);
            edges.add(`${row},${col + 1}-${row + 1},${col + 1}`);
        }
        return [...edges].sort();
    };
    const rigged = () => rig(new IcePalaceGame(3), [["1M", "1L", "2S"], ["1S"], ["3S"]], ["2S", "1L", "WM", "1S"]);

    it("is the default, with perspective as the alternate, and neither rotates", () => {
        // The board, the hand and the Pool are three separate choices, offered in that order.
        expect(IcePalaceGame.gameinfo.displays).to.deep.equal([
            { uid: "#board", group: "board" },
            { uid: "perspective", group: "board" },
            { uid: "#hand", group: "hand" },
            { uid: "perspective-hand", group: "hand" },
            { uid: "#pool", group: "pool" },
            { uid: "perspective-pool", group: "pool" },
        ]);
        const displays = new IcePalaceGame(3).alternativeDisplays()!;
        expect(displays.map(d => d.uid)).to.deep.equal(["#board", "perspective", "#hand", "perspective-hand", "#pool", "perspective-pool"]);
        expect([...resolveDisplayGroups(displays).keys()]).to.deep.equal(["board", "hand", "pool"]);
        expect(IcePalaceGame.gameinfo.flags).to.include("stacking-expanding");
        expect(IcePalaceGame.gameinfo.flags).to.include("custom-rotation");
        expect(new IcePalaceGame(3).getCustomRotation()).to.equal(0);
    });

    it("switches to the single 3D board when asked, in either form the front sends", () => {
        const g = new IcePalaceGame(3);
        expect((g.render() as unknown as Composite).kind).to.equal("composite");
        expect(boards(g).kind).to.equal("composite");
        expect(boards(g, ["perspective-hand", "perspective-pool"]).kind).to.equal("composite");
        expect((g.render({ altDisplays: ["perspective"] }) as unknown as Rep).renderer).to.equal("stacking-3D");
        expect((g.render({ altDisplay: "perspective" }) as unknown as Rep).renderer).to.equal("stacking-3D");
    });

    it("gives each structure a board of its own, with the hand racked below the Yard and the Pool below that", () => {
        const g = rigged();
        g.move("1M@0.0");
        g.move("1S@1.0");
        g.palace = new Map([["0.0", ["2L", "1M"]]]);
        const c = boards(g);
        expect(c.kind).to.equal("composite");
        expect(c.layout).to.deep.equal({ arrangement: "grid", columns: 2, gap: 1, align: "start" });
        expect(c.panels.map(p => p.id)).to.deep.equal(["yard", "palace", "rack"]);
        const yard = panel(c, "yard");
        const palace = panel(c, "palace");
        expect(yard.label).to.deep.include({ textKey: "apgames:status.icepalace.YARD", actor: { kind: "none" } });
        expect(palace.label).to.deep.include({ textKey: "apgames:status.icepalace.PALACE", actor: { kind: "none" } });
        // Each board is its structure's own box, drawn by the expanding renderer.
        for (const p of [yard, palace]) {
            expect(p.render.renderer).to.equal("stacking-expanding");
            expect(p.render.options).to.deep.equal(["hide-labels"]);
            expect(p.render.board).to.deep.include({ style: "squares", width: 7, height: 7 });
        }
        // The Yard's stacks sit at the Yard's cells; the Palace's are opaque, with keys of their own.
        expect(drawnAt(yard.render, "p1M")).to.deep.equal([3, 3]);
        expect(drawnAt(yard.render, "p1S")).to.deep.equal([3, 4]);
        expect(yard.render.pieces.flat().filter(s => s.length > 0)).to.have.length(2);
        expect(palace.render.pieces[3][3]).to.deep.equal(["a2L", "a1M"]);
        expect(palace.render.legend).to.have.all.keys("a2L", "a1M");
        expect(yard.render.areas).to.be.undefined;
        expect(palace.render.areas).to.be.undefined;
        // Seat 3's hand is racked one pyramid to a cell, drawn as the stash would draw it,
        // and the Pool hangs below the rack, as wide as the Yard. The rack's cells take
        // clicks but are not drawn: no lines, and no fill.
        const rack = panel(c, "rack");
        expect(rack.label).to.deep.include({ textKey: "apgames:status.icepalace.HAND", actor: { kind: "seat", seat: 3 } });
        expect(rack.render.renderer).to.equal("stacking-expanding");
        expect(rack.render.board).to.deep.equal({
            style: "squares",
            width: 1,
            height: 1,
            strokeOpacity: 0,
            backFill: { colour: "_context_board", opacity: 0 },
        });
        expect(rack.render.pieces).to.deep.equal([[["s3S"]]]);
        expect(rack.render.legend!.s3S).to.deep.include({ name: "pyramid-flattened-small" });
        expect(rack.render.areas).to.have.length(1);
        expect(rack.render.areas![0].label).to.deep.include({ textKey: "apgames:status.icepalace.IN_POOL" });
        expect(rack.render.areas![0].width).to.equal(Math.floor(7 / 0.75));
        expect(rack.render.areas![0].stash).to.deep.equal([["b1L", "gap", "b1S"], ["gap"], ["b2S"], ["gap"], ["bWM"]]);
        expect(rack.render.legend).to.include.keys("b1L", "bWM", "gap");
    });

    it("leaves blank the cells nothing can go into, by drawing the grid of the others rather than blocking the rest", () => {
        const g = rigged();
        g.move("1M@0.0");
        g.move("1S@1.0");
        g.palace = new Map([["0.0", ["2L", "1M"]]]);
        const c = boards(g);
        // Each stack's cell, and the empty cells beside a stack: in the Yard, the cells around
        // the two stacks at the centre and right of it; in the Palace, those around the centre.
        const open = {
            yard: ["2,3", "2,4", "3,2", "3,3", "3,4", "3,5", "4,3", "4,4"],
            palace: ["2,3", "3,2", "3,3", "3,4", "4,3"],
        };
        for (const id of ["yard", "palace"] as const) {
            const board = panel(c, id).render.board!;
            // The composite renderer places a click from the first cell drawn, which a blocked
            // corner would shift, so every cell is drawn, with the board's own lines and fill hidden...
            expect(board.blocked).to.be.undefined;
            expect(board).to.deep.include({ strokeOpacity: 0, backFill: { colour: "_context_board", opacity: 0 } });
            // ...and drawn again on the open cells alone: the board colour, if the viewer has
            // one, and the grid around them.
            const fills = board.markers!.filter(m => m.type === "flood");
            expect(fills).to.have.length(1);
            expect(fills[0]).to.deep.include({ colour: "_context_board", opacity: 1 });
            expect(fills[0].points.map(p => `${p.row},${p.col}`).sort()).to.deep.equal(open[id]);
            expect(edgesDrawn(board)).to.deep.equal(edgesAround(open[id]));
        }
        // An empty structure shows only its centre, where its first pyramid goes, and a click
        // anywhere on its board still goes there.
        const fresh = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        const empty = panel(boards(fresh), "yard").render.board!;
        expect(empty.markers!.find(m => m.type === "flood")!.points).to.deep.equal([{ row: 3, col: 3 }]);
        expect(edgesDrawn(empty)).to.deep.equal(edgesAround(["3,3"]));
        expect(fresh.handleClick("1M", 0, 0, "", "yard").move).to.equal("1M@0.0");
    });

    it("looks straight down at the 3D board's footprint, with translucent Yard stacks, an opaque Palace and no placeholders", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1L"], ["1S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        g.move("1S@1.0");
        g.palace = new Map([["0.0", ["2L", "1M"]]]);
        const c = boards(g);
        const deep = g.render({ altDisplays: ["perspective"] }) as unknown as Rep;
        const yard = panel(c, "yard").render;
        const palace = panel(c, "palace").render;
        // The two boards are the 3D board's two regions, without the column between them.
        expect(yard.board!.height).to.equal(deep.board!.height);
        expect(yard.board!.width + 1 + palace.board!.width).to.equal(deep.board!.width);
        for (const p of c.panels) {
            expect(p.render.board!.stackOffset).to.be.undefined;
            for (const line of p.render.pieces) {
                for (const stack of line) {
                    expect(stack).to.not.include("-");
                }
            }
        }
        // The Palace stack is listed bottom first, opaque, with keys of its own; the Yard
        // stays translucent.
        expect(palace.pieces[3][3]).to.deep.equal(["a2L", "a1M"]);
        expect(palace.legend!.a2L).to.deep.equal({ name: "pyramid-up-large-upscaled", paint: { fill: 2 } });
        expect(palace.legend!.a1M).to.deep.equal({ name: "pyramid-up-medium-upscaled", paint: { fill: 1 } });
        expect(yard.pieces[3][3]).to.deep.equal(["p1M"]);
        // Only the fill is translucent, so the outline stays solid.
        expect(yard.legend!.p1M).to.deep.equal({ name: "pyramid-up-medium-upscaled", paint: { fill: { colour: 1, opacity: 0.75 } } });
    });

    it("racks the hand, then the stock, as nests one to a cell, and picks the pyramid clicked", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S", "1L", "2L", "WS", "2S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        let rack = panel(boards(g), "rack").render;
        // Player 2's hand, by colour and then by size, one pyramid to a cell.
        expect(rack.pieces).to.deep.equal([[["s1L"], ["s2S"], ["s2S"], ["s2L"], ["sWS"]]]);
        expect(rack.legend!.s2L).to.deep.equal({ name: "pyramid-flattened-large", paint: { fill: 2 } });
        // White is white by default, or palette slot 8 for a viewer with a saved palette,
        // and its outline and pips contrast with whichever it is.
        const white = { func: "custom", default: "#ffffff", palette: 8 };
        expect(rack.legend!.sWS).to.deep.equal({
            name: "pyramid-flattened-small",
            paint: { fill: white, border: { func: "bestContrast", bg: white, fg: ["#000000", "#ffffff"] } },
        });
        // A click on a racked pyramid picks it.
        expect(g.handleClick("", 0, 3, "", "rack").move).to.equal("2L");
        // During the build the stock is racked the same way.
        g.phase = "build";
        g.currplayer = 1;
        g.stock = ["3M", "1S", "3L"];
        g.buildMin = 0;
        rack = panel(boards(g), "rack").render;
        expect(rack.pieces).to.deep.equal([[["s1S"], ["s3M"], ["s3L"]]]);
    });

    it("wraps a long rack at the Yard's width, and hangs the Pool under the Yard when nothing is on offer", () => {
        const g = rigged();
        g.yard = new Map();
        g.phase = "build";
        g.currplayer = 2;
        g.stock = ["3L", "3M", "3S", "2L", "2M", "2S", "1L", "1M", "1S"];
        const rack = panel(boards(g), "rack");
        expect(rack.label).to.deep.include({ textKey: "apgames:status.icepalace.STOCK", actor: { kind: "none" } });
        expect(rack.render.board).to.deep.include({ style: "squares", width: 7, height: 2 });
        expect(rack.render.pieces.map(row => row.map(cell => cell.join()))).to.deep.equal([
            ["s1S", "s1M", "s1L", "s2S", "s2M", "s2L", "s3S"],
            ["s3M", "s3L", "", "", "", "", ""],
        ]);
        // Nothing to build with: no rack, and the Pool hangs under the Yard instead.
        g.stock = [];
        const bare = boards(g);
        expect(bare.panels.map(p => p.id)).to.deep.equal(["yard", "palace"]);
        expect(panel(bare, "yard").render.areas![0].label).to.deep.include({ textKey: "apgames:status.icepalace.IN_POOL" });
        expect(panel(bare, "palace").render.areas).to.be.undefined;
    });

    it("shows the Pool below the rack as one stack per colour, wrapping at the Yard's width", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], ["2S", "1L", "WM", "1S", "1L"]);
        const rack = panel(boards(g), "rack").render;
        const pool = rack.areas![0];
        expect(pool.type).to.equal("localStash");
        // A spacer column sits between each pair of colours.
        expect(pool.stash).to.deep.equal([["b1L", "b1L", "gap", "b1S"], ["gap"], ["b2S"], ["gap"], ["bWM"]]);
        // Pool pyramids are seen from above, as opaque diamonds.
        expect(rack.legend!.b1L).to.deep.equal({ name: "pyramid-up-large-upscaled", paint: { fill: 1 }, rotate: 45 });
        // A stash column is three quarters of a cell, so the 7-cell Yard takes 9 of them.
        expect(pool.width).to.equal(9);
        // The Pool grows with the Yard above it, not with the Palace beside it.
        g.palace = new Map([["3.0", ["2L"]]]);
        expect(panel(boards(g), "rack").render.areas![0].width).to.equal(9);
        g.yard = new Map([["3.0", ["1S"]]]);
        expect(panel(boards(g), "rack").render.areas![0].width).to.equal(10);
    });

    it("dots the legal cells once a pyramid is picked, on the board it would go to", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        g.move("1S", { partial: true });
        const c = boards(g);
        expect(dotted(panel(c, "yard").render)).to.deep.equal(["2,3", "3,2", "3,4", "4,3"]);
        expect(dotted(panel(c, "palace").render)).to.deep.equal([]);
    });

    it("takes clicks by panel: the rack names a pyramid, a structure a cell, the wrong structure nothing", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3M", "1S"]], fatPool());
        g.move("1M@0.0");
        g.move("1S@1.0");
        // Seat 3's rack: its small, then its medium. Which glyph the renderer reports is beside the point.
        expect(panel(boards(g), "rack").render.pieces).to.deep.equal([[["s1S"], ["s3M"]]]);
        let click = g.handleClick("", 0, 1, "SvgjsSymbol1", "rack");
        expect(click.valid, click.message).to.be.true;
        expect(click.move).to.equal("3M");
        // The medium covers the small at 1.0, a column right of the Yard's origin.
        click = g.handleClick(click.move, 3, 4, "", "yard");
        expect(click.valid, click.message).to.be.true;
        expect(click.move).to.equal("3M@1.0");
        expect(click.complete).to.equal(1);
        // The small founds beside the Yard's origin.
        expect(g.handleClick("1S", 3, 2, "", "yard").move).to.equal("1S@-1.0");
        // The Palace takes nothing during a hand, nor does a panel this game never drew, nor
        // a position off the board; each drops the pick.
        expect(g.handleClick("1S", 3, 3, "", "palace").move).to.equal("");
        expect(g.handleClick("1S", 3, 3, "", "elsewhere").move).to.equal("");
        expect(g.handleClick("1S", 7, 7, "", "yard").move).to.equal("");
        // An empty rack cell changes nothing.
        const empty = g.handleClick("1S", 1, 0, "", "rack");
        expect(empty.move).to.equal("1S");
        expect(empty.valid).to.be.false;
    });

    it("builds by clicking the rack and the Palace", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1S"], ["2S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        g.move("pass");
        g.move("pass");
        g.move("1S@1.0");
        while (g.phase === "hand") {
            g.move("pass");
        }
        expect(g.buildMin).to.equal(2);
        // The stock is racked smallest first.
        expect(panel(boards(g), "rack").render.pieces).to.deep.equal([[["s1S"], ["s1M"]]]);
        // The first placement goes to the empty Palace's origin wherever the click lands.
        let click = g.handleClick("", 0, 1, "", "rack");
        expect(click.move).to.equal("1M");
        click = g.handleClick(click.move, 1, 1, "", "palace");
        expect(click.move).to.equal("1M@0.0");
        expect(click.complete).to.equal(-1);
        // The rack is read less what the build has placed: its first cell is now the small.
        click = g.handleClick(click.move, 0, 0, "", "rack");
        expect(click.move).to.equal("1M@0.0;1S");
        // While a pyramid is picked, the Palace shows where it may go and the rack what is left.
        const pending = boards(g.clone().move("1M@0.0;1S", { partial: true }));
        expect(panel(pending, "rack").render.pieces).to.deep.equal([[["s1S"]]]);
        expect(panel(pending, "palace").render.legend).to.have.property("dot");
        expect(panel(pending, "yard").render.legend).to.not.have.property("dot");
        expect(panel(pending, "palace").render.annotations).to.deep.equal([{ type: "enter", targets: [{ row: 3, col: 3 }] }]);
        expect(panel(pending, "yard").render.annotations).to.be.undefined;
        click = g.handleClick(click.move, 3, 4, "", "palace");
        expect(click.move).to.equal("1M@0.0;1S@1.0");
        expect(click.complete).to.equal(0);
        g.move(click.move);
        // Either display then steps through the build as frames.
        expect(Array.isArray(g.render({ altDisplays: ["perspective"] }))).to.be.true;
        expect(Array.isArray(g.render())).to.be.true;
    });

    it("steps through a finished build as frames, one per placement, the boards holding still", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1S"], ["2S"], ["3S"]], fatPool());
        for (const m of ["1M@0.0", "pass", "pass", "1S@1.0"]) {
            g.move(m);
        }
        while (g.phase === "hand") {
            g.move("pass");
        }
        g.move("1M@0.0;1S@1.0");
        const frames = g.render() as unknown as Composite[];
        // Before, after the first placement, and the game as it stands.
        expect(frames).to.have.length(3);
        expect(frames.map(f => f.kind)).to.deep.equal(["composite", "composite", "composite"]);
        const stacks = frames.map(f => panel(f, "palace").render.pieces.flat().filter(s => s.length > 0).map(s => s.join()));
        expect(stacks).to.deep.equal([[], ["a1M"], ["a1M", "a1S"]]);
        // Every frame's boards are the final ones, so that they hold still.
        const sizes = frames.map(f => ["yard", "palace"].map(id => `${panel(f, id).render.board!.width}x${panel(f, id).render.board!.height}`).join());
        expect(new Set(sizes).size).to.equal(1);
        // Each frame after the first outlines the placement it shows, the last all of them.
        expect(frames.map(f => panel(f, "palace").render.annotations)).to.deep.equal([
            undefined,
            [{ type: "enter", targets: [{ row: 3, col: 3 }] }],
            [{ type: "enter", targets: [{ row: 3, col: 3 }, { row: 3, col: 4 }] }],
        ]);
        expect(frames.map(f => panel(f, "yard").render.annotations)).to.deep.equal([undefined, undefined, undefined]);
        // The stock dwindles on the rack through the frames, then the next hand is offered.
        expect(panel(frames[0], "rack").label).to.deep.include({ textKey: "apgames:status.icepalace.STOCK" });
        expect(panel(frames[0], "rack").render.pieces.flat(2)).to.deep.equal(["s1S", "s1M"]);
        expect(panel(frames[1], "rack").render.pieces.flat(2)).to.deep.equal(["s1S"]);
        expect(panel(frames[2], "rack").label).to.deep.include({ textKey: "apgames:status.icepalace.HAND", actor: { kind: "seat", seat: 2 } });
        // Frames belong to the build alone: the next move renders singly again.
        g.move(g.moves()[0]);
        expect(Array.isArray(g.render())).to.be.false;
    });

    it("lays out the hovered stack beside the boards, bottom first, from the side", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1L"], ["1S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        g.move("1S@1.0");
        g.palace = new Map([["0.0", ["2L", "1M"]]]);
        // The front names the board hovered; each structure's origin is its board's centre.
        let rep = g.renderColumn(3, 3, "yard") as unknown as Rep;
        expect(rep.renderer).to.equal("stacking-expanding");
        expect(rep.board).to.be.null;
        expect(rep.areas).to.deep.equal([{ type: "expandedColumn", stack: ["c1M"] }]);
        expect(rep.legend!.c1M).to.deep.equal({ name: "pyramid-flat-medium", paint: { fill: 1 } });
        // The Palace can be looked into during a hand too.
        rep = g.renderColumn(3, 3, "palace") as unknown as Rep;
        expect(rep.areas).to.deep.equal([{ type: "expandedColumn", stack: ["c2L", "c1M"] }]);
        expect(Object.keys(rep.legend!).sort()).to.deep.equal(["c1M", "c2L"]);
        // An empty cell, the rack, and a position off the board show nothing.
        for (const [col, row, id] of [[0, 0, "yard"], [0, 0, "rack"], [9, 9, "palace"]] as const) {
            expect((g.renderColumn(col, row, id) as unknown as Rep).areas).to.deep.equal([{ type: "expandedColumn", stack: [] }]);
        }
        // With no board named, the position is read as on the 3D display's single board.
        expect((g.renderColumn(7 + 1 + 3, 3) as unknown as Rep).areas).to.deep.equal([{ type: "expandedColumn", stack: ["c2L", "c1M"] }]);
    });

    it("documents every palette slot it uses, Black and White included", () => {
        const slots = (IcePalaceGame.gameinfo.customizations as { num: number; default: string | number }[]);
        expect(slots.map(c => c.num)).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(slots.find(c => c.num === 7)!.default).to.equal("#000000");
        expect(slots.find(c => c.num === 8)!.default).to.equal("#ffffff");
    });
});

describe("Ice Palace: mixing the board and stash displays", () => {
    type Part = { name?: string; rotate?: number; opacity?: number; nudge?: { dy?: number } };
    type Rep = {
        renderer: string;
        board?: { width: number };
        legend: Record<string, Part | Part[]>;
        pieces?: string[][][];
        areas?: { stash?: string[][]; width?: number; label?: { textKey?: string } }[];
    };
    type Composite = { kind: "composite"; panels: { id: string; render: Rep }[] };
    const rigged = () => rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], ["2S", "1L", "WM", "1S"]);
    const isComposite = (out: unknown): out is Composite => (out as { kind?: string }).kind === "composite";
    /** Every legend in a render: the 3D board's, or each of the top-down boards'. */
    const legends = (out: unknown): Record<string, Part | Part[]>[] =>
        isComposite(out) ? out.panels.map(p => p.render.legend) : [(out as Rep).legend];
    /** The Pool, wherever the display puts it. */
    const poolOf = (out: unknown): string[][] => {
        const areas = isComposite(out) ? out.panels.flatMap(p => p.render.areas ?? []) : (out as Rep).areas ?? [];
        return areas.find(a => a.label?.textKey === "apgames:status.icepalace.IN_POOL")!.stash!;
    };

    it("draws the hand and Pool from above under the 3D board unless asked otherwise", () => {
        const rep = rigged().render({ altDisplays: ["perspective"] }) as unknown as Rep;
        expect(rep.renderer).to.equal("stacking-3D");
        // The hand and Pool are drawn as on the top-down boards: nests one per column, and
        // opaque diamonds with a spacer between sizes and a spacer column between colours.
        expect(rep.areas![0].stash).to.deep.equal([["s1M"]]);
        expect(rep.legend.s1M).to.include({ name: "pyramid-flattened-medium" });
        expect(rep.areas![1].stash).to.deep.equal([["b1L", "gap", "b1S"], ["gap"], ["b2S"], ["gap"], ["bWM"]]);
        expect(rep.areas![1].stash).to.deep.equal(poolOf(rigged().render()));
        expect(rep.legend.b1L).to.deep.include({ name: "pyramid-up-large-upscaled", paint: { fill: 1 }, rotate: 45 });
        expect(rep.legend.b1L).to.not.have.any.keys("opacity", "nudge");
    });

    it("racks the hand and draws the Pool in 3D on the top-down boards on request", () => {
        const out = rigged().render({ altDisplays: ["perspective-hand", "perspective-pool"] });
        expect(isComposite(out)).to.be.true;
        const rack = (out as unknown as Composite).panels.find(p => p.id === "rack")!.render;
        // A click on the rack names its cell, so the 3D pyramid needs no wider click target.
        expect(rack.pieces).to.deep.equal([[["h1M"]]]);
        expect(rack.legend.h1M).to.deep.include({ name: "pyramid-up-medium-3D" });
        expect(rack.legend.h1M).to.not.be.an("array");
        // The Pool as under the 3D board: one dense column per colour, which the renderer nests
        // on a shared base line. A spacer among 3D pyramids is an error to the renderer.
        expect(poolOf(out)).to.deep.equal([["b1L", "b1S"], ["b2S"], ["bWM"]]);
        expect(rack.legend.b1L).to.not.have.any.keys("nudge");
        expect(rack.legend.b1S).to.deep.include({ name: "pyramid-up-small-3D" });
        expect(rack.legend.b1S).to.not.have.any.keys("nudge");
        expect(poolOf(out).flat()).to.not.include("-");
    });

    it("rests the racked 3D pyramids on one floor, as a stash does", () => {
        // A board centres each piece in its cell, and a 3D pyramid's base sits below its
        // centre by a step for each size above small (fractions of the 500-unit glyph, as
        // the renderer's sheet draws them), so the smaller ones are nudged down.
        const baseBelowCentre: Record<string, number> = {
            "pyramid-up-small-3D": 0,
            "pyramid-up-medium-3D": 0.15,
            "pyramid-up-large-3D": 0.3,
        };
        const g = rig(new IcePalaceGame(3), [["1S", "2M", "3L"], ["2S"], ["3S"]], fatPool());
        const rack = (g.render({ altDisplays: ["perspective-hand"] }) as unknown as Composite).panels.find(p => p.id === "rack")!.render;
        const glyphs = rack.pieces!.flat(2).map(key => rack.legend[key] as Part);
        expect(glyphs.map(glyph => glyph.name)).to.deep.equal(["pyramid-up-small-3D", "pyramid-up-medium-3D", "pyramid-up-large-3D"]);
        const floors = glyphs.map(glyph => baseBelowCentre[glyph.name!] * 500 + (glyph.nudge?.dy ?? 0));
        expect(new Set(floors).size).to.equal(1);
    });

    it("draws the hand and the Pool each the way chosen for it, on either display", () => {
        type Area = NonNullable<Rep["areas"]>[number];
        /** The offered pyramids, as the rack or the stash under the 3D board holds them. */
        const handOf = (out: unknown): string[] => isComposite(out)
            ? out.panels.find(p => p.id === "rack")!.render.pieces!.flat(2)
            : (out as Rep).areas!.find((a: Area) => a.label?.textKey !== "apgames:status.icepalace.IN_POOL")!.stash!.flat();
        const glyphOf = (out: unknown, key: string): Part | Part[] => legends(out).find(legend => key in legend)![key];
        for (const board of [[], ["perspective"]]) {
            // The hand in 3D, the Pool from above: diamonds, with spacers between the colours.
            let out = rigged().render({ altDisplays: [...board, "perspective-hand"] });
            expect(handOf(out)).to.deep.equal(["h1M"]);
            expect(([] as Part[]).concat(glyphOf(out, "h1M"))[0]).to.deep.include({ name: "pyramid-up-medium-3D" });
            expect(poolOf(out)).to.deep.equal([["b1L", "gap", "b1S"], ["gap"], ["b2S"], ["gap"], ["bWM"]]);
            expect(glyphOf(out, "b1L")).to.deep.include({ name: "pyramid-up-large-upscaled", rotate: 45 });
            // The hand from above, the Pool in 3D.
            out = rigged().render({ altDisplays: [...board, "perspective-pool"] });
            expect(handOf(out)).to.deep.equal(["s1M"]);
            expect(glyphOf(out, "s1M")).to.deep.include({ name: "pyramid-flattened-medium" });
            expect(poolOf(out)).to.deep.equal([["b1L", "b1S"], ["b2S"], ["bWM"]]);
            expect(glyphOf(out, "b1L")).to.deep.include({ name: "pyramid-up-large-3D" });
        }
    });

    it("reads the retired choice of both in 3D as the two choices it became", () => {
        const g = rigged();
        expect(g.resolveActiveDisplays({ altDisplays: ["perspective-areas"] })).to.deep.equal(["perspective-hand", "perspective-pool"]);
        expect(g.resolveActiveDisplays({ altDisplay: "perspective-areas" })).to.deep.equal(["perspective-hand", "perspective-pool"]);
        for (const board of [[], ["perspective"]]) {
            expect(g.render({ altDisplays: [...board, "perspective-areas"] }))
                .to.deep.equal(g.render({ altDisplays: [...board, "perspective-hand", "perspective-pool"] }));
        }
    });

    it("shows the 3D Pool as nests, so no two pyramids are drawn as one", () => {
        // The renderer rests a 3D column's pyramids on one base line by size, so a colour
        // with several of a size is shown as several nests, each holding one of each size
        // that is left: three larges, a medium and two smalls make three nests.
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], ["1S", "1L", "WM", "1L", "1M", "WM", "1S", "1L"]);
        for (const altDisplays of [["perspective-pool"], ["perspective", "perspective-pool"]]) {
            expect(poolOf(g.render({ altDisplays }))).to.deep.equal([
                ["b1L", "b1M", "b1S"],
                ["b1L", "b1S"],
                ["b1L"],
                ["bWM"],
                ["bWM"],
            ]);
        }
        // Seen from above, a colour's pyramids stack in one column with a spacer between sizes.
        expect(poolOf(g.render({ altDisplays: [] }))).to.deep.equal([
            ["b1L", "b1L", "b1L", "gap", "b1M", "gap", "b1S", "b1S"],
            ["gap"],
            ["bWM", "bWM"],
        ]);
    });

    it("wraps the 3D board's hand and Pool at the board's width, not three quarters of it", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], ["1L", "2L", "3L", "BL", "WL"]);
        // A stash column is three quarters of a cell, so the 15-cell board, the Yard and the
        // Palace with a column between, takes 20 of them: the five colours and the spacers
        // between them make one row with room to spare.
        for (const altDisplays of [["perspective"], ["perspective", "perspective-hand", "perspective-pool"]]) {
            const rep = g.render({ altDisplays }) as unknown as Rep;
            expect(rep.board!.width).to.equal(15);
            expect(rep.areas!.map(a => a.width)).to.deep.equal([20, 20]);
        }
        expect(poolOf(g.render({ altDisplays: ["perspective"] }))).to.have.length(9);
        // As the board grows, so do the rows.
        g.palace = new Map([["3.0", ["2L"]]]);
        const rep = g.render({ altDisplays: ["perspective"] }) as unknown as Rep;
        expect(rep.board!.width).to.equal(16);
        expect(rep.areas!.map(a => a.width)).to.deep.equal([21, 21]);
    });

    it("outlines Black and White pyramids in whichever of black and white contrasts", () => {
        // The sheet's black outline and pips would vanish on a Black pyramid, in every view
        // and in the sidebar; the players' pyramids keep the sheet's outline.
        const g = rig(new IcePalaceGame(3), [["1S"], ["BM", "BL", "2S"], ["3S"]], ["WM", "1L"]);
        g.palace = new Map([["0.0", ["2L", "BM"]]]);
        g.move("1S@0.0");
        // Seat 2's Black medium covers the small; its large stays in hand for the sidebar.
        g.move("BM@0.0", { partial: true });
        const outs: unknown[] = [[], ["perspective"], ["perspective-hand", "perspective-pool"], ["perspective", "perspective-hand", "perspective-pool"]]
            .map(altDisplays => g.render({ altDisplays }));
        outs.push(g.renderColumn(3, 3, "palace"));
        type Painted = { paint?: { fill?: unknown; border?: unknown } };
        const contrast = (body: unknown) => ({ func: "bestContrast", bg: body, fg: ["#000000", "#ffffff"] });
        const black = { func: "custom", default: "#000000", palette: 7 };
        const white = { func: "custom", default: "#ffffff", palette: 8 };
        let seen = 0;
        for (const legend of outs.flatMap(legends)) {
            for (const [key, entry] of Object.entries(legend)) {
                if (!/^[a-z][BW][SML]$/.test(key)) {
                    continue;
                }
                const glyph = ([] as Painted[]).concat(entry as Painted | Painted[]).find(part => part.paint?.border !== undefined);
                expect(glyph, key).to.not.be.undefined;
                expect(glyph!.paint!.border).to.deep.equal(contrast(key[1] === "B" ? black : white));
                seen++;
            }
            for (const [key, entry] of Object.entries(legend)) {
                if (/^[a-z][1-6][SML]$/.test(key)) {
                    for (const part of ([] as Painted[]).concat(entry as Painted | Painted[])) {
                        expect(part.paint, key).to.not.have.property("border");
                    }
                }
            }
        }
        expect(seen).to.be.greaterThan(8);
        // The sidebar carries the same glyph.
        const hand = g.sidebarStatuses()[1].value as { kind: string; entry?: Painted & { name?: string } }[];
        const bl = hand.find(v => v.kind === "legend" && v.entry?.name === "pyramid-flattened-large")!;
        expect(bl).to.not.be.undefined;
        expect(bl.entry!.paint).to.deep.equal({ fill: black, border: contrast(black) });
    });

    it("colours every glyph through paint, not the deprecated colour", () => {
        const g = rigged();
        g.palace = new Map([["0.0", ["2L"]]]);
        g.move("1M@0.0");
        // A picked pyramid adds the dots for its legal cells.
        g.move("2S", { partial: true });
        const outs: unknown[] = [[], ["perspective"], ["perspective-hand", "perspective-pool"], ["perspective", "perspective-hand", "perspective-pool"]]
            .map(altDisplays => g.render({ altDisplays }));
        outs.push(g.renderColumn(3, 3, "yard"));
        expect(legends(outs[0]).some(legend => "dot" in legend)).to.be.true;
        const glyphs = outs.flatMap(legends).flatMap(legend => Object.values(legend).flat());
        expect(glyphs.length).to.be.greaterThan(10);
        for (const glyph of glyphs) {
            expect(glyph).to.have.property("paint");
            // A layer opacity beside paint would fade the outline too; only fills are translucent.
            expect(glyph).to.not.have.any.keys("colour", "colour2", "opacity");
        }
    });
});

describe("Ice Palace: event log", () => {
    before(() => {
        addResource("en");
    });
    const names = ["Alice", "Bob", "Carol"];
    const lastLines = (g: IcePalaceGame) => {
        const entries = g.chatLogEntries(names);
        return entries[entries.length - 1].lines;
    };

    it("announces the build with the count and one legal way to do it", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        g.move("pass");
        g.move("pass");
        g.move("pass");
        expect(g.phase).to.equal("build");
        const lines = lastLines(g);
        const announce = lines.find(l => l.textKey === "apresults:icepalace.ANNOUNCE.build")!;
        expect(announce).to.not.be.undefined;
        expect(announce.textParams).to.include({ count: 1, move: "1M@0.0" });
        // The suggested move is a complete, legal build as it stands.
        const check = g.validateMove(announce.textParams!.move as string);
        expect(check.valid).to.be.true;
        expect(check.complete).to.equal(0);
        // It is quoted for copying, and the line is attributed to the builder.
        const text = g.chatLog(names).flat().join("\n");
        expect(text).to.include("Alice won the hand");
        expect(text).to.include("`1M@0.0`");
        assertChatLogParity(g, names);
    });

    it("says so when nothing from the Yard can be built", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        g.palace = new Map([["0.0", ["2S"]]]);
        g.move("1M@0.0");
        g.move("pass");
        g.move("pass");
        g.move("pass");
        expect(g.buildMin).to.equal(0);
        expect(g.moves()).to.deep.equal(["pass"]);
        const keys = lastLines(g).map(l => l.textKey);
        expect(keys).to.include("apresults:icepalace.ANNOUNCE.nobuild");
        expect(keys).to.include("apresults:_general.PASS.simple");
    });
});

describe("Ice Palace: serialization", () => {
    it("survives a round trip through its own state", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1L"], ["WS"], ["3S"]], fatPool());
        g.move("1M@0.0");
        // White is wild, so it may found beside the player-1 medium.
        g.move("WS@0.1");
        const clone = g.clone();
        expect(clone.phase).to.equal(g.phase);
        expect(clone.currplayer).to.equal(g.currplayer);
        expect(clone.hands).to.deep.equal(g.hands);
        expect([...clone.yard.entries()]).to.deep.equal([...g.yard.entries()]);
        expect(clone.pool.length).to.equal(g.pool.length);
    });

    it("revives the whole stack, Maps included, from serialized JSON mid-build", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S"], ["3S"]], fatPool());
        g.palace = new Map([["0.0", ["2L"]]]);
        g.lead = 2;
        g.currplayer = 2;
        g.move("1S@0.0");
        g.move("pass");
        g.move("pass");
        g.move("pass");
        expect(g.phase).to.equal("build");
        const stockBefore = [...g.stock];
        const palaceBefore = [...g.palace.entries()].map(([cell, stack]) => [cell, [...stack]]);
        g.move("1S@0.0", { partial: true });
        const json = g.serialize();
        expect(json).to.be.a("string");
        const revived = new IcePalaceGame(json);
        expect(revived.phase).to.equal("build");
        expect(revived.buildMin).to.equal(g.buildMin);
        expect(revived.lead).to.equal(2);
        expect(revived.currplayer).to.equal(2);
        expect(revived.stock).to.deep.equal(stockBefore);
        expect(revived.palace).to.be.instanceOf(Map);
        expect([...revived.palace.entries()]).to.deep.equal(palaceBefore);
        expect(revived.yard).to.be.instanceOf(Map);
        expect(revived.stack.length).to.equal(g.stack.length);
        expect(revived.stack[revived.stack.length - 1]._results).to.deep.equal(g.stack[g.stack.length - 1]._results);
        // The partial placement was never committed, so it is not in the saved state.
        expect(revived.palace.get("0.0")).to.deep.equal(["2L"]);
    });

    /** A three-player hand won by player 1, who now builds two pyramids. */
    const readyToBuild = (): IcePalaceGame => {
        const g = rig(new IcePalaceGame(3), [["1L", "1M"], ["2L"], ["3L"]], fatPool());
        for (const m of ["1M@0.0", "pass", "pass", "1L@0.0", "pass", "pass", "pass"]) {
            g.move(m);
        }
        return g;
    };

    it("writes cells with a dot, so no move carries a comma", () => {
        // The front end reads commas in a move as separating simultaneous moves, which
        // made a two-pyramid build in a three-player game look like one move per seat.
        const g = readyToBuild();
        expect(g.phase).to.equal("build");
        const announce = g.results.find(r => r.type === "announce") as { payload: unknown[] };
        expect(announce.payload[2]).to.be.a("string").and.not.include(",");
        g.move("1L@0.0;1M@0.0");
        expect(g.moves().filter(m => m.includes(","))).to.be.empty;
        g.move(g.moves()[0]);
        expect(g.getPlies().filter(ply => ply.move.includes(","))).to.be.empty;
    });

    it("reads moves typed in the old comma notation", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        expect(g.validateMove("1M@0,0").valid).to.be.true;
        g.move("1M@0,0");
        expect(g.lastmove).to.equal("1M@0.0");
        expect(g.topOfCell("yard", "0.0")).to.equal("1M");
    });

    it("loads a game saved with comma cells as if it had been played with dots", () => {
        const g = readyToBuild();
        g.move("1L@0.0;1M@0.0");
        // The same game as the engine saved it before cells used a dot.
        const toComma = (text: string): string => text.replace(/(-?\d+)\.(-?\d+)/g, "$1,$2");
        const commaKeys = (struct: Structure): Structure =>
            new Map([...struct.entries()].map(([cell, stack]) => [toComma(cell), stack]));
        const saved = JSON.parse(g.serialize(), reviver) as IIcePalaceState;
        for (const entry of saved.stack) {
            entry.yard = commaKeys(entry.yard);
            entry.palace = commaKeys(entry.palace);
            if (entry.frames !== undefined) {
                entry.frames = entry.frames.map(frame => ({ ...frame, palace: commaKeys(frame.palace) }));
            }
            if (entry.lastmove !== undefined) {
                entry.lastmove = toComma(entry.lastmove);
            }
            for (const result of entry._results as unknown as Record<string, unknown>[]) {
                if (typeof result.where === "string") {
                    result.where = toComma(result.where);
                }
                if (Array.isArray(result.payload)) {
                    result.payload = result.payload.map(p => (typeof p === "string" ? toComma(p) : p));
                }
            }
        }
        const legacy = JSON.stringify(saved, replacer);
        expect(legacy).to.include("\"1L@0,0;1M@0,0\"");

        const loaded = new IcePalaceGame(legacy);
        expect(loaded.serialize()).to.equal(g.serialize());
        expect(loaded.validateMove(g.moves()[0]).valid).to.be.true;
    });
});

describe("Ice Palace: sequenced turn model and record export", () => {
    it("closes a round at the end of a hand, so the build is a row of its own", () => {
        const g = rig(new IcePalaceGame(3), [["1L", "1M"], ["2L"], ["3L"]], fatPool());
        // Alice opens and Charlie is the last to place; then everyone passes, and Charlie
        // builds; then Bob leads the next hand.
        for (const m of ["1M@0.0", "pass", "3L@0.0", "pass", "pass", "pass"]) {
            g.move(m);
        }
        expect(g.phase).to.equal("build");
        expect(g.currplayer).to.equal(3);
        expect(g.stock).to.deep.equal(["1M", "3L"]);
        g.move("3L@0.0;1M@0.0");
        expect(g.phase).to.equal("hand");
        g.move(g.moves()[0]);
        const plies = g.getPlies().map(p => [p.actor, p.round]);
        expect(plies).to.deep.equal([
            [1, 0], [2, 0], [3, 0],
            // The cycle of passes ends the hand, which closes the round before Charlie
            // acts again; the build is then a round of its own.
            [1, 1], [2, 1], [3, 1],
            [3, 2],
            [2, 3],
        ]);
    });


    const played = (): IcePalaceGame => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["2S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        g.move("pass");
        g.move("pass");
        g.move("pass");
        g.move("1M@0.0");
        return g;
    };

    it("refuses to commit an incomplete move", () => {
        const g = rig(new IcePalaceGame(3), [["1M", "1S"], ["2S"], ["3S"]], fatPool());
        expect(() => g.move("1M")).to.throw("FAILSAFE");
        g.move("1M@0.0");
        g.move("pass");
        g.move("pass");
        g.move("1S@1.0");
        g.move("pass");
        g.move("pass");
        g.move("pass");
        expect(g.phase).to.equal("build");
        expect(g.buildMin).to.equal(2);
        expect(() => g.move("1M@0.0;1S")).to.throw("FAILSAFE");
        expect(() => g.move("1M@0.0")).to.throw("FAILSAFE");
        g.move("1M@0.0;1S@0.0");
        expect(g.phase).to.equal("hand");
    });

    it("exports one sparse row per ply, with the hand winner acting twice in a row", () => {
        const g = played();
        expect(g.turnModel()).to.equal("sequenced");
        const plies = g.getPlies();
        expect(plies.map(p => p.actor)).to.deep.equal([1, 2, 3, 1, 1]);
        const rounds = g.getRounds();
        expect(rounds).to.have.length(5);
        for (const row of rounds) {
            expect(row).to.have.length(3);
            expect(row.filter(slot => slot !== null)).to.have.length(1);
        }
        expect(rounds[3][0]).to.not.be.null;
        expect(rounds[4][0]).to.not.be.null;
        expect(rounds[4][1]).to.be.null;
    });

    it("keeps the build announcement out of the published record", () => {
        const g = played();
        const record = (g as unknown as { getMoveList(): (string | { result?: { type: string }[] } | null)[][] }).getMoveList();
        const types = record.flat().flatMap(slot => slot !== null && typeof slot === "object" ? (slot.result ?? []).map(r => r.type) : []);
        expect(types).to.include("place");
        expect(types).to.not.include("announce");
        // The chat log still carries it.
        const keys = g.chatLogEntries(["A", "B", "C"]).flatMap(e => e.lines.map(l => l.textKey));
        expect(keys).to.include("apresults:icepalace.ANNOUNCE.build");
    });
});

const palaceOf = (stacks: Record<string, PieceId[]>): Structure => {
    const struct: Structure = new Map();
    for (const [cell, stack] of Object.entries(stacks)) {
        struct.set(cell, [...stack]);
    }
    return struct;
};

/** Replays a plan against the building code so a reported maximum is never taken on trust. */
const replay = (palace: Structure, pieces: PieceId[], plan: ReturnType<typeof maximumBuild>): void => {
    const struct: Structure = new Map();
    for (const [cell, stack] of palace.entries()) {
        struct.set(cell, [...stack]);
    }
    const pool = [...pieces];
    for (const { piece, cell } of plan.sequence) {
        const idx = pool.indexOf(piece);
        expect(idx, `plan used ${piece}, which was not in the Yard`).to.be.greaterThan(-1);
        pool.splice(idx, 1);
        expect(
            legalPalacePlacement(struct, piece, cell),
            `plan placed ${piece} illegally at ${cell}`,
        ).to.be.true;
        placeInto(struct, piece, cell);
    }
    expect(plan.sequence.length).to.equal(plan.max);
};

const check = (palace: Structure, pieces: PieceId[], expected: number): void => {
    const plan = maximumBuild(palace, pieces);
    replay(palace, pieces, plan);
    expect(plan.max).to.equal(expected);
};

describe("Ice Palace: maximum build", () => {
    it("places nothing when the Yard held only Black and White", () => {
        check(palaceOf({ "0.0": ["1L"] }), [], 0);
    });

    it("stacks a whole large-medium-small tower into an empty Palace", () => {
        check(new Map(), ["1L", "2M", "3S"], 3);
    });

    it("cannot place a second medium with no large left to cover", () => {
        // Seed the large, cover it with one medium, and the other medium is stranded:
        // nothing larger is left to stack onto and its colour tops nothing.
        check(new Map(), ["1L", "2M", "3M"], 2);
    });

    it("finds the ordering that beats a greedy build", () => {
        // Covering the large with the small first strands the medium. The medium has to
        // go down first so the small has a medium to sit on.
        check(palaceOf({ "0.0": ["1L"] }), ["2S", "3M"], 2);
    });

    it("spends the only large top on one colour and strands the other", () => {
        check(palaceOf({ "0.0": ["1L"] }), ["2M", "3M"], 1);
    });

    it("regrows a large top by founding, enabling a second colour", () => {
        // Colour 2 is enabled off the existing large, then its own large is founded as a
        // fresh large top, which colour 3's medium can then use.
        check(palaceOf({ "0.0": ["1L"] }), ["2M", "2L", "3M"], 3);
    });

    it("founds without limit once a colour is enabled", () => {
        const pieces: PieceId[] = [];
        for (let i = 0; i < 12; i++) {
            pieces.push("1S");
        }
        check(palaceOf({ "0.0": ["1L"] }), pieces, 12);
    });

    it("strands colours that are absent when every open top is small", () => {
        check(palaceOf({ "0.0": ["1L", "1M", "1S"] }), ["2S", "2M", "3L"], 0);
    });

    it("places a large only when its own colour is already on an open top", () => {
        check(palaceOf({ "0.0": ["1L", "1M", "1S"] }), ["1L", "1L"], 2);
    });

    it("chains large to medium to small across three new colours", () => {
        check(palaceOf({ "0.0": ["1L"] }), ["2M", "3S"], 2);
    });

    it("opens an empty Palace with a medium when that beats leading with the large", () => {
        // Seeding the large only reaches four. Seeding 2M, covering it with 1S to enable
        // colour 1, then founding 1L as a fresh large top, carries 3M and 4S as well.
        check(new Map(), ["1L", "1S", "2M", "3M", "4S"], 5);
    });

    it("uses every pyramid when each colour has something small enough", () => {
        check(palaceOf({ "0.0": ["1L"], "1.0": ["1L"] }), ["2M", "2S", "3M", "3S"], 4);
    });

    it("keeps the Palace connected and never buries a small", () => {
        const palace = palaceOf({ "0.0": ["1L"] });
        const pieces: PieceId[] = ["1M", "1S", "1L", "2M"];
        const plan = maximumBuild(palace, pieces);
        replay(palace, pieces, plan);
        expect(plan.max).to.equal(4);
    });

    it("does not mutate the Palace it was handed", () => {
        const palace = palaceOf({ "0.0": ["1L"] });
        maximumBuild(palace, ["2M", "2S"]);
        expect(palace.size).to.equal(1);
        expect(palace.get(cellOf(0, 0))).to.deep.equal(["1L"]);
    });
});

/** Exhaustive search over every legal build order, for cross-checking small positions. */
const bruteForce = (palace: Structure, pieces: PieceId[]): number => {
    const memo = new Map<string, number>();

    const key = (struct: Structure, remaining: PieceId[]): string => {
        const cells = [...struct.keys()].map(c => {
            const parts = c.split(",");
            return [Number(parts[0]), Number(parts[1])] as [number, number];
        });
        const minX = Math.min(...cells.map(c => c[0]));
        const minY = Math.min(...cells.map(c => c[1]));
        const board = [...struct.entries()]
            .map(([c, stack]) => {
                const parts = c.split(",");
                return `${Number(parts[0]) - minX},${Number(parts[1]) - minY}:${stack.join("")}`;
            })
            .sort()
            .join("|");
        return `${board}//${[...remaining].sort().join(",")}`;
    };

    const search = (struct: Structure, remaining: PieceId[]): number => {
        if (remaining.length === 0) {
            return 0;
        }
        const memoKey = key(struct, remaining);
        const cached = memo.get(memoKey);
        if (cached !== undefined) {
            return cached;
        }
        let best = 0;
        for (const piece of new Set(remaining)) {
            for (const cell of legalCellsFor(struct, piece, legalPalacePlacement)) {
                const next: Structure = new Map();
                for (const [c, stack] of struct.entries()) {
                    next.set(c, [...stack]);
                }
                placeInto(next, piece, cell);
                const rest = [...remaining];
                rest.splice(rest.indexOf(piece), 1);
                best = Math.max(best, 1 + search(next, rest));
                if (best === remaining.length) {
                    memo.set(memoKey, best);
                    return best;
                }
            }
        }
        memo.set(memoKey, best);
        return best;
    };

    return search(palace, pieces);
};

describe("Ice Palace: maximum build matches exhaustive search", () => {
    const palaces: Record<string, Structure> = {
        "a lone large": palaceOf({ "0.0": ["1L"] }),
        "a lone small": palaceOf({ "0.0": ["1S"] }),
        "a finished tower": palaceOf({ "0.0": ["1L", "2M", "3S"] }),
        "two adjacent larges": palaceOf({ "0.0": ["1L"], "1.0": ["2L"] }),
        "a large beside a covered medium": palaceOf({ "0.0": ["1L"], "0.1": ["2L", "3M"] }),
    };

    const yards: PieceId[][] = [
        ["1S"],
        ["4L"],
        ["2M", "3M"],
        ["2M", "3S"],
        ["1S", "1M"],
        ["2L", "2S"],
        ["3M", "3S", "4M"],
        ["1M", "2S", "3L"],
        ["2S", "2S", "3M"],
    ];

    for (const [name, palace] of Object.entries(palaces)) {
        for (const yard of yards) {
            it(`${name} + [${yard.join(" ")}]`, () => {
                const plan = maximumBuild(palace, yard);
                replay(palace, yard, plan);
                expect(plan.max, "solver must never claim more than is reachable").to.equal(
                    bruteForce(palace, yard),
                );
            });
        }
    }
});

describe("Ice Palace: move table presentation", () => {
    it("compact rows merge a full seat cycle; export stays sparse", () => {
        const g = rig(new IcePalaceGame(3), [["1M"], ["1S", "2S"], ["3S"]], fatPool());
        g.move("1M@0.0");
        g.move("1S@1.0");
        g.move("pass");
        const pathLength = g.stack.length - 1;
        expect(pathLength).to.equal(3);
        expect(g.getRounds()).to.have.length(pathLength);
        const compact = g.getMoveTableRounds({ density: "compact", pathLength });
        const sparse = g.getMoveTableRounds({ density: "sparse", pathLength });
        expect(sparse).to.have.length(pathLength);
        expect(compact).to.have.length(1);
    });
});
