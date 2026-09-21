/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import i18next from "i18next";
import { addResource } from "../../src";
import { ArimaaGame } from '../../src/games';

describe("Arimaa", () => {
    before(() => {
        addResource("en");
    });

    it ("EOG scenarios", () => {
        // all rabbits on same turn
        let g = new ArimaaGame(undefined, ["free"]);
        g.move("Rc3,Ed3");
        g.move("re3,ee5");
        g.move("re3f3,Ed3e3");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);

        // no possible moves (all frozen or blocked in)
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Rd4, Eh1");
        g.move("hd5, eh2, eg1, rg6");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([2]);

        // pushing a rabbit onto the goal then pulling it off doesn't end the game
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Ed2, Rb7");
        g.move("eg7, re2");
        g.move("re2e1, Ed2e2, Ee2e3, re1e2");
        expect(g.gameover).to.be.false;

        // both at same time, person who just moved wins
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Rd7, Ee2");
        g.move("rd2");
        g.move("Rd7d8, rd2d1, Ee2d2");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it ("Free placement", () => {
        const g = new ArimaaGame(undefined, ["free"]);
        // can place anywhere
        let result = g.validateMove("Ec3");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(-1);
        // must place a rabbit
        result = g.validateMove("Ec3,Rd4");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(0);
        // can't place a rabbit on the goal row
        result = g.validateMove("Ec3,Rd4,Rd8");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(-1);
        g.move("Ec3,Rd4");
        g.move("ed5,rd6");
        // traps trigger after setup
        expect(g.board.get("c3")).to.be.undefined;
        // setup phase ends correctly
        result = g.validateMove("Ec3");
        expect(result.valid).to.be.false;
    });

    it ("General setup issues", () => {
        // can't place opposing pieces manually
        let g = new ArimaaGame();
        g.move("ee2,Md2,Hb2,Hg2,Ra2,Ra1,Rb1,Rc1,Rf1,Rg1,Rh1,Rh2,Cf2,Cc2,Dd1,De1");
        const [pc, owner] = g.board.get("e2")!;
        expect(pc).to.equal("E");
        expect(owner).to.equal(1);

        // warnings
        g = new ArimaaGame();
        g.move("Ee2,Md2,Hb2,Hg2,Ra2,Ra1,Rb1,Rc1,Rf1,Rg1,Rh1,Rh2,Cf2,Cc2,Dd1,De1");
        // no warnings
        let result = g.validateMove("me7,ed7,hb7,hg7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7,cf7,de8,cd8,dc7");
        expect(result.message).to.equal(i18next.t("apgames:validation._general.VALID_MOVE"));
        // same file
        result = g.validateMove("ee7,md7,hb7,hg7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7,cf7,de8,cd8,dc7");
        expect(result.message).to.include(i18next.t("apgames:validation.arimaa.WARN_FILE"));
        // unbalanced
        result = g.validateMove("ea7,mb7,hc7,hd7,ce7,df7,dg7,ch7,ra8,rb8,rc8,rd8,re8,rf8,rg8,rh8");
        expect(result.message).to.include(i18next.t("apgames:validation.arimaa.WARN_BALANCE"));
        // hiding
        result = g.validateMove("ed7,me7,hb7,hg7,ra7,ra8,rb8,rc8,rg8,rh8,rh7,cf8,rf7,cd8,de8,dc7");
        expect(result.message).to.equal(i18next.t("apgames:validation._general.VALID_MOVE"));
        result = g.validateMove("ed7,hb7,hg7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7,cf7,ce7,dc7,dd8,me8");
        expect(result.message).to.include(i18next.t("apgames:validation.arimaa.WARN_HIDE"));
    });

    it ("Rabbit autofill in standard setup", () => {
        const nonrabbits = "Ee2,Md2,Hb2,Hg2,Cf2,Cc2,Dd1,De1";
        let g = new ArimaaGame();
        // not until every non-rabbit is down
        let result = g.validateMove("Ee2,Md2,Hb2,Hg2,Cf2,Cc2,Dd1");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(-1);
        // eight non-rabbits and no rabbits is submittable
        result = g.validateMove(nonrabbits);
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(0);
        expect(result.message).to.include(i18next.t("apgames:validation.arimaa.PARTIAL_RABBITS"));
        // and so is anything between that and a full setup
        result = g.validateMove(`${nonrabbits},Ra2,Ra1,Rb1`);
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(0);
        // advice is given against the filled-in setup, not the partial one
        result = g.validateMove("Ea2,Mb2,Hc2,Hd2,Ce2,Df2,Dg2,Ch2");
        expect(result.message).to.include(i18next.t("apgames:validation.arimaa.WARN_BALANCE"));

        // submitting fills the empty cells of the setup area with rabbits
        g.move(nonrabbits);
        for (const cell of ["a2", "h2", "a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1"]) {
            const contents = g.board.get(cell);
            expect(contents).to.not.be.undefined;
            if (cell === "d1" || cell === "e1") {
                expect(contents![0]).to.equal("D");
            } else {
                expect(contents![0]).to.equal("R");
                expect(contents![1]).to.equal(1);
            }
        }
        expect(g.hands![0]).to.be.empty;
        // silver works the same way
        g.move("ee7,md7,hb7,hg7,cf7,cc7,dd8,de8");
        expect(g.board.get("a7")![0]).to.equal("R");
        expect(g.board.get("a7")![1]).to.equal(2);
        expect(g.hands).to.be.undefined;
        expect([...g.board.values()].filter(([pc,]) => pc === "R")).to.have.lengthOf(16);

        // partially placed rabbits are left where the player put them
        g = new ArimaaGame();
        g.move(`${nonrabbits},Ra2,Rh2`);
        expect(g.board.get("a2")![0]).to.equal("R");
        expect([...g.board.values()].filter(([pc,]) => pc === "R")).to.have.lengthOf(8);
        expect(g.hands![0]).to.be.empty;

        // a complete setup still produces the same result as before
        g = new ArimaaGame();
        g.move(`${nonrabbits},Ra2,Rh2,Ra1,Rb1,Rc1,Rf1,Rg1,Rh1`);
        const filled = new ArimaaGame();
        filled.move(nonrabbits);
        expect(g.signature()).to.equal(filled.signature());

        // the shortcut doesn't apply to the free variant
        g = new ArimaaGame(undefined, ["free"]);
        result = g.validateMove("Ec3");
        expect(result.message).to.not.include(i18next.t("apgames:validation.arimaa.PARTIAL_RABBITS"));
    });

    it ("Free setup defaults to placing a rabbit", () => {
        // clicking an empty cell with nothing selected places a rabbit
        let g = new ArimaaGame(undefined, ["free"]);
        let result = g.handleClick("", 4, 3);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("Rd4");
        // but an explicitly chosen piece still wins
        result = g.handleClick("E", 4, 3);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("Ed4");
        // silver too
        g.move("Rd4");
        result = g.handleClick("", 3, 3);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("rd5");

        // standard setup still offers the strongest piece in hand
        g = new ArimaaGame();
        result = g.handleClick("", 6, 4);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("Ee2");
        result = g.handleClick("Ee2", 6, 3);
        expect(result.valid).to.be.true;
        expect(result.move).to.equal("Ee2,Md2");
    });

    it ("Can't place two pieces on one cell", () => {
        // only reachable by typing; the click handler refuses to drop onto an
        // occupied cell. Used to throw an unhandled TypeError in standard setup
        // (the hand emptied while a home cell stayed empty) and to be accepted
        // silently in free setup, overwriting the earlier piece.
        let g = new ArimaaGame();
        let result = g.validateMove("Ee2,Me2,Hb2,Hg2,Cf2,Cc2,Dd1,De1,Ra2,Rh2,Ra1,Rb1,Rc1,Rf1,Rg1,Rh1");
        expect(result.valid).to.be.false;
        expect(result.message).to.equal(i18next.t("apgames:validation._general.OCCUPIED", {where: "e2"}));
        g = new ArimaaGame(undefined, ["free"]);
        result = g.validateMove("Ec3,Mc3,Rd4");
        expect(result.valid).to.be.false;
        expect(result.message).to.equal(i18next.t("apgames:validation._general.OCCUPIED", {where: "c3"}));
        // placing onto an opponent's piece is still caught the same way
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Ec3,Rd4");
        result = g.validateMove("ec3");
        expect(result.valid).to.be.false;
        expect(result.message).to.equal(i18next.t("apgames:validation._general.OCCUPIED", {where: "c3"}));
    });

    it ("classifications", () => {
        expect(ArimaaGame.classify(1, "Ra1,Ed4".split(","))).to.deep.equal(["placement", "placement"]);
        expect(ArimaaGame.classify(2, "Ra1,Ed4".split(","))).to.deep.equal([undefined, undefined]);
        expect(ArimaaGame.classify(1, "rd5d6,Ed4d5,rd3d4".split(","))).to.deep.equal(["pushee", "pusher", undefined]);
        expect(ArimaaGame.classify(1, "Hd6d7,rd5d6,Ed4d5,rd3d4".split(","))).to.deep.equal(["puller", "pullee", "puller", "pullee"]);
    });

    it ("Push + Pull", () => {
        // can't immediately push then pull
        let g = new ArimaaGame(undefined, ["free"]);
        g.move("Ra1,Ed4");
        g.move("rd3,rd5");
        let result = g.validateMove("rd5d6,Ed4d5,rd3d4");
        expect(result.valid).to.be.false;

        // but can pull out from then push into
        g = new ArimaaGame(undefined, ["free"]);
        g.move("Ra1,Ed4,Hd6");
        g.move("rd5,rd3");
        result = g.validateMove("Hd6d7,rd5d6,Ed4d5,rd3d4");
        expect(result.valid).to.be.true;
        expect(result.complete).to.equal(1);
    });
});


// ---------------------------------------------------------------------------
// Lightvector notation and arrow entry

import { isLegacy, parseMove, parseToken, NotationError } from "../../src/games/arimaa/notation";
import { resolve, serializeTurn, sqName, turnFromSteps, type CellContents } from "../../src/games/arimaa/turns";

const rc = (cell: string): [number, number] => {
    const [x, y] = ArimaaGame.algebraic2coords(cell);
    return [y, x];
};
const click = (g: ArimaaGame, move: string, cell: string) => g.handleClick(move, ...rc(cell));
const annotations = (g: ArimaaGame): string[] => {
    const rep = g.render();
    const name = (t: {row: number; col: number}): string => ArimaaGame.coords2algebraic(t.col, t.row);
    return ((rep.annotations ?? []) as Array<{type: string; targets: Array<{row: number; col: number}>}>).map(a => `${a.type}:${a.targets.map(name).join(">")}`);
};
// free placement lets a test build any position: gold places, silver places, gold to move
const position = (gold: string, silver: string): ArimaaGame => {
    const g = new ArimaaGame(undefined, ["free"]);
    g.move(gold);
    g.move(silver);
    return g;
};
const boardOf = (spec: string): Map<string, CellContents> => {
    const b = new Map<string, CellContents>();
    for (const t of spec.trim().split(/\s+/)) {
        b.set(t.slice(1), [t[0].toUpperCase() as CellContents[0], t[0] === t[0].toUpperCase() ? 1 : 2]);
    }
    return b;
};

describe("Arimaa notation parser", () => {
    it("splits tokens from the right", () => {
        const cases: Array<[string, string, string]> = [
            ["Ed4", "E", "dest:d4"],
            ["d4e5", "d4", "dest:e5"],
            ["Ed4e5", "Ed4", "dest:e5"],
            ["ee", "e", "steps:e"],
            ["eee", "e", "steps:ee"],
            ["en", "e", "steps:n"],
            ["d4ee", "d4", "steps:ee"],
            ["de4e", "de4", "steps:e"],
            ["Ed4news", "Ed4", "steps:news"],
            ["h5x", "h5", "capture"],
            ["hh5", "h", "dest:h5"],
            ["hx", "h", "capture"],
            ["Rc3x", "Rc3", "capture"],
        ];
        for (const [text, spec, prop] of cases) {
            const t = parseToken(text);
            const specText = `${t.spec.piece === undefined ? "" : (t.spec.owner === 1 ? t.spec.piece : t.spec.piece.toLowerCase())}${t.spec.square ?? ""}`;
            const propText = t.prop.kind === "dest" ? `dest:${t.prop.square}` : t.prop.kind === "steps" ? `steps:${t.prop.dirs.join("")}` : "capture";
            expect(specText, text).to.equal(spec);
            expect(propText, text).to.equal(prop);
        }
    });
    it("rejects malformed tokens", () => {
        for (const bad of ["x", "e4", "R", "n", "garbage!", "4e", "Ex4", "z3", "i9x", "Ed4x4"]) {
            expect(() => parseToken(bad), bad).to.throw(NotationError);
        }
    });
    it("recognises legacy strings", () => {
        expect(isLegacy("Db4b5, Ra5a6")).to.be.true;
        expect(isLegacy("Dc4c3(xDc3)")).to.be.true;
        expect(isLegacy("Ec3,Rd4,xRc3")).to.be.true;
        expect(isLegacy("Db4b5")).to.be.false;
        expect(isLegacy("Ed4 Me")).to.be.false;
        expect(isLegacy("dx")).to.be.false;
    });
    it("keeps a trailing bare square as the pending selection only when allowed", () => {
        const p = parseMove("Ed4e4 e4", true);
        expect(p.tokens.map(t => t.text)).to.deep.equal(["Ed4e4"]);
        expect(p.pending).to.equal("e4");
        expect(() => parseMove("Ed4e4 e4")).to.throw(NotationError);
        expect(() => parseMove("e4 Ed4e4", true)).to.throw(NotationError);
    });
});

describe("Arimaa resolution", () => {
    const flip = boardOf("Hg3 dh3 Cf2 Ra2 ra7 Ee1 ee8");
    it("resolves the flip from any of its spellings and writes it as dx", () => {
        for (const m of ["dx", "df3", "dh3f3", "dh3x"]) {
            const r = resolve(flip, 1, 4, parseMove(m).tokens, false);
            expect(r.status, m).to.equal("resolved");
            if (r.status === "resolved") {
                expect(r.bucket).to.deep.equal([4, 1]);
                expect(r.turn.captures.map(c => sqName(c.square))).to.deep.equal(["f3"]);
                expect(serializeTurn(flip, 1, 4, r.turn)).to.equal("dx");
            }
        }
    });
    it("reports ambiguity and unsatisfiability", () => {
        expect(resolve(flip, 1, 4, parseMove("dg3").tokens, false).status).to.equal("ambiguous");
        expect(resolve(flip, 1, 4, parseMove("Hg3g4 dh3f3").tokens, false).status).to.equal("unsatisfiable");
        expect(resolve(flip, 1, 4, parseMove("Ea8").tokens, false).status).to.equal("unsatisfiable");
    });
    it("needs the pusher named when two pieces could push", () => {
        const b = boardOf("Ed4 Hf4 re4 Ra1 ra8 ee8");
        expect(resolve(b, 1, 4, parseMove("re4e5").tokens, false).status).to.equal("ambiguous");
        const r = resolve(b, 1, 4, parseMove("re4e5 Ed4e4").tokens, false);
        expect(r.status).to.equal("resolved");
        if (r.status === "resolved") {
            expect(r.bucket).to.deep.equal([2, 2]);
            expect(serializeTurn(b, 1, 4, r.turn)).to.equal("re5 Ee4");
        }
    });
    it("treats a round trip as equivalent to the walk that reaches the same position", () => {
        const b = boardOf("Ed2 re2 Rb7 eg7 rf8 Ra1");
        const turn = turnFromSteps(b, 1, [{from: "e2", to: "e1"}, {from: "d2", to: "e2"}, {from: "e2", to: "e3"}, {from: "e1", to: "e2"}]);
        expect(turn.displaced).to.equal(1);
        expect(serializeTurn(b, 1, 4, turn)).to.equal("Ee3");
        const r = resolve(b, 1, 4, parseMove("Ee3").tokens, false);
        expect(r.status).to.equal("resolved");
        if (r.status === "resolved") {
            expect(r.bucket).to.deep.equal([2, 1]);
            expect(r.turn.signature).to.equal(turn.signature);
        }
    });
    it("orders step tokens as written", () => {
        // Lightvector's example, shifted off the traps: the same four tokens
        // in another order name a different sequence, here one nobody can play
        const b = boardOf("Rd3 Rc4 Ee1 Ra1 ra8 ee8");
        const a = resolve(b, 1, 4, parseMove("d3n d4n c4e d4e").tokens, false);
        expect(a.status).to.equal("resolved");
        if (a.status === "resolved") {
            expect(a.turn.steps.map(s => `${sqName(s.from)}${s.dir}`)).to.deep.equal(["d3n", "d4n", "c4e", "d4e"]);
        }
        expect(resolve(b, 1, 4, parseMove("d3n d4e d4n c4e").tokens, false).status).to.equal("unsatisfiable");
        // without the ordering the tokens would also fit the other interleaving
        const c = resolve(b, 1, 4, parseMove("c4e d4n d3n d4e").tokens, false);
        expect(c.status).to.equal("resolved");
        if (c.status === "resolved") {
            expect(c.turn.steps.map(s => `${sqName(s.from)}${s.dir}`)).to.deep.equal(["c4e", "d4n", "d3n", "d4e"]);
        }
    });
    it("lets a pulled piece end where the puller started", () => {
        // the pruning heuristic once demanded the pulled rabbit be moved off g5 again
        const b = boardOf("mg5 Rh5 hh7 ee8 Ee1 ra8 Ra1");
        const r = resolve(b, 2, 4, parseMove("mg5g3 Rh5g5 hh7h6").tokens, false);
        expect(r.status).to.equal("resolved");
        if (r.status === "resolved") {
            expect(r.bucket).to.deep.equal([4, 3]);
            expect(serializeTurn(b, 2, 4, r.turn)).to.equal("mg3 Rg5 hh6");
        }
        const c = boardOf("rb6 mb5 Ra5 ee8 Ee1 ra8 Rh1");
        const r2 = resolve(c, 2, 4, parseMove("rb6x mb5x Ra5b5").tokens, false);
        expect(r2.status).to.equal("resolved");
    });
    it("pruning never changes an answer", function () {
        this.timeout(120000);
        // deterministic pseudo-random positions and token sets: sparse boards
        // searched four steps deep, then denser ones three steps deep
        // mulberry32: a plain LCG overflows double precision here and collapses
        let seed = 12345;
        const rnd = (n: number): number => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) % n;
        };
        const types = ["E", "M", "H", "D", "C", "R"];
        const key = (r: ReturnType<typeof resolve>): string => r.status === "resolved" ? `${r.status}:${r.bucket}:${r.turn.signature}` : r.status === "ambiguous" ? `${r.status}:${r.bucket}:${r.positions}` : r.status;
        const square = (): string => `${"abcdefgh"[rnd(8)]}${1 + rnd(8)}`;
        const check = (pieces: number, maxSteps: number): void => {
            const b = new Map<string, CellContents>();
            for (let i = 0; i < pieces; i++) {
                const cell = square();
                if (!b.has(cell)) {
                    b.set(cell, [types[rnd(6)] as CellContents[0], (1 + rnd(2)) as 1 | 2]);
                }
            }
            // a legal position has no unsupported piece on a trap
            for (const trap of ["c3", "f3", "c6", "f6"]) {
                if (b.has(trap)) {
                    const [x, y] = ArimaaGame.algebraic2coords(trap);
                    const owner = b.get(trap)![1];
                    const supported = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => b.get(ArimaaGame.coords2algebraic(nx, ny))?.[1] === owner);
                    if (!supported) {
                        b.delete(trap);
                    }
                }
            }
            const player = (1 + rnd(2)) as 1 | 2;
            const cells = [...b.keys()];
            const letterOf = (cell: string): string => {
                const [pc, owner] = b.get(cell)!;
                return owner === 1 ? pc : pc.toLowerCase();
            };
            const tokens: string[] = [];
            for (let k = 0; k < 1 + rnd(2) && cells.length > 0; k++) {
                const from = cells[rnd(cells.length)];
                // half the destinations are squares other pieces occupy, where the
                // heuristic's occupancy reasoning is exercised
                const to = rnd(2) === 0 ? cells[rnd(cells.length)] : square();
                const letter = letterOf(from);
                switch (rnd(6)) {
                    case 0:
                        tokens.push(`${letter}${from}x`);
                        break;
                    case 1:
                        tokens.push(`${letter}${to}`);
                        break;
                    case 2:
                        tokens.push(`${letter}${from}${"nsew"[rnd(4)]}`);
                        break;
                    case 3:
                        // two tokens for one square
                        tokens.push(`${letter}${from}${to}`, `${letterOf(cells[rnd(cells.length)])}${to}`);
                        break;
                    default:
                        tokens.push(`${letter}${from}${to}`);
                }
            }
            const parsed = parseMove(tokens.join(" ")).tokens;
            const pruned = resolve(b, player, maxSteps, parsed, false, true);
            const full = resolve(b, player, maxSteps, parsed, false, false);
            expect(key(pruned), `${[...b.entries()].map(([c, [p, o]]) => (o === 1 ? p : p.toLowerCase()) + c).join(" ")} / ${tokens.join(" ")} / player ${player} / ${maxSteps} steps`).to.equal(key(full));
        };
        for (let trial = 0; trial < 150; trial++) {
            check(4 + rnd(4), 4);
        }
        for (let trial = 0; trial < 60; trial++) {
            check(9 + rnd(5), 3);
        }
    });
});

describe("Arimaa arrow entry", () => {
    it("enters a flip in two clicks and records it as dx", () => {
        const g = position("Hg3,Cf2,Ra2,Ee1", "dh3,ra7,ee8");
        let r = click(g, "", "h3");
        expect(r.move).to.equal("h3");
        expect(r.complete).to.equal(-1);
        r = click(g, r.move, "f3");
        expect(r.move).to.equal("dh3f3");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(1);
        const preview = g.clone();
        preview.move(r.move, {partial: true});
        expect(annotations(preview)).to.have.members(["enter:g3", "move:h3>f3", "exit:f3"]);
        g.move(r.move);
        expect(g.lastmove).to.equal("dx");
        expect(g.board.has("h3")).to.be.false;
        expect(g.board.get("g3")).to.deep.equal(["H", 1]);
        expect(annotations(g)).to.have.members(["enter:g3", "move:h3>f3", "exit:f3"]);
        expect(g.results.filter(x => x.type === "move").length).to.equal(4);
        expect(g.results.filter(x => x.type === "destroy").length).to.equal(1);
    });
    it("pins an ambiguous push by arrowing the pusher onto the vacated square", () => {
        const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
        let r = click(g, "", "e4");
        r = click(g, r.move, "e5");
        expect(r.move).to.equal("re4e5");
        expect(r.complete).to.equal(-1);
        r = click(g, r.move, "d4");
        expect(r.move).to.equal("re4e5 d4");
        r = click(g, r.move, "e4");
        expect(r.move).to.equal("re4e5 Ed4e4");
        expect(r.complete).to.equal(0);
        g.move(r.move);
        expect(g.lastmove).to.equal("re5 Ee4");
    });
    it("enters a pull in four clicks", () => {
        const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
        let r = click(g, "", "d4");
        r = click(g, r.move, "c4");
        r = click(g, r.move, "e4");
        expect(r.move).to.equal("Ed4c4 e4");
        // the arrows already form a move, but the dangling selection blocks it
        expect(r.complete).to.equal(-1);
        expect(r.message).to.equal(i18next.t("apgames:validation.arimaa.INCOMPLETE"));
        r = click(g, r.move, "d4");
        expect(r.move).to.equal("Ed4c4 re4d4");
        g.move(r.move);
        expect(g.lastmove).to.equal("Ec4 rd4");
        expect(annotations(g)).to.have.members(["move:d4>c4", "move:e4>d4"]);
    });
    it("re-selects, cancels, extends from an arrow head and deletes from its tail", () => {
        const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
        let r = click(g, "", "d4");
        r = click(g, r.move, "f4");
        expect(r.move).to.equal("f4");
        r = click(g, r.move, "f4");
        expect(r.move).to.equal("");
        r = click(g, "d4", "d6");
        expect(r.move).to.equal("Ed4d6");
        r = click(g, r.move, "d6");
        expect(r.move).to.equal("Ed4d6 d6");
        r = click(g, r.move, "e6");
        expect(r.move).to.equal("Ed4e6");
        r = click(g, r.move, "d4");
        expect(r.move).to.equal("d4");
        r = click(g, r.move, "d4");
        expect(r.move).to.equal("");
        // an empty square with nothing selected is a no-op
        r = click(g, "", "b5");
        expect(r.move).to.equal("");
    });
    it("rejects a click that no legal move can satisfy and keeps the previous move", () => {
        const g = position("Ed4,Ra1", "ee5,ra8");
        let r = click(g, "d4", "h8");
        expect(r.move).to.equal("d4");
        expect(r.valid).to.be.false;
        // an occupied, unvacated square is a re-selection, never a destination
        r = click(g, "d4", "e5");
        expect(r.move).to.equal("e5");
        expect(r.valid).to.be.true;
    });
    it("rejects arrows no turn can satisfy on a full board", () => {
        const g = new ArimaaGame();
        g.move("Ee2,Md2,Hb2,Hg2,Dd1,De1,Cc2,Cf2,Ra2,Ra1,Rb1,Rc1,Rf1,Rg1,Rh1,Rh2");
        g.move("ee7,md7,hb7,hg7,dd8,de8,cc7,cf7,ra7,ra8,rb8,rc8,rf8,rg8,rh8,rh7");
        // a rabbit backward, two pieces on one square, an enemy out of reach
        for (const m of ["Ra2a1", "Hb2b3 Ra2b3", "ex", "mx", "Ra2s"]) {
            const r = g.validateMove(m);
            expect(r.valid, m).to.be.false;
            expect(r.message, m).to.equal(i18next.t("apgames:validation.arimaa.NO_MOVE"));
        }
    });
    it("accepts a double push with the pusher arrowed", () => {
        const g = position("Ed4,Ra1,Cc1", "re4,ra8,ee8");
        const r = g.validateMove("re4e6 Ed4e5");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(1);
        g.move("re4e6 Ed4e5");
        expect(g.board.get("e6")).to.deep.equal(["R", 2]);
        expect(g.board.get("e5")).to.deep.equal(["E", 1]);
        expect(g.lastmove).to.equal("re6 Ee5");
    });
    it("names the pieces it inferred", () => {
        const g = position("Ed4,Ra1,Cc1", "re4,ra8,ee8");
        const r = g.validateMove("re4e5");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(0);
        expect(r.message).to.contain("Ed4e4");
    });
    it("applies the two-step ceiling on the first ply of an endless endgame", () => {
        const g = new ArimaaGame(undefined, ["eee"]);
        const e = [...g.board.entries()].find(([, [pc, owner]]) => pc === "E" && owner === 1)![0];
        const [x, y] = ArimaaGame.algebraic2coords(e);
        const far = ArimaaGame.coords2algebraic(x, y < 4 ? y + 3 : y - 3);
        const r = g.validateMove(`E${e}${far}`);
        expect(r.valid).to.be.false;
        expect(r.message).to.contain("2");
    });
});

describe("Arimaa notation compatibility", () => {
    it("reads the old step notation and writes the new one", () => {
        const g = position("Hg3,Cf2,Ra2,Ee1", "dh3,ra7,ee8");
        g.move("Hg3g4,dh3g3,dg3f3(xdf3),Hg4g3");
        expect(g.lastmove).to.equal("dx");
        expect(g.board.has("f3")).to.be.false;
    });
    it("compares moves by the position they reach", () => {
        const g = position("Hg3,Cf2,Ra2,Ee1", "dh3,ra7,ee8");
        g.move("dh3f3");
        expect(g.sameMove("dx", "Hg3g2, dh3g3, dg3f3, Hg2g3")).to.be.true;
        expect(g.sameMove("dx", "df3")).to.be.true;
        expect(g.sameMove("dx", "Hg3g4")).to.be.false;
    });
    it("stored notation replays to the same position", () => {
        const g = position("Ed4,Hf4,Ra1,Cc1,Db4", "re4,ra8,ee8,md7");
        for (const m of ["Db4b5 Ed4c4", "md7d6 ra8b8", "Hf4e4 re4e5 Ec4c5", "ee8e7", "Hf4 Db5b4"]) {
            const before = g.clone();
            g.move(m);
            const replay = before.clone();
            replay.move(g.lastmove!);
            expect(replay.signature(), `${m} -> ${g.lastmove}`).to.equal(g.signature());
            const strict = resolve(before.board, before.currplayer, 4, parseMove(g.lastmove!).tokens, false);
            expect(strict.status, g.lastmove).to.equal("resolved");
        }
    });
    it("refuses a third repetition only after resolving the move", () => {
        const g = position("Ed4,Ra2", "ee8,ra7");
        const cycle = ["Ed4d5", "ee8e7", "Ed5d4", "ee7e8"];
        for (let i = 0; i < 7; i++) {
            g.move(cycle[i % 4]);
        }
        const r = g.validateMove("ee7e8");
        expect(r.valid).to.be.true;
        expect(r.complete).to.equal(-1);
        expect(r.message).to.equal(i18next.t("apgames:validation.arimaa.REPEAT"));
        expect(() => g.move("ee7e8")).to.throw();
    });
});
