/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import type { AreaTrack, Glyph } from "@abstractplay/renderer/build/schemas/schema";
import { addResource } from "../../src";
import { SnubSquareGraph } from "../../src/common";
import { ThueMorseGoGame } from "../../src/games/thuemorsego";
import { assertChatLogParity } from "../fixtures/chat/helpers";

before(() => { addResource("en"); });

const play = (g: ThueMorseGoGame, moves: string[]): ThueMorseGoGame => {
    for (const m of moves) {
        g.move(m);
    }
    return g;
};

/** A fresh game on the 11x11 board. */
const small = (variants: string[] = []): ThueMorseGoGame => new ThueMorseGoGame(undefined, ["size-11", ...variants]);

/** Put stones on the board, and into the initial position, without playing them. */
const setStones = (g: ThueMorseGoGame, colour1: string[], colour2: string[]): void => {
    const board = new Map<string, 1 | 2>();
    for (const cell of colour1) { board.set(cell, 1); }
    for (const cell of colour2) { board.set(cell, 2); }
    g.stack[0].board = new Map(board);
    g.board = new Map(board);
};

/** The sheet-glyph colours of a sidebar status value. */
const glyphColours = (value: unknown[]): unknown[] => value.map((v) => (v as { colour: unknown }).colour);

/** The two layers of a tracker legend entry. */
const layers = (g: ThueMorseGoGame, key: string, opts?: { altDisplays?: string[] }): [Glyph, Glyph] => {
    const legend = g.render(opts).legend as Record<string, [Glyph, Glyph]>;
    return legend[key];
};

/** A corner string with the two single-point eyes a1 and c1, and the wall that leaves it no other liberty. */
const twoEyedCorner = (): { own: string[]; wall: string[] } => ({
    own: ["a2", "b1", "b2", "c2", "d1", "d2"],
    wall: ["a3", "b3", "c3", "d3", "e1", "e2", "e3"],
});

// The tracker of the mockup: placement 0x123 is next, digits running upward.
const TRACK_0X123 = [
    "e-o-e", "o-e-o", "o-e-o", "e-o-e", "o-e-o", "e-o-e", "e-o-e", "o-e-o",
    "o-e-o", "e-o-e", "e-o-e", "o-e-o", "e-o-E", "o-E-o", "O-e-o", "e-o-e",
].join("\n");

describe("Thue-Morse Go: the sequence", () => {
    it("names the colour of each placement by the parity of its 1 bits", () => {
        const g = small();
        const digits = [];
        for (let n = 0; n < 16; n++) {
            digits.push(g.digitAt(n));
        }
        expect(digits).to.deep.equal([0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0]);
    });

    it("makes every move one or two placements", () => {
        const g = small();
        const starts = [0, 1, 3, 4, 5, 7, 9, 11, 12, 13, 15, 16, 17];
        expect(starts.map((n) => g.moveLength(n))).to.deep.equal([1, 2, 1, 1, 2, 2, 2, 1, 1, 2, 1, 1, 2]);
        for (let n = 0; n < 4096; n++) {
            expect(g.moveLength(n)).to.be.at.most(2);
        }
    });

    it("repeats ABBA under Balanced Marseillais", () => {
        const g = small(["marseillais"]);
        const digits = [];
        for (let n = 0; n < 8; n++) {
            digits.push(g.digitAt(n));
        }
        expect(digits).to.deep.equal([0, 1, 1, 0, 0, 1, 1, 0]);
        expect([0, 1, 3, 5, 7].map((n) => g.moveLength(n))).to.deep.equal([1, 2, 2, 2, 2]);
    });

    it("alternates the seats move by move", () => {
        const g = play(small(), ["f6", "e5,g7", "f5", "d4", "c3,c4", "h8,h9"]);
        expect(g.stack.map((s) => s.currplayer)).to.deep.equal([1, 2, 1, 2, 1, 2, 1]);
        expect(g.placed).to.equal(9);
        expect(g.stack.map((s) => s.placed)).to.deep.equal([0, 1, 3, 4, 5, 7, 9]);
    });
});

describe("Thue-Morse Go: moves", () => {
    it("takes one placement, then two", () => {
        const g = small();
        expect(g.validateMove("f6").complete).to.equal(1);
        g.move("f6");
        expect(g.currplayer).to.equal(2);
        expect(g.placed).to.equal(1);
        expect(g.validateMove("e5").complete).to.equal(0);
        expect(g.validateMove("e5,g7").complete).to.equal(1);
        expect(g.validateMove("e5,g7,h8").valid).to.be.false;
        expect(g.validateMove("e5,e5").valid).to.be.false;
        expect(g.validateMove("e5,f6").valid).to.be.false;
        g.move("e5,g7");
        expect(g.board.get("e5")).to.equal(2);
        expect(g.board.get("g7")).to.equal(2);
        expect(g.placed).to.equal(3);
        expect(g.currplayer).to.equal(1);
        expect(g.lastmove).to.equal("e5,g7");
    });

    it("passes the placements a short move leaves out", () => {
        const g = play(small(), ["f6", "e5"]);
        expect(g.lastmove).to.equal("e5,pass");
        expect(g.results.map((r) => r.type)).to.deep.equal(["place", "pass"]);
        expect(g.placed).to.equal(3);
        expect(g.currplayer).to.equal(1);
        const h = play(small(), ["f6", "pass"]);
        expect(h.lastmove).to.equal("pass,pass");
        expect(h.gameover).to.be.false;
    });

    it("builds a move from clicks", () => {
        const g = play(small(), ["f6"]);
        const [ex, ey] = g.algebraic2coords("e5");
        const [gx, gy] = g.algebraic2coords("g7");
        let click = g.handleClick("", ey, ex);
        expect(click.move).to.equal("e5");
        expect(click.complete).to.equal(0);
        click = g.handleClick("e5", gy, gx);
        expect(click.move).to.equal("e5,g7");
        expect(click.complete).to.equal(1);
        // Clicking the last placement again takes it back; an occupied cell is refused.
        expect(g.handleClick("e5,g7", gy, gx).move).to.equal("e5");
        const [fx, fy] = g.algebraic2coords("f6");
        const refused = g.handleClick("e5", fy, fx);
        expect(refused.valid).to.be.false;
        expect(refused.move).to.equal("e5");
    });

    it("offers a button that passes the whole move, and one that takes the button while it lasts", () => {
        const g = small();
        expect(g.getButtons().map((b) => b.move)).to.deep.equal(["pass", "button"]);
        g.move("button");
        expect(g.getButtons().map((b) => b.move)).to.deep.equal(["pass,pass"]);
        expect(g.validateMove("pass,pass").complete).to.equal(1);
        expect(small(["no-button"]).getButtons().map((b) => b.move)).to.deep.equal(["pass"]);
        // With one placement served by the handicap, only the other is passed.
        const h = play(small(["handicap"]), ["f6", "4", "e5", "d4,d5"]);
        expect(h.getButtons().map((b) => b.move)).to.deep.equal(["pass", "button"]);
    });

    it("takes the button and then places a stone by clicking", () => {
        const g = play(small(), ["f6"]);
        expect(g.validateMove("button").complete).to.equal(0);
        const [x, y] = g.algebraic2coords("e5");
        const click = g.handleClick("button", y, x);
        expect(click.move).to.equal("button,e5");
        expect(click.complete).to.equal(1);
        g.move(click.move);
        expect(g.button).to.equal(2);
        expect(g.board.get("e5")).to.equal(2);
        expect(g.placed).to.equal(3);
        // Taking the button is not a pass: the following whole-move passes end the game on the board as it is.
        play(g, ["pass", "pass"]);
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([2]);
        expect([g.getPlayerScore(1), g.getPlayerScore(2)]).to.deep.equal([1, 2]);
    });

    it("captures stones", () => {
        const g = small();
        setStones(g, ["a2"], ["a1"]);
        g.move("b1");
        expect(g.board.has("a1")).to.be.false;
        expect(g.results.filter((r) => r.type === "capture").map((r) => r.count)).to.deep.equal([1]);
        // Two stones, the point they enclose, and the rest of the empty board; the capture itself does not score.
        expect(g.getPlayerScore(1)).to.equal(121);
        expect(g.getPlayerScore(2)).to.equal(0);
        expect(g.sidebarScores().map((table) => table.scores)).to.deep.equal([[121, 0]]);
    });

    it("allows multi-stone suicide but not the single stone that repeats the position", () => {
        const g = small();
        setStones(g, ["a1"], ["a2", "b2", "c1", "k11"]);
        expect(g.validateMove("b1").valid).to.be.true;
        g.move("b1");
        expect(g.board.has("a1")).to.be.false;
        expect(g.board.has("b1")).to.be.false;
        const suicide = g.results.find((r) => r.type === "capture")!;
        expect(suicide.how).to.equal("suicide");
        expect(suicide.count).to.equal(2);

        const h = small();
        setStones(h, [], ["a2", "b1", "k11"]);
        const result = h.validateMove("a1");
        expect(result.valid).to.be.false;
        expect(result.message).to.contain("earlier position");
    });

    it("can empty a cell and refill it within one move", () => {
        // Player 2's two placements: the first captures a1, the second plays there.
        const g = small();
        setStones(g, ["a1"], ["a2"]);
        g.move("k11");
        expect(g.validateMove("b1,a1").complete).to.equal(1);
        g.move("b1,a1");
        expect(g.board.get("a1")).to.equal(2);
        expect(g.board.has("b1")).to.be.true;
    });

    it("lets a two-placement move fill both eyes under checked weak eyes", () => {
        const { own, wall } = twoEyedCorner();
        const plain = small();
        setStones(plain, wall, own);
        plain.placed = 5; // Player 1's two-placement move
        expect(plain.validateMove("a1").valid).to.be.false;
        expect(plain.validateMove("a1,c1").valid).to.be.false;

        const checked = small(["weak-eyes"]);
        setStones(checked, wall, own);
        checked.placed = 5;
        const first = checked.validateMove("a1");
        expect(first.valid).to.be.true;
        expect(first.complete).to.equal(-1);
        expect(checked.validateMove("a1,c1").complete).to.equal(1);
        checked.move("a1,c1");
        expect(checked.results.filter((r) => r.type === "capture").map((r) => r.count)).to.deep.equal([6]);
        for (const cell of own) {
            expect(checked.board.has(cell)).to.be.false;
        }
        expect(checked.board.get("a1")).to.equal(1);
        expect(checked.board.get("c1")).to.equal(1);
    });

    it("hands out the button once", () => {
        const g = small();
        g.move("button");
        expect(g.button).to.equal(1);
        expect(g.placed).to.equal(1);
        expect(g.getPlayerScore(1)).to.equal(1);
        expect(g.validateMove("button").valid).to.be.false;
        expect(g.validateMove("e5,button").valid).to.be.false;
        expect(g.validateMove("e5,pass").complete).to.equal(1);
        expect(small(["half-button"]).move("button").getPlayerScore(1)).to.equal(0.5);
        expect(small(["no-button"]).validateMove("button").valid).to.be.false;
    });

    it("ends when both players pass their whole moves in turn", () => {
        const g = play(small(), ["pass", "pass,pass"]);
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1, 2]);
        expect(g.results.find((r) => r.type === "eog")!.reason).to.equal("consecutive-passes");
        // A move that passes only one of its placements does not count.
        const partial = play(small(), ["f6", "pass,e5", "pass"]);
        expect(partial.gameover).to.be.false;
        partial.move("pass");
        expect(partial.gameover).to.be.true;

        const h = play(small(), ["button", "pass,pass"]);
        expect(h.gameover).to.be.false;
        h.move("pass");
        expect(h.gameover).to.be.true;
        expect(h.winner).to.deep.equal([1]);
    });

    it("lists complete legal moves and plays random ones", () => {
        const g = small();
        expect(g.moves()).to.have.lengthOf(123);
        g.move("f6");
        const moves = g.moves();
        expect(moves).to.include("e5,g7");
        expect(moves).to.include("pass,pass");
        expect(moves).to.include("button,e5");
        expect(moves).to.not.include("f6,e5");
        for (let i = 0; i < 6; i++) {
            g.move(g.randomMove());
        }
        expect(g.gameover).to.be.false;
        expect(g.stack).to.have.lengthOf(8);
    });

    it("applies partial moves without saving them", () => {
        const g = play(small(), ["f6"]);
        g.move("e5", { partial: true });
        expect(g.board.get("e5")).to.equal(2);
        expect(g.placed).to.equal(2);
        expect(g.stack).to.have.lengthOf(2);
        expect(g.render().areas).to.have.lengthOf(1);
    });

    it("survives a round trip through serialization", () => {
        const g = play(small(), ["f6", "e5,g7", "button"]);
        const h = new ThueMorseGoGame(g.serialize());
        expect(h.placed).to.equal(4);
        expect(h.button).to.equal(1);
        expect(h.validateMove("d4").complete).to.equal(1);
    });
});

describe("Thue-Morse Go: handicap", () => {
    it("serves the declared passes, the declaration first", () => {
        const g = small(["handicap"]);
        g.move("f6");
        expect(g.validateMove("e5").valid).to.be.false;
        expect(g.getButtons()).to.deep.equal([]);
        expect(g.validateMove("3").complete).to.equal(0);
        expect(g.validateMove("3,e5").valid).to.be.false;
        g.move("3");
        expect(g.handicap).to.equal(3);
        expect(g.passesOwed).to.equal(1);
        expect(g.placed).to.equal(3);
        expect(g.currplayer).to.equal(1);
        expect(g.lastmove).to.equal("3");
        expect(g.results.map((r) => r.type)).to.deep.equal(["declare", "pass"]);
        // Player 2's next move is a single placement, so it is served automatically.
        g.move("e5");
        expect(g.stack).to.have.lengthOf(5);
        expect(g.currplayer).to.equal(1);
        expect(g.placed).to.equal(5);
        expect(g.passesOwed).to.equal(0);
        const served = g.stack[4];
        expect(served.lastmove).to.equal("pass");
        expect(served.currplayer).to.equal(1);
        expect(served._results).to.deep.equal([{ type: "pass", why: "handicap" }]);
    });

    it("lets a handicap of one place the second stone of the move", () => {
        const g = play(small(["handicap"]), ["f6"]);
        expect(g.validateMove("1").complete).to.equal(0);
        expect(g.validateMove("1,e5").complete).to.equal(1);
        g.move("1,e5");
        expect(g.board.get("e5")).to.equal(2);
        expect(g.passesOwed).to.equal(0);
        expect(g.placed).to.equal(3);
        expect(play(small(["handicap"]), ["f6", "1"]).lastmove).to.equal("1,pass");
    });

    it("can run out partway through a two-placement move", () => {
        const g = play(small(["handicap"]), ["f6", "4", "e5"]);
        expect(g.passesOwed).to.equal(1);
        expect(g.currplayer).to.equal(1);
        g.move("d4,d5");
        expect(g.placed).to.equal(7);
        expect(g.currplayer).to.equal(2);
        expect(g.validateMove("c3,d3").valid).to.be.false;
        expect(g.validateMove("c3").complete).to.equal(1);
        g.move("c3");
        expect(g.lastmove).to.equal("c3");
        expect(g.placed).to.equal(9);
        expect(g.passesOwed).to.equal(0);
        expect(g.results.map((r) => r.type)).to.deep.equal(["pass", "place"]);
    });

    it("keeps marking the last placement across an automatically served move", () => {
        const g = play(small(["handicap"]), ["f6", "4", "e5"]);
        expect(g.results).to.deep.equal([{ type: "pass", why: "handicap" }]);
        const [x, y] = g.algebraic2coords("e5");
        expect(g.render().annotations).to.deep.include({ type: "enter", targets: [{ row: y, col: x }] });
    });

    it("does not count served passes towards the end of the game", () => {
        const g = play(small(["handicap"]), ["f6", "4", "pass", "pass,pass"]);
        expect(g.gameover).to.be.false;
        expect(g.currplayer).to.equal(2);
        g.move("pass");
        expect(g.gameover).to.be.true;
    });

    it("offers numbered stones that skip occupied cells", () => {
        const g = play(small(["handicap"]), ["c7"]);
        const pieces = g.render().pieces as string;
        expect(pieces).to.contain("n1");
        expect(pieces).to.not.contain("n3,");
        const [bx, by] = g.algebraic2coords("b7");
        expect(g.handleClick("", by, bx).move).to.equal("1");
        const [ex, ey] = g.algebraic2coords("e5");
        expect(g.handleClick("1", ey, ex).move).to.equal("1,e5");
        // e9 is on neither row of numbered stones.
        const [fx, fy] = g.algebraic2coords("e9");
        expect(g.handleClick("", fy, fx).valid).to.be.false;
    });
});

describe("Thue-Morse Go: ko", () => {
    it("forbids retaking a ko at once but allows it after a threat", () => {
        const g = small();
        setStones(g, ["a2", "b1", "b3"], ["b2", "c1", "c3", "d2"]);
        g.move("c2");
        expect(g.board.has("b2")).to.be.false;
        expect(g.validateMove("b2").valid).to.be.false;
        expect(g.validateMove("k11,b2").complete).to.equal(1);
        g.move("k11,b2");
        expect(g.board.has("c2")).to.be.false;
    });

    it("draws the game on the fifth repetition under the repetition variant", () => {
        const g = small(["repetition"]);
        setStones(g, [], ["a2", "b1", "k11"]);
        expect(g.validateMove("a1").valid).to.be.true;
        play(g, ["a1", "pass,pass", "a1", "pass"]);
        expect(g.gameover).to.be.false;
        g.move("a1,a1");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1, 2]);
        expect(g.results.find((r) => r.type === "eog")!.reason).to.equal("repetition");
    });
});

describe("Thue-Morse Go: Kill-All", () => {
    it("requires no button and swaps the flags", () => {
        const g = new ThueMorseGoGame(undefined, ["size-11", "kill-all"]);
        expect(g.variants).to.include("kill-all");
        expect(g.variants).to.include("no-button");
        // An explicit other button choice is overridden by the one Kill-All implies.
        const h = play(new ThueMorseGoGame(undefined, ["size-11", "kill-all", "half-button"]), ["f6", "attacker"]);
        expect(h.variants).to.include("no-button");
        expect(h.validateMove("button").valid).to.be.false;
        expect(g.getFlags()).to.include("custom-colours");
        expect(g.getFlags()).to.not.include("scores");
        expect(small().getFlags()).to.include("scores");
    });

    it("decides the sides by pieboxing", () => {
        const g = small(["kill-all"]);
        expect(g.phase).to.equal("alt-place");
        g.move("f6");
        expect(g.board.get("f6")).to.equal(2);
        expect(g.currplayer).to.equal(2);
        g.move("attacker");
        expect(g.defenderSeat).to.equal(1);
        expect(g.phase).to.equal("play");
        expect(g.currplayer).to.equal(1);
        expect(g.placed).to.equal(0);
        expect(g.getPlayerColour(1)).to.equal(1);
        expect(g.getPlayerColour(2)).to.equal(2);
        g.move("e5");
        expect(g.board.get("e5")).to.equal(1);
        expect(g.validateMove("pass").valid).to.be.false;
        expect(g.validateMove("button").valid).to.be.false;
        expect(g.validateMove("e4").complete).to.equal(-1);
        g.move("e4,e6");
        expect(g.board.get("e4")).to.equal(2);
        expect(g.sidebarScores()).to.deep.equal([]);
    });

    it("ends when the Defender is unconditionally alive", () => {
        const { own, wall } = twoEyedCorner();
        const g = play(small(["kill-all"]), ["f6", "attacker"]);
        setStones(g, own, [...wall, "f6"]);
        g.move("k11");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
        expect(g.results.find((r) => r.type === "eog")!.reason).to.equal("pass-alive");
    });

    it("needs three eyes under checked weak eyes", () => {
        const { own, wall } = twoEyedCorner();
        const g = play(small(["kill-all", "weak-eyes"]), ["f6", "attacker"]);
        setStones(g, own, [...wall, "f6"]);
        g.move("k11");
        expect(g.gameover).to.be.false;

        const h = play(small(["kill-all", "weak-eyes"]), ["f6", "attacker"]);
        setStones(h, [...own, "e2", "f1", "f2"], ["a3", "b3", "c3", "d3", "e3", "f3", "g1", "g2", "g3", "f6"]);
        h.move("k11");
        expect(h.gameover).to.be.true;
        expect(h.winner).to.deep.equal([1]);
    });

    it("places the handicap stones when Player 2 takes the Attacker side", () => {
        const g = small(["kill-all", "handicap"]);
        expect(g.phase).to.equal("hand-n");
        expect(g.validateMove("3").complete).to.equal(0);
        g.move("3");
        expect(g.phase).to.equal("alt-place");
        expect(g.currplayer).to.equal(2);
        expect(g.validateMove("attacker").complete).to.equal(-1);
        expect(() => g.move("attacker")).to.throw();
        g.move("attacker:a1,b1,c1");
        expect(g.defenderSeat).to.equal(1);
        expect(g.board.get("c1")).to.equal(2);
        expect(g.phase).to.equal("play");
        expect(g.currplayer).to.equal(1);
    });

    it("can swap the colours on the board", () => {
        const g = play(small(["kill-all"]), ["f6", "attacker"]);
        expect((layers(g, "A")[0] as { paint: { fill: number } }).paint.fill).to.equal(1);
        expect((layers(g, "A", { altDisplays: ["swap-colours"] })[0] as { paint: { fill: number } }).paint.fill).to.equal(2);
        expect((layers(small(), "A", { altDisplays: ["swap-colours"] })[0] as { paint: { fill: number } }).paint.fill).to.equal(1);
    });
});

describe("Thue-Morse Go: tracker and sidebar", () => {
    it("draws the tracker of the mockup for placement 0x123", () => {
        const g = small();
        g.placed = 0x123;
        const track = g.render().areas![0] as AreaTrack;
        expect(track.type).to.equal("track");
        expect(track.position).to.equal("left");
        expect(track.board.width).to.equal(5);
        expect(track.board.height).to.equal(16);
        expect(track.board.blocked).to.have.lengthOf(32);
        expect(track.pieces).to.equal(TRACK_0X123);
        const [tint, marker] = layers(g, "E");
        expect(tint).to.deep.equal({ name: "piece-square", paint: { fill: 1 }, opacity: 0.2 });
        expect(marker).to.deep.equal({ name: "piece", paint: { fill: 1 } });
        const [, smallGlyph] = layers(g, "o");
        expect(smallGlyph).to.deep.equal({ name: "piece", paint: { fill: 2 }, scale: 0.57735 });
    });

    it("tints the tracker with the colour of the next placement", () => {
        const g = play(small(), ["f6"]);
        expect(layers(g, "e")[0]).to.deep.equal({ name: "piece-square", paint: { fill: 2 }, opacity: 0.2 });
    });

    it("can run the digits downward and grows with the index", () => {
        const g = small();
        g.placed = 0x123;
        const track = g.render({ altDisplays: ["digits-down"] }).areas![0] as AreaTrack;
        expect(track.pieces).to.equal(TRACK_0X123.split("\n").reverse().join("\n"));
        g.placed = 0x1000;
        expect((g.render().areas![0] as AreaTrack).board.width).to.equal(7);
    });

    it("reports the next placement and the colours to come", () => {
        const g = small();
        let statuses = g.sidebarStatuses();
        expect(statuses[0].value).to.deep.equal(["0x0"]);
        expect(glyphColours(statuses[1].value)).to.deep.equal([1, 2, 2, 1, 2, 1, 1, 2]);
        play(g, ["f6", "e5,g7"]);
        statuses = g.sidebarStatuses();
        expect(statuses[0].value).to.deep.equal(["0x3"]);
        expect(glyphColours(statuses[1].value)).to.deep.equal([1, 2, 1, 1, 2, 2, 1, 1]);
    });

    it("uses the snub square board and its connections", () => {
        const g = small(["snub"]);
        expect(g.render().board).to.deep.include({ style: "snubsquare" });
        const neighbours = new SnubSquareGraph(11, 11).neighbours("f6");
        expect(neighbours).to.have.lengthOf(5);
        setStones(g, neighbours.slice(0, -1), ["f6"]);
        g.move(neighbours[neighbours.length - 1]);
        expect(g.board.has("f6")).to.be.false;
        expect(g.results.some((r) => r.type === "capture" && r.count === 1)).to.be.true;
    });
});

describe("Thue-Morse Go: chat log", () => {
    it("matches the legacy chat log", () => {
        const g = small(["handicap"]);
        setStones(g, ["a2"], ["a1"]);
        play(g, ["b1", "2", "button", "pass", "pass,pass"]);
        expect(g.gameover).to.be.true;
        assertChatLogParity(g, ["Alice", "Bob"]);
        const log = g.chatLog(["Alice", "Bob"]).flat().join("\n");
        expect(log).to.contain("Alice placed a piece at b1.");
        expect(log).to.contain("Bob set the handicap to 2 passes.");
        expect(log).to.contain("Bob served a handicap pass.");
        expect(log).to.contain("Alice took the button.");
    });
});
