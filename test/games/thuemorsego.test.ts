/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import type { AreaTrack, BoardBasic, Glyph, MarkerDots, MarkerLine } from "@abstractplay/renderer/build/schemas/schema";
import { addResource } from "../../src";
import { SnubSquareGraph } from "../../src/common";
import { ThueMorseGoGame } from "../../src/games/thuemorsego";
import type { IClickResult } from "../../src/games/_base";
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

/** A fresh game on the default 16x16 board, whose handicap limit is 6. */
const sixteen = (variants: string[] = []): ThueMorseGoGame => new ThueMorseGoGame(undefined, variants);

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

/** The layers of a tracker legend entry. */
const layers = (g: ThueMorseGoGame, key: string, opts?: { altDisplays?: string[] }): Glyph[] => {
    const legend = g.render(opts).legend as Record<string, Glyph[]>;
    return legend[key];
};

/** A corner string with the two single-point eyes a1 and c1, and the wall that leaves it no other liberty. */
const twoEyedCorner = (): { own: string[]; wall: string[] } => ({
    own: ["a2", "b1", "b2", "c2", "d1", "d2"],
    wall: ["a3", "b3", "c3", "d3", "e1", "e2", "e3"],
});

// The tracker of the mockup: placement 0x123 is next, digits running upward. The mockup's keys
// e/o (small) and E/O (markers) are s1/s2 and m1d*/m2d* here, the markers carrying their digit;
// a blank column separates the digit columns and a blank frame surrounds them.
const TRACK_ROWS_0X123 = [
    "e-o-e", "o-e-o", "o-e-o", "e-o-e", "o-e-o", "e-o-e", "e-o-e", "o-e-o",
    "o-e-o", "e-o-e", "e-o-e", "o-e-o", "e-o-E", "o-E-o", "O-e-o", "e-o-e",
];
const BLANK_TRACK_ROW = Array<string>(7).fill("-").join(",");
const TRACK_0X123 = [
    BLANK_TRACK_ROW,
    ...TRACK_ROWS_0X123.map((row, r) => {
        const digit = (15 - r).toString(16);
        const keys = row.split("").map((c) => ({ e: "s1", o: "s2", E: `m1d${digit}`, O: `m2d${digit}` }[c] ?? c));
        return ["-", ...keys, "-"].join(",");
    }),
    BLANK_TRACK_ROW,
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

    it("ignores clicks on the tracker's glyphs", () => {
        const g = play(small(), ["f6"]);
        for (const [piece, move] of [["s1", ""], ["s2", "e5"], ["m2d1", "e5"], ["m1da", "pass,pass"]]) {
            const result = g.handleClick(move, 3, 1, piece);
            expect(result.valid).to.be.true;
            expect(result.move).to.equal(move);
            expect(result.complete).to.equal(g.validateMove(move).complete);
        }
        // A click on the board itself still places a stone there.
        const [x, y] = g.algebraic2coords("b8");
        expect(g.handleClick("", y, x, "").move).to.equal("b8");
    });

    it("treats button clicks as whole-move passes or the button's move", () => {
        const g = play(small(["button"]), ["f6"]);
        // Passing replaces a placement already made in the move.
        const pass = g.handleClick("e5", -1, -1, "_btn_pass");
        expect(pass.move).to.equal("pass,pass");
        // A whole-move pass stays open so that strings can be marked dead.
        expect(pass.complete).to.equal(0);
        expect(small().handleClick("", -1, -1, "_btn_pass").move).to.equal("pass");
        const button = g.handleClick("e5", -1, -1, "_btn_button");
        expect(button.move).to.equal("button");
        expect(button.complete).to.equal(0);
        const unknown = g.handleClick("e5", -1, -1, "stash");
        expect(unknown.valid).to.be.false;
        expect(unknown.move).to.equal("e5");
        // Kill-All games cannot pass, so the click is refused and the move kept.
        const k = play(small(["kill-all"]), ["f6", "attacker"]);
        const refused = k.handleClick("e5", -1, -1, "_btn_pass");
        expect(refused.valid).to.be.false;
        expect(refused.move).to.equal("e5");
    });

    it("offers a button that passes the whole move, and one that takes the button while it lasts", () => {
        const g = small(["button"]);
        expect(g.getButtons().map((b) => b.move)).to.deep.equal(["pass", "button"]);
        g.move("button");
        expect(g.getButtons().map((b) => b.move)).to.deep.equal(["pass,pass"]);
        expect(g.validateMove("pass,pass").complete).to.equal(0);
        // There is no button by default.
        expect(small().getButtons().map((b) => b.move)).to.deep.equal(["pass"]);
        // With one placement given away by the handicap, only the other is passed.
        const h = play(sixteen(["handicap", "button"]), ["h8", "4", "g7", "f6,f7"]);
        expect(h.getButtons().map((b) => b.move)).to.deep.equal(["pass", "button"]);
    });

    it("takes the button and then places a stone by clicking", () => {
        const g = play(small(["button"]), ["f6"]);
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
        const g = small(["superko"]);
        setStones(g, ["a1"], ["a2", "b2", "c1", "k11"]);
        expect(g.validateMove("b1").valid).to.be.true;
        g.move("b1");
        expect(g.board.has("a1")).to.be.false;
        expect(g.board.has("b1")).to.be.false;
        const suicide = g.results.find((r) => r.type === "capture")!;
        expect(suicide.how).to.equal("suicide");
        expect(suicide.count).to.equal(2);

        const h = small(["superko"]);
        setStones(h, [], ["a2", "b1", "k11"]);
        const result = h.validateMove("a1");
        expect(result.valid).to.be.false;
        expect(result.message).to.contain("suicide");
    });

    it("judges a suicidal first placement at once, or at the end of the move under checked weak eyes", () => {
        // Player 2's two placements: a1 has no liberties and captures nothing.
        const g = play(small(["superko"]), ["k11"]);
        setStones(g, ["a2", "b1", "k11"], []);
        const first = g.validateMove("a1");
        expect(first.valid).to.be.false;
        expect(first.message).to.contain("suicide");
        expect(g.validateMove("a1,k10").valid).to.be.false;
        // With checked weak eyes nothing is cleared until the move ends, so the second stone decides.
        const h = play(small(["superko", "weak-eyes"]), ["k11"]);
        setStones(h, ["a2", "b1", "k11"], []);
        const deferred = h.validateMove("a1");
        expect(deferred.valid).to.be.true;
        expect(deferred.complete).to.equal(-1);
        expect(deferred.message).to.contain("suicide");
        expect(h.validateMove("a1,pass").valid).to.be.false;
        expect(h.validateMove("a1,k10").complete).to.equal(1);
        h.move("a1,k10");
        expect(h.board.has("a1")).to.be.false;
        expect(h.board.get("k10")).to.equal(2);
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
        const plain = small(["superko"]);
        setStones(plain, wall, own);
        plain.placed = 5; // Player 1's two-placement move
        // Each eye filled is suicide at once and recreates the position.
        expect(plain.validateMove("a1").valid).to.be.false;
        expect(plain.validateMove("a1,c1").valid).to.be.false;

        const checked = small(["superko", "weak-eyes"]);
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
        const g = small(["button"]);
        g.move("button");
        expect(g.button).to.equal(1);
        expect(g.placed).to.equal(1);
        expect(g.getPlayerScore(1)).to.equal(1);
        expect(g.validateMove("button").valid).to.be.false;
        expect(g.validateMove("e5,button").valid).to.be.false;
        expect(g.validateMove("e5,pass").complete).to.equal(1);
        expect(small(["half-button"]).move("button").getPlayerScore(1)).to.equal(0.5);
        expect(small().validateMove("button").valid).to.be.false;
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

        const h = play(small(["button"]), ["button", "pass,pass"]);
        expect(h.gameover).to.be.false;
        h.move("pass");
        expect(h.gameover).to.be.true;
        expect(h.winner).to.deep.equal([1]);
    });

    it("lists complete legal moves and plays random ones", () => {
        const g = small(["button"]);
        expect(g.moves()).to.have.lengthOf(123);
        expect(small().moves()).to.have.lengthOf(122);
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
        const g = play(small(["button"]), ["f6", "e5,g7", "button"]);
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
        const g = play(sixteen(["handicap"]), ["f6", "4", "e5"]);
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
        const g = play(small(["handicap"]), ["f6", "3", "e5"]);
        expect(g.results).to.deep.equal([{ type: "pass", why: "handicap" }]);
        const [x, y] = g.algebraic2coords("e5");
        expect(g.render().annotations).to.deep.include({ type: "enter", targets: [{ row: y, col: x }] });
    });

    it("does not count served passes towards the end of the game", () => {
        const g = play(small(["handicap"]), ["f6", "3", "pass", "pass,pass"]);
        expect(g.gameover).to.be.false;
        expect(g.currplayer).to.equal(2);
        g.move("pass");
        expect(g.gameover).to.be.true;
    });

    it("offers a fortieth of the board's points across the centre row, covered cells still answering to clicks", () => {
        const g = play(small(["handicap"]), ["f6"]);
        const pieces = g.render().pieces as string;
        expect(pieces).to.contain("n1,").and.to.contain("n3,");
        expect(pieces).to.not.contain("n4");
        // Player 1's stone at f6 covers the stone for 2, which shows as the stone but still means 2.
        expect(pieces).to.not.contain("n2,");
        const click = (move: string, cell: string): IClickResult => {
            const [x, y] = g.algebraic2coords(cell);
            return g.handleClick(move, y, x);
        };
        expect(click("", "e6").move).to.equal("1");
        expect(click("", "f6").move).to.equal("2");
        expect(click("", "g6").move).to.equal("3");
        expect(click("3", "e6").move).to.equal("1");
        expect(click("1", "e5").move).to.equal("1,e5");
        expect(g.validateMove("4").valid).to.be.false;
        // Off the numbered stones the click explains itself; with no placement left it does too.
        const early = click("", "e9");
        expect(early.valid).to.be.false;
        expect(early.message).to.contain("Choose the handicap first");
        expect(click("3", "e9").message).to.contain("no placement left");
        // Larger boards offer more, rounded away from nine: 6, 10 and 14.
        expect(sixteen(["handicap"]).move("h8").validateMove("6").valid).to.be.true;
        expect(sixteen(["handicap"]).move("h8").validateMove("7").valid).to.be.false;
        expect(new ThueMorseGoGame(undefined, ["size-19", "handicap"]).move("k10").validateMove("10").valid).to.be.true;
        expect(new ThueMorseGoGame(undefined, ["size-23", "handicap"]).move("l12").validateMove("14").valid).to.be.true;
        expect(new ThueMorseGoGame(undefined, ["size-23", "handicap"]).move("l12").validateMove("15").valid).to.be.false;
        // Kill-All doubles the limit, odd values in a row above the centre and even ones below.
        const k = small(["kill-all", "handicap"]);
        const kp = k.render().pieces as string;
        expect(kp).to.contain("n5,").and.to.contain("n6,").and.to.not.contain("n7");
        const [ox, oy] = k.algebraic2coords("e7");
        expect(k.handleClick("", oy, ox).move).to.equal("1");
        const [ex, ey] = k.algebraic2coords("e5");
        expect(k.handleClick("", ey, ex).move).to.equal("2");
        expect(k.validateMove("6").valid).to.be.true;
        expect(k.validateMove("7").valid).to.be.false;
    });
});

describe("Thue-Morse Go: ko", () => {
    it("forbids retaking a ko at once but allows it after a threat", () => {
        const g = small(["superko"]);
        setStones(g, ["a2", "b1", "b3"], ["b2", "c1", "c3", "d2"]);
        g.move("c2");
        expect(g.board.has("b2")).to.be.false;
        // Every placement is judged as it is made, so the retake has to follow the threat.
        const retake = g.validateMove("b2");
        expect(retake.valid).to.be.false;
        expect(retake.message).to.contain("earlier position");
        expect(retake.message).to.not.contain("suicide");
        expect(g.validateMove("b2,k11").valid).to.be.false;
        expect(g.validateMove("k11,b2").complete).to.equal(1);
        g.move("k11,b2");
        expect(g.board.has("c2")).to.be.false;
    });

    it("draws the game on the fifth repetition by default", () => {
        const g = small();
        // The repetition draw is the group's sentinel, so a game with no variant named has it; superko is the variant.
        expect(g.allvariants()!.find((v) => v.uid === "superko")!.group).to.equal("repetition");
        expect(g.allvariants()!.find((v) => v.uid === "#repetition")!.default).to.be.undefined;
        setStones(g, [], ["a2", "b1", "k11"]);
        expect(g.validateMove("a1").valid).to.be.true;
        // Every placement counts, so the second stone of one move can be the fifth occurrence.
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
        expect(g.variants).to.deep.equal(["size-11", "kill-all"]);
        play(g, ["f6", "attacker"]);
        expect(g.validateMove("button").valid).to.be.false;
        // Kill-All needs the default button choice, so it is dropped when another is chosen with it.
        const h = new ThueMorseGoGame(undefined, ["size-11", "kill-all", "half-button"]);
        expect(h.variants).to.deep.equal(["size-11", "half-button"]);
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
        expect(track.board.width).to.equal(7);
        expect(track.board.height).to.equal(18);
        expect(track.board.blocked).to.have.lengthOf(7 * 18 - 48);
        expect(track.pieces).to.equal(TRACK_0X123);
        const [tint, marker, digit] = layers(g, "m1d2");
        expect(tint).to.deep.equal({ name: "piece-square", paint: { fill: 1 }, opacity: 0.2 });
        // The marker spells out the glyph's default border so its paint, and so its symbol, differs from the small glyph's.
        expect(marker).to.deep.equal({ name: "piece", paint: { fill: 1, border: "#000" } });
        expect(digit).to.deep.equal({ text: "2", scale: 0.75, rotate: null });
        expect(layers(g, "m2d1")[2]).to.deep.equal({ text: "1", scale: 0.75, rotate: null });
        const [, smallGlyph] = layers(g, "s2");
        expect(smallGlyph).to.deep.equal({ name: "piece", paint: { fill: 2 }, scale: 0.57735 });
        expect(layers(g, "s2")).to.have.lengthOf(2);
        // A thick border in the colour of the next placement runs around the columns, inside the frame.
        const border = track.board.markers as MarkerLine[];
        expect(border).to.have.lengthOf(4);
        expect(border[0]).to.deep.equal({ type: "line", points: [{ row: 1, col: 1 }, { row: 1, col: 6 }], colour: 1, width: 8 });
        expect(border[2]).to.deep.equal({ type: "line", points: [{ row: 17, col: 6 }, { row: 17, col: 1 }], colour: 1, width: 8 });
        g.placed = 0x124;
        const next = (g.render().areas![0] as AreaTrack).board.markers as MarkerLine[];
        expect(next.every((line) => line.colour === 2)).to.be.true;
    });

    it("tints the tracker with the colour of the next placement", () => {
        const g = play(small(), ["f6"]);
        expect(layers(g, "s1")[0]).to.deep.equal({ name: "piece-square", paint: { fill: 2 }, opacity: 0.2 });
    });

    it("can run the digits downward and grows with the index", () => {
        const g = small();
        g.placed = 0x123;
        const track = g.render({ altDisplays: ["digits-down"] }).areas![0] as AreaTrack;
        expect(track.pieces).to.equal(TRACK_0X123.split("\n").reverse().join("\n"));
        g.placed = 0x1000;
        expect((g.render().areas![0] as AreaTrack).board.width).to.equal(9);
    });

    it("can roll a single column of the next 16 placements", () => {
        const g = small();
        const expected = (from: number, length: number, downward: boolean): string => {
            const rows: string[] = ["-,-,-"];
            for (let row = 0; row < 16; row++) {
                const i = downward ? row : 15 - row;
                const colour = g.colourAt(from + i);
                rows.push(`-,${i < length ? `m${colour}d${((from + i) % 16).toString(16)}` : `s${colour}`},-`);
            }
            rows.push("-,-,-");
            return rows.join("\n");
        };
        let track = g.render({ altDisplays: ["rolling"] }).areas![0] as AreaTrack;
        expect(track.board.width).to.equal(3);
        expect(track.board.height).to.equal(18);
        expect(track.board.blocked).to.have.lengthOf(3 * 18 - 16);
        expect(track.pieces).to.equal(expected(0, 1, false));
        g.move("f6");
        // Player 2's move is two placements, both marked with their digits.
        track = g.render({ altDisplays: ["rolling"] }).areas![0] as AreaTrack;
        expect(track.pieces).to.equal(expected(1, 2, false));
        expect(track.pieces.split("\n")[16]).to.equal("-,m2d1,-");
        expect(track.pieces.split("\n")[15]).to.equal("-,m2d2,-");
        track = g.render({ altDisplays: ["rolling", "digits-down"] }).areas![0] as AreaTrack;
        expect(track.pieces).to.equal(expected(1, 2, true));
    });

    it("shows no tracker under Balanced Marseillais", () => {
        expect(small(["marseillais"]).render().areas).to.be.undefined;
        expect(small().render().areas).to.have.lengthOf(1);
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
        const g = small(["handicap", "button"]);
        setStones(g, ["a2"], ["a1"]);
        play(g, ["b1", "2", "button", "pass", "pass,pass"]);
        expect(g.gameover).to.be.true;
        assertChatLogParity(g, ["Alice", "Bob"]);
        const log = g.chatLog(["Alice", "Bob"]).flat().join("\n");
        expect(log).to.contain("Alice placed a piece at b1.");
        expect(log).to.contain("Bob set the handicap to 2 stones.");
        expect(log).to.contain("Bob gave a handicap stone by passing.");
        expect(log).to.contain("Alice took the button.");
    });
});

describe("Thue-Morse Go: territory and dead strings", () => {
    /** A wall giving Player 1 the corner a1-b1, a far stone of theirs, and two Player 2 stones giving them k11. */
    const scene = (variants: string[] = []): ThueMorseGoGame => {
        const g = small(variants);
        setStones(g, ["a2", "b2", "c2", "c1", "f6"], ["j11", "k10"]);
        return g;
    };
    const rc = (g: ThueMorseGoGame, cell: string): { row: number; col: number } => {
        const [col, row] = g.algebraic2coords(cell);
        return { row, col };
    };
    /** The territory dots: the coloured dot markers, as opposed to the star points. */
    const dots = (g: ThueMorseGoGame, opts?: { altDisplays?: string[] }): MarkerDots[] =>
        (((g.render(opts).board as BoardBasic).markers ?? []) as MarkerDots[]).filter((m) => m.colour !== undefined);
    const click = (g: ThueMorseGoGame, move: string, cell: string): IClickResult => {
        const [x, y] = g.algebraic2coords(cell);
        return g.handleClick(move, y, x);
    };

    it("dots the empty points that count as territory", () => {
        const g = scene();
        const markers = dots(g);
        expect(markers).to.have.lengthOf(2);
        expect(markers[0]).to.deep.equal({ type: "dots", colour: 1, size: 0.2, points: [rc(g, "a1"), rc(g, "b1")] });
        expect(markers[1]).to.deep.equal({ type: "dots", colour: 2, size: 0.2, points: [rc(g, "k11")] });
        expect(g.getPlayerScore(1)).to.equal(7);
        expect(g.getPlayerScore(2)).to.equal(3);
        // The display option hides them, and Kill-All games never show them.
        expect(dots(g, { altDisplays: ["hide-territory"] })).to.have.lengthOf(0);
        const k = play(small(["kill-all"]), ["f6", "attacker"]);
        setStones(k, ["a2", "b2", "c2", "c1"], ["j11", "k10"]);
        expect(dots(k)).to.have.lengthOf(0);
        // A lone first stone reaches every empty point, so the whole board is dotted, as in Go.
        const first = dots(play(small(), ["f6"]));
        expect(first).to.have.lengthOf(1);
        expect(first[0].colour).to.equal(1);
        expect(first[0].points).to.have.lengthOf(120);
        expect(dots(small())).to.have.lengthOf(0);
    });

    it("keeps a whole-move pass open for marking strings dead", () => {
        const single = scene().validateMove("pass");
        expect(single.complete).to.equal(0);
        expect(single.canrender).to.be.true;
        expect(single.message).to.contain("mark them dead");
        const g = play(scene(), ["f7"]);
        expect(g.validateMove("pass,pass").complete).to.equal(0);
        // Passing one placement of two leaves the other to fill, as before.
        expect(g.validateMove("pass").message).to.contain("Place another stone");
        expect(g.validateMove("pass").complete).to.equal(0);
    });

    it("marks and unmarks strings by clicking them after passing", () => {
        const g = scene();
        expect(click(g, "pass", "b2").move).to.equal("pass,-a2");
        expect(click(g, "pass,-a2", "c1").move).to.equal("pass");
        // Marks are listed in board order, one token per string.
        expect(click(g, "pass,-a2", "k10").move).to.equal("pass,-k10,-a2");
        expect(g.validateMove("pass,-c1,-b2").valid).to.be.true;
        // An empty point placed afterwards drops the marking; a stone clicked without passing is just occupied.
        expect(click(g, "pass,-a2", "e5").move).to.equal("e5");
        const occupied = click(g, "", "a2");
        expect(occupied.valid).to.be.false;
        expect(occupied.message).to.contain("pass the whole move");
        expect(click(g, "e5", "a2").valid).to.be.false;
        // A two-placement move: the Pass button then a click, or a typed single pass then a click.
        const h = play(scene(), ["f7"]);
        expect(click(h, h.handleClick("", -1, -1, "_btn_pass").move, "j11").move).to.equal("pass,pass,-j11");
        expect(click(h, "pass", "j11").move).to.equal("pass,pass,-j11");
    });

    it("refuses marks that do not belong to a whole-move pass", () => {
        const g = scene();
        expect(g.validateMove("f7,-a2").valid).to.be.false;
        expect(g.validateMove("-a2").valid).to.be.false;
        expect(g.validateMove("pass,-a1").message).to.contain("no stone");
        expect(g.validateMove("pass,-zz9").valid).to.be.false;
        const k = play(small(["kill-all"]), ["f6", "attacker"]);
        expect(k.validateMove("pass,-f6").valid).to.be.false;
    });

    it("shows marked strings faded, with the territory they would leave", () => {
        const g = scene();
        g.move("pass,-k10,-j11", { partial: true });
        expect(g.marks).to.deep.equal(["j11", "k10"]);
        const rep = g.render();
        const legend = rep.legend as Record<string, Glyph[]>;
        expect(legend.D2T1).to.deep.equal([
            { name: "piece", paint: { fill: 2 }, opacity: 0.4 },
            { name: "piece-borderless", paint: { fill: 1 }, scale: 0.2 },
        ]);
        expect((rep.pieces as string).split("\n")[0]).to.contain("D2T1");
        // With Player 2 gone, every empty point is Player 1's, the corner under the dead stones included.
        const markers = dots(g);
        expect(markers).to.have.lengthOf(1);
        expect(markers[0].colour).to.equal(1);
        expect(markers[0].points).to.have.lengthOf(121 - 7);
        expect(g.getPlayerScore(1)).to.equal(121);
        expect(g.getPlayerScore(2)).to.equal(0);
        // A dead wall opens the corner to both colours, so the stones are faded without a dot.
        const h = scene();
        h.move("pass,-a2", { partial: true });
        expect((h.render().legend as Record<string, Glyph[]>).D1).to.deep.equal([{ name: "piece", paint: { fill: 1 }, opacity: 0.4 }]);
        expect(dots(h).map((m) => m.colour)).to.deep.equal([2]);
        expect(h.getPlayerScore(1)).to.equal(1);
        // Hiding the territory keeps the marked stones faded, without dots.
        expect(dots(g, { altDisplays: ["hide-territory"] })).to.have.lengthOf(0);
        expect((g.render({ altDisplays: ["hide-territory"] }).legend as Record<string, Glyph[]>).D2).to.have.lengthOf(1);
        // A typo in a mark names nothing when clicking, and is reported when validating.
        expect(click(scene(), "pass,-zz9", "j11").move).to.equal("pass,-j11");
    });

    it("ends the game when the opponent passes keeping the marking, removing the marked strings", () => {
        const g = play(scene(), ["pass,-j11,-k10"]);
        expect(g.gameover).to.be.false;
        expect(g.lastmove).to.equal("pass,-j11,-k10");
        expect(g.marks).to.deep.equal(["j11", "k10"]);
        expect(g.sidebarStatuses().some((s) => JSON.stringify(s.key).includes("MARKING"))).to.be.true;
        // The opponent's pass starts from that marking.
        expect(g.getButtons()[0].move).to.equal("pass,pass,-j11,-k10");
        expect(g.moves()).to.include("pass,pass,-j11,-k10");
        expect(g.moves()).to.not.include("pass,pass");
        const accept = g.validateMove("pass,pass,-j11,-k10");
        expect(accept.complete).to.equal(0);
        expect(accept.message).to.contain("end the game");
        g.move("pass,pass,-j11,-k10");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
        expect(g.board.has("k10")).to.be.false;
        expect(g.board.has("j11")).to.be.false;
        expect(g.results).to.deep.include({ type: "remove", where: "j11,k10", num: 2, how: "dead" });
        expect(g.getPlayerScore(1)).to.equal(121);
        expect(dots(g)[0].points).to.have.lengthOf(121 - 5);
        // Reloading keeps the marking.
        const again = new ThueMorseGoGame(play(scene(), ["pass,-j11,-k10"]).serialize());
        expect(again.marks).to.deep.equal(["j11", "k10"]);
        expect(again.render()).to.deep.equal(play(scene(), ["pass,-j11,-k10"]).render());
    });

    it("lets a changed marking resume the game, until both players have changed it in turn", () => {
        const g = play(scene(), ["pass,-j11,-k10"]);
        const change = g.validateMove("pass,pass");
        expect(change.valid).to.be.true;
        expect(change.message).to.contain("game goes on");
        g.move("pass,pass");
        expect(g.gameover).to.be.false;
        expect(g.dispute).to.be.true;
        expect(g.marks).to.deep.equal([]);
        expect(g.locked).to.be.false;
        // The first player may play on, which drops the marking, or pass: keeping it ends the game.
        const resumed = g.clone().move("f7");
        expect(resumed.marks).to.deep.equal([]);
        expect(resumed.dispute).to.be.false;
        expect(resumed.gameover).to.be.false;
        expect(g.clone().move("pass").gameover).to.be.true;
        // Changing it back is the second change in a row, after which the marking is locked.
        const counter = g.validateMove("pass,-k10");
        expect(counter.message).to.contain("neither player");
        g.move("pass,-k10");
        expect(g.locked).to.be.true;
        expect(g.gameover).to.be.false;
        expect(g.validateMove("pass,pass").valid).to.be.false;
        expect(g.validateMove("pass,-j11").valid).to.be.false;
        expect(click(g, "pass,-k10", "j11").valid).to.be.false;
        const locked = g.validateMove("pass,-k10");
        expect(locked.complete).to.equal(1);
        expect(locked.message).to.contain("no longer be changed");
        expect(g.getButtons()[0].move).to.equal("pass,-k10");
        g.move("pass,-k10");
        expect(g.gameover).to.be.true;
        expect(g.board.has("k10")).to.be.false;
        expect(g.board.has("j11")).to.be.true;
        // Once locked, even after play resumes, passes carry no marking.
        const h = play(scene(), ["pass,-j11,-k10", "pass,pass", "pass,-k10", "f7"]);
        expect(h.locked).to.be.true;
        expect(h.validateMove("pass,pass,-j11").valid).to.be.false;
        expect(h.validateMove("pass,pass").complete).to.equal(1);
        expect(click(h, "pass,pass", "j11").valid).to.be.false;
        play(h, ["pass,pass", "pass"]);
        expect(h.gameover).to.be.true;
        expect(h.board.has("j11")).to.be.true;
    });

    it("only locks the marking when the changes follow each other", () => {
        const g = play(scene(), ["pass,-j11,-k10", "pass,pass", "f7", "pass,-f6", "pass,pass"]);
        expect(g.dispute).to.be.true;
        expect(g.locked).to.be.false;
        g.move("pass,-f6");
        expect(g.locked).to.be.true;
        expect(g.gameover).to.be.false;
    });

    it("carries the marking across served handicap passes, which never answer it", () => {
        const g = play(small(["handicap"]), ["f6", "3", "pass,-f6"]);
        expect(g.currplayer).to.equal(1);
        expect(g.marks).to.deep.equal(["f6"]);
        expect(g.getButtons()[0].move).to.equal("pass,pass,-f6");
        g.move("pass,pass,-f6");
        expect(g.gameover).to.be.false;
        expect(g.dispute).to.be.false;
        g.move("pass,-f6");
        expect(g.gameover).to.be.true;
        expect(g.board.size).to.equal(0);
        expect(g.winner).to.deep.equal([1, 2]);
    });

    it("reports markings in the chat log", () => {
        const g = scene();
        play(g, ["pass,-j11,-k10", "pass,pass", "pass,-k10", "pass,-k10"]);
        expect(g.gameover).to.be.true;
        assertChatLogParity(g, ["Alice", "Bob"]);
        const log = g.chatLog(["Alice", "Bob"]).flat().join("\n");
        expect(log).to.contain("Alice marked 2 stones as dead.");
        expect(log).to.contain("Bob cleared the marking: no stones are marked dead.");
        expect(log).to.contain("Alice changed the marking: one stone is marked dead.");
        expect(log).to.contain("The stone marked dead was removed from the board.");
    });
});

describe("Thue-Morse Go: boards and star points", () => {
    const stars = (g: ThueMorseGoGame): MarkerDots | undefined =>
        (((g.render().board as BoardBasic).markers ?? []) as MarkerDots[]).find((m) => m.type === "dots" && m.colour === undefined);
    const corners = (lo: number, hi: number) => [{ row: lo, col: lo }, { row: lo, col: hi }, { row: hi, col: hi }, { row: hi, col: lo }];

    it("offers a 19x19 board", () => {
        const g = new ThueMorseGoGame(undefined, ["size-19"]);
        expect(g.render().board).to.deep.include({ width: 19, height: 19 });
        expect(g.validateMove("s19").valid).to.be.true;
        expect(g.validateMove("t19").valid).to.be.false;
        expect(g.allvariants()!.find((v) => v.uid === "size-19")!.group).to.equal("board");
    });

    it("puts the 11x11 star points on the 4-4 points without a centre", () => {
        const g = small();
        expect(g.render().options).to.deep.equal(["hide-star-points"]);
        expect(stars(g)).to.deep.equal({ type: "dots", size: 0.15, points: corners(3, 7) });
        // Other square boards keep the renderer's own star points.
        for (const size of ["size-19", "size-23", undefined]) {
            const h = new ThueMorseGoGame(undefined, size === undefined ? [] : [size]);
            expect(h.render().options).to.be.undefined;
            expect(stars(h)).to.be.undefined;
        }
    });

    it("draws star points on snub square boards where the square boards have them", () => {
        expect(stars(small(["snub"]))!.points).to.deep.equal(corners(3, 7));
        expect(stars(new ThueMorseGoGame(undefined, ["snub"]))!.points).to.deep.equal(corners(3, 12));
        const nineteen = stars(new ThueMorseGoGame(undefined, ["snub", "size-19"]))!.points;
        expect(nineteen).to.have.lengthOf(9);
        expect(nineteen).to.deep.include({ row: 9, col: 9 });
        expect(nineteen).to.deep.include({ row: 3, col: 9 });
        expect(stars(new ThueMorseGoGame(undefined, ["snub", "size-23"]))!.points).to.have.lengthOf(9);
        expect(small(["snub"]).render().options).to.be.undefined;
    });
});

describe("Thue-Morse Go: reverse komi", () => {
    const click = (g: ThueMorseGoGame, move: string, cell: string): IClickResult => {
        const [x, y] = g.algebraic2coords(cell);
        return g.handleClick(move, y, x);
    };

    it("begins Player 2's first move with a multiple of 14 given to Player 1, costing no placement", () => {
        const g = small(["reverse-komi"]);
        expect(g.allvariants()!.find((v) => v.uid === "reverse-komi")).to.deep.include({ unrated: true, fans: true });
        expect(g.currplayer).to.equal(1);
        expect(g.turnModel()).to.equal("sequential");
        g.move("f6");
        expect(g.getButtons()).to.deep.equal([]);
        const empty = g.validateMove("");
        expect(empty.complete).to.equal(-1);
        expect(empty.message).to.contain("reverse komi");
        expect(g.validateMove("e5").valid).to.be.false;
        expect(g.validateMove("0").valid).to.be.false;
        expect(g.validateMove("-14").valid).to.be.false;
        expect(g.validateMove("43").valid).to.be.false;
        // Any whole number up to the largest stone may be typed.
        expect(g.validateMove("1").complete).to.equal(0);
        expect(g.validateMove("7,e5").complete).to.equal(0);
        expect(play(small(["reverse-komi"]), ["f6", "7,e5", "pass", "pass"]).getPlayerScore(1)).to.equal(1 + 7);
        const alone = g.validateMove("14");
        expect(alone.complete).to.equal(0);
        expect(alone.message).to.contain("14 points");
        expect(g.validateMove("42,e5").complete).to.equal(0);
        expect(g.validateMove("28,e5,g7").complete).to.equal(1);
        expect(g.validateMove("14,e5,g7,d4").valid).to.be.false;
        expect(g.moves()).to.include("14,e5,g7");
        expect(g.randomMove()).to.match(/^(14|28|42)(,|$)/);
        // The numbered stones offer 14, 28 and 42 across the centre row; f6 is covered but still means 28.
        let pieces = g.render().pieces as string;
        expect(pieces).to.contain("n14,").and.to.contain("n42");
        expect(pieces).to.not.contain("n28,").and.to.not.contain("n56");
        expect(click(g, "", "e6").move).to.equal("14");
        expect(click(g, "", "f6").move).to.equal("28");
        expect(click(g, "", "g6").move).to.equal("42");
        const early = click(g, "", "e9");
        expect(early.valid).to.be.false;
        expect(early.message).to.contain("reverse komi");
        // Once the komi is set the stones give way to the board, and clicks place, even on their cells.
        pieces = g.clone().move("14", { partial: true }).render().pieces as string;
        expect(pieces).to.not.contain("n14");
        expect(click(g, "14", "e5").move).to.equal("14,e5");
        expect(click(g, "14", "e6").move).to.equal("14,e6");
        expect(click(g, "14,e5", "e5").move).to.equal("14");
        expect(g.handleClick("14,e5", -1, -1, "_btn_pass").move).to.equal("14,pass,pass");
        // Larger boards offer up to 14 times the handicap limit.
        expect(play(sixteen(["reverse-komi"]), ["h8"]).validateMove("84").valid).to.be.true;
        expect(play(sixteen(["reverse-komi"]), ["h8"]).validateMove("85").valid).to.be.false;
        expect(play(new ThueMorseGoGame(undefined, ["size-23", "reverse-komi"]), ["l12"]).render().pieces as string).to.contain("n196");
        // Submitting the komi alone passes the move.
        const passed = g.clone().move("14");
        expect(passed.lastmove).to.equal("14,pass,pass");
        expect(passed.passes).to.deep.equal([2]);
        expect(passed.komi).to.equal(14);
        g.move("28,e5,g7");
        expect(g.komi).to.equal(28);
        expect(g.placed).to.equal(3);
        expect(g.currplayer).to.equal(1);
        expect(g.lastmove).to.equal("28,e5,g7");
        expect(g.results.slice(0, 2)).to.deep.equal([{ type: "komi", value: 28 }, { type: "place", where: "e5" }]);
        expect(g.getPlayerScore(1)).to.equal(1 + 28);
        expect(g.getPlayerScore(2)).to.equal(2);
        expect(g.getButtons().map((b) => b.move)).to.deep.equal(["pass"]);
        // The move table stays sequential, and reloading keeps the komi.
        expect(g.getRounds()).to.deep.equal([[{ move: "f6", result: [{ type: "place", where: "f6" }] }, { move: "28,e5,g7", result: g.results }]]);
        const again = new ThueMorseGoGame(g.serialize());
        expect(again.komi).to.equal(28);
        expect(again.sidebarStatuses().some((s) => JSON.stringify(s).includes("\"28\""))).to.be.true;
        expect(again.validateMove("f7").valid).to.be.true;
    });

    it("counts the komi for Player 1 at the end of the game and in the chat log", () => {
        const g = play(small(["reverse-komi"]), ["f6", "14", "pass"]);
        expect(g.gameover).to.be.true;
        expect(g.getPlayerScore(1)).to.equal(121 + 14);
        expect(g.getPlayerScore(2)).to.equal(0);
        expect(g.winner).to.deep.equal([1]);
        assertChatLogParity(g, ["Alice", "Bob"]);
        const log = g.chatLog(["Alice", "Bob"]).flat().join("\n");
        expect(log).to.contain("Bob gave their opponent a reverse komi of 14 points.");
        expect(log).to.contain("Bob passed.");
        // One stone each is level, so the komi decides.
        expect(play(small(["reverse-komi"]), ["f6", "14,e5", "pass", "pass"]).winner).to.deep.equal([1]);
        expect(play(small(), ["f6", "e5", "pass", "pass"]).winner).to.deep.equal([1, 2]);
    });

    it("comes before the handicap, both choices staying open to clicks until a placement remains", () => {
        const g = play(small(["reverse-komi", "handicap"]), ["f6"]);
        expect(g.validateMove("").message).to.contain("handicap");
        const komiOnly = g.validateMove("14");
        expect(komiOnly.complete).to.equal(-1);
        expect(komiOnly.message).to.contain("handicap");
        // Komi stones in the row above the centre, handicap stones in the row below.
        const pieces = g.render().pieces as string;
        expect(pieces).to.contain("n14,").and.to.contain("n42").and.to.contain("n1,").and.to.contain("n3,");
        expect(click(g, "", "e7").move).to.equal("14");
        expect(click(g, "", "e5").message).to.contain("Choose the reverse komi first");
        expect(click(g, "14", "e5").move).to.equal("14,1");
        expect(click(g, "14", "g5").move).to.equal("14,3");
        // Either choice can be changed while the stones show; a new handicap drops any placement.
        expect(click(g, "14,3", "f7").move).to.equal("28,3");
        expect(click(g, "14,3", "f5").move).to.equal("14,2");
        // With a handicap of one the stones are gone, so f5 is a point: it replaces the placement.
        expect(click(g, "14,1,c3", "f5").move).to.equal("14,1,f5");
        expect(click(g, "14,3", "c3").message).to.contain("no placement left");
        // A handicap of one leaves a placement, so the board takes over, the stones' cells included.
        expect(click(g, "14,1", "c3").move).to.equal("14,1,c3");
        expect(click(g, "14,1", "e7").move).to.equal("14,1,e7");
        let partial = g.clone().move("14,3", { partial: true }).render();
        expect(partial.pieces as string).to.contain("n14,").and.to.contain("n1,");
        const [kx, ky] = g.algebraic2coords("e7");
        const [hx, hy] = g.algebraic2coords("g5");
        expect(partial.annotations).to.deep.include({ type: "enter", targets: [{ row: ky, col: kx }] });
        expect(partial.annotations).to.deep.include({ type: "enter", targets: [{ row: hy, col: hx }] });
        partial = g.clone().move("14,1", { partial: true }).render();
        expect(partial.pieces as string).to.not.contain("n14");
        expect(g.validateMove("14,3").complete).to.equal(0);
        expect(g.validateMove("14,4").valid).to.be.false;
        g.move("14,3");
        expect(g.komi).to.equal(14);
        expect(g.handicap).to.equal(3);
        expect(g.passesOwed).to.equal(1);
        expect(g.placed).to.equal(3);
        expect(g.currplayer).to.equal(1);
        // The declaration serves placement 1 and a forced pass placement 2, as in a plain handicap move.
        expect(g.lastmove).to.equal("14,3");
        g.move("e5");
        // Player 2's single placement 4 is served by the handicap.
        expect(g.placed).to.equal(5);
        expect(g.currplayer).to.equal(1);
        expect(g.passesOwed).to.equal(0);
        expect(g.getPlayerScore(1)).to.equal(121 + 14);
        expect(g.getPlayerScore(2)).to.equal(0);
        const one = play(small(["reverse-komi", "handicap"]), ["f6", "28,1,e5"]);
        expect(one.komi).to.equal(28);
        expect(one.board.get("e5")).to.equal(2);
        expect(new ThueMorseGoGame(undefined, ["kill-all", "reverse-komi"]).variants).to.deep.equal(["reverse-komi"]);
        expect(new ThueMorseGoGame(undefined, ["reverse-komi", "kill-all"]).variants).to.deep.equal(["kill-all"]);
        expect(g.randomMove()).to.match(/^[a-k]\d+/);
    });
});
