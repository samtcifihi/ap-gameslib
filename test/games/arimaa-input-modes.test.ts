import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { ArimaaGame } from "../../src/games/arimaa";
import { parseMove, parseToken } from "../../src/games/arimaa/notation";
import { ARIMAA_CAPTURE_CHOICE, captureAlternatives } from "../../src/games/arimaa/input";

const at = (cell: string): [number, number] => {
    const [col, row] = ArimaaGame.algebraic2coords(cell);
    return [row, col];
};
const click = (game: ArimaaGame, move: string, cell: string, mode: "basic" | "advanced" = "basic", piece?: string) =>
    game.handleClick(move, ...at(cell), piece, {inputMode: mode});

const position = (gold: string, silver: string): ArimaaGame => {
    const game = new ArimaaGame(undefined, ["free"]);
    game.move(gold);
    game.move(silver);
    return game;
};

describe("Arimaa input modes", () => {
    before(() => addResource("en"));

    it("advertises Basic first and Advanced second without changing the saved-state version", () => {
        expect(ArimaaGame.gameinfo.inputModes?.map(mode => mode.uid)).to.deep.equal(["basic", "advanced"]);
        expect(ArimaaGame.gameinfo.version).to.equal("20251223");
        const g = position("Ed4,Ra1", "ra8,ee8");
        expect(g.resolveActiveInputMode(undefined)).to.equal("basic");
        expect(g.resolveActiveInputMode("advanced")).to.equal("advanced");
    });

    it("parses arbitrarily long pending selection chains and input-only survival assertions", () => {
        const p = parseMove("Ed4e4 d4 f4 e4", true);
        expect(p.tokens).to.have.length(1);
        expect(p.selections).to.deep.equal(["d4", "f4", "e4"]);
        expect(p.pending).to.equal("e4");
        expect(parseToken("rc3o").prop.kind).to.equal("survive");
    });

    it("selects and moves an ordinary piece in Basic without automatic submission", () => {
        const g = position("Ed4,Ra1", "ra8,ee8");
        const selected = click(g, "", "d4");
        expect(selected.move).to.equal("d4");
        expect(selected.complete).to.equal(-1);
        const moved = click(g, selected.move, "e4");
        expect(moved.move).to.equal("Ed4e4");
        expect(moved.valid).to.equal(true);
        expect(moved.complete).to.equal(0);
        expect(g.validateMove(moved.move).complete).to.equal(0);
        expect(click(g, moved.move, "h2").complete).to.equal(1);
    });

    it("never infers an unselected pusher in Basic, but can do so in Advanced", () => {
        const g = position("Hg3,Cf2,Ra2,Ee1", "dh3,ra7,ee8");
        const basicSelected = click(g, "", "h3");
        expect(basicSelected.move).to.equal("h3");
        const basicMoved = click(g, basicSelected.move, "f3");
        expect(basicMoved.move).to.equal("");
        const advancedSelected = click(g, "", "h3", "advanced");
        expect(advancedSelected.move).to.equal("h3");
        const advancedMoved = click(g, advancedSelected.move, "f3", "advanced");
        expect(advancedMoved.valid).to.equal(true);
        expect(advancedMoved.move).to.equal("dh3f3");
        expect(advancedMoved.complete).to.equal(0);
    });

    it("enters an explicitly selected push and pull as ordered chains in Basic", () => {
        const g = position("Ed4,Hf4,Ra1,Cc1", "re4,ra8,ee8");
        let p = click(g, "", "d4");
        p = click(g, p.move!, "e4");
        expect(p.move).to.equal("d4 e4");
        p = click(g, p.move!, "e5");
        expect(p.valid).to.equal(true);
        expect(p.move).to.equal("re4e5 Ed4e4");
        expect(p.complete).to.equal(0);

        let pull = click(g, "", "e4");
        pull = click(g, pull.move!, "d4");
        expect(pull.move).to.equal("e4 d4");
        pull = click(g, pull.move!, "c4");
        expect(pull.valid).to.equal(true);
        expect(pull.move).to.equal("Ed4c4 re4d4");
        expect(pull.complete).to.equal(0);
    });

    it("uses immovable enemy clicks to undo the last token in both modes", () => {
        const g = position("Ed4,Ra1", "ra8,ee8");
        for (const mode of ["basic", "advanced"] as const) {
            const result = click(g, "Ed4e4", "a8", mode);
            expect(result.move, mode).to.equal("");
            expect(result.valid, mode).to.equal(true);
            expect(result.complete, mode).to.equal(-1);
            // During a selection, undo cancels selections, not a move token.
            const cancel = click(g, "Ed4e4 d4", "a8", mode);
            expect(cancel.move, mode).to.equal("Ed4e4");
        }
    });

    it("still selects a pushable enemy when a legal push is available", () => {
        const g = position("Ed4,Ra1", "re4,ra8,ee8");
        for (const mode of ["basic", "advanced"] as const) {
            const r = click(g, "", "e4", mode);
            expect(r.valid, mode).to.equal(true);
            expect(r.move, mode).to.equal("e4");
        }
    });

    it("does not select an enemy when the only remaining die step cannot complete a push", () => {
        const g = position("Ed4,Ra1", "re5,ra8,ee8");
        g.die = {steps: 2, square: "b5"};
        for (const mode of ["basic", "advanced"] as const) {
            const r = click(g, "Ed4e4", "e5", mode);
            expect(r.move, mode).to.equal("");
        }
    });

    it("uses a single custom-glyph polygon for the visible and clickable Advanced trap triangle", () => {
        const g = position("Rf2,Cg2,Ra1", "ra8,ee8");
        expect(captureAlternatives(g.board, g.currplayer, 4, "g2")).to.include("f3");
        const before = g.serialize();
        const preview = g.clone().move("g2", {partial: true});
        const advanced = preview.render({inputMode: "advanced"});

        // The custom shape has no background rectangle or separate hitbox:
        // the filled polygon is the only painted geometry. In square-relative
        // coordinates it covers exactly the upper-right 1/8 of the cell.
        const definition = advanced.glyphDefs?.["arimaa-trap-choice"];
        expect(definition?.viewBox).to.deep.equal([0, 0, 100, 100]);
        expect(definition?.markup).to.equal(
            '<polygon points="50,0 100,0 100,50" fill="#ffffff" data-slot-fill="fill"/>'
        );
        const verts = [[50, 0], [100, 0], [100, 50]];
        const area = Math.abs(verts.reduce((sum, [x, y], i) => {
            const [nx, ny] = verts[(i + 1) % verts.length];
            return sum + x * ny - nx * y;
        }, 0)) / 2;
        expect(area / (100 * 100)).to.equal(1 / 8);
        const glyph = advanced.legend?.[ARIMAA_CAPTURE_CHOICE] as {
            def?: string; scale?: number; paint?: {fill?: unknown};
        };
        expect(glyph.def).to.equal("arimaa-trap-choice");
        expect(glyph.scale).to.equal(1 / 0.85);
        expect(glyph.paint?.fill).to.deep.equal({
            func: "flatten",
            fg: "_context_fill",
            bg: "_context_board",
            opacity: 0.5,
        });
        const layers = advanced.pieces as string[][][];
        expect(layers).to.have.length(8);
        expect(layers[5][5]).to.deep.equal([ARIMAA_CAPTURE_CHOICE]); // f3
        expect(layers[5][6]).not.to.include(ARIMAA_CAPTURE_CHOICE);
        const markers = (advanced.board as {markers?: Array<{type: string; clickable?: boolean}>}).markers ?? [];
        expect(markers.filter(m => m.type === "line" && m.clickable)).to.have.length(0);
        expect(markers.filter(m => m.type === "shading")).to.have.length(0);
        expect(g.serialize()).to.equal(before); // No virtual board occupant.

        // The control is absent from Basic and from idle Advanced previews.
        const basic = preview.render({inputMode: "basic"});
        expect(basic.glyphDefs).to.equal(undefined);
        expect(typeof basic.pieces).to.equal("string");
        expect(basic.legend?.[ARIMAA_CAPTURE_CHOICE]).to.equal(undefined);
        const idle = g.render({inputMode: "advanced"});
        expect(idle.glyphDefs).to.equal(undefined);
        expect(typeof idle.pieces).to.equal("string");
        expect(idle.legend?.[ARIMAA_CAPTURE_CHOICE]).to.equal(undefined);

        const ordinary = click(g, "g2", "f3", "advanced");
        expect(ordinary.move).to.equal("Cg2f3");
        expect(ordinary.valid).to.equal(true);
        const survives = g.clone().move(ordinary.move!);
        expect(survives.board.get("f3")).to.deep.equal(["C", 1]);

        // The renderer reports (row,col,legendKey) for a custom board
        // piece, exactly as for stock sheet pieces.
        const special = g.handleClick("g2", ...at("f3"), ARIMAA_CAPTURE_CHOICE, {inputMode: "advanced"});
        expect(special.valid).to.equal(true);
        expect(special.move).to.equal("Cg2f3 Cg2x");
        const captured = g.clone().move(special.move!);
        expect(captured.board.has("f3")).to.equal(false);
        expect(captured.lastmove).not.to.contain("o");

        // Forged or out-of-mode custom-piece clicks must do nothing.
        const basicSpecial = g.handleClick("g2", ...at("f3"), ARIMAA_CAPTURE_CHOICE, {inputMode: "basic"});
        expect(basicSpecial.move).to.equal("g2");
        expect(g.handleClick("g2", ...at("c3"), ARIMAA_CAPTURE_CHOICE, {inputMode: "advanced"}).move).to.equal("g2");
    });

    it("keeps the cat alive when the rabbit reaches e3 before the cat reaches f3", () => {
        const g = position("Rf2,Cg2,Ra1", "ra8,ee8");
        g.move("Cg2f3 Rf2e3");
        expect(g.board.get("f3")).to.deep.equal(["C", 1]);
        expect(g.board.get("e3")).to.deep.equal(["R", 1]);
    });

    it("accepts both click modes with a one-step Dicey Moves limit", () => {
        const g = position("Ed4,Ra1", "ra8,ee8");
        g.die = {steps: 1, square: "c4"};
        for (const mode of ["basic", "advanced"] as const) {
            const selected = click(g, "", "d4", mode);
            const entered = click(g, selected.move, "e4", mode);
            expect(entered.valid, mode).to.equal(true);
            expect(entered.move, mode).to.equal("Ed4e4");
            expect(entered.complete, mode).to.equal(0);
        }
    });

    it("treats a same-square token as an assertion, not an obligatory round-trip", () => {
        const g = position("Ed4,Ra1", "ra8,ee8");
        const result = g.validateMove("Ed4d4 Ra1a2");
        expect(result.valid).to.equal(true);
        const before = g.clone();
        g.move("Ed4d4 Ra1a2");
        expect(g.board.get("d4")).to.deep.equal(["E", 1]);
        expect(g.board.get("a2")).to.deep.equal(["R", 1]);
        const replay = before.clone();
        replay.move(g.lastmove!);
        expect(replay.signature()).to.equal(g.signature());
    });

    it("drops input-only survival markers from stored notation", () => {
        const g = position("Ed4,Rc3,Cc2,Ra1", "ra8,ee8");
        const before = g.clone();
        const entered = "Ed4e4 Rc3o";
        expect(g.validateMove(entered).valid).to.equal(true);
        g.move(entered);
        expect(g.lastmove).not.to.contain("o");
        expect(g.board.has("c3")).to.equal(true);
        const replay = before.clone();
        replay.move(g.lastmove!);
        expect(replay.signature()).to.equal(g.signature());
    });

    it("does not auto-commit a complete four-step Lightvector or legacy move", () => {
        const g = position("Ed4,Ra1", "ra8,ee8");
        expect(g.validateMove("Ed4d5").complete).to.equal(0);
        expect(g.validateMove("Ed4d5, Ed5d6, Ed6d7, Ed7c7").complete).to.equal(0);
    });
    it("selects a frozen piece after preparatory support and a blocked piece after clearing space", () => {
        const frozen = position("Rc4,Eb3,Ra1", "ec5,ra8");
        expect(click(frozen, "", "c4").move).to.equal("c4");
        let support = click(frozen, "", "b3");
        support = click(frozen, support.move!, "c3");
        expect(support.move).to.equal("Eb3c3");
        let rabbit = click(frozen, support.move!, "c4");
        expect(rabbit.move).to.equal("Eb3c3 c4");
        rabbit = click(frozen, rabbit.move!, "d4");
        expect(rabbit.valid).to.equal(true);
        expect(frozen.clone().move(rabbit.move!).board.get("d4")).to.deep.equal(["R", 1]);

        const blocked = position("Rb1,Rb2,Ra1,Rc1,Ee2", "ra8,ee8");
        expect(click(blocked, "", "b1").move).to.equal("b1");
        const oneStep = position("Rc4,Eb3,Ra1", "ec5,ra8");
        oneStep.die = {steps: 1, square: "a4"};
        expect(click(oneStep, "", "c4").move).to.equal("");
    });

    it("accepts rabbit and cat trap support in either click-entry order in Basic", () => {
        for (const squares of [["f2", "f3", "e2", "e3"], ["e2", "e3", "f2", "f3"]]) {
            const game = position("Re2,Cf2", "rb7,mc7");
            let move = "";
            for (const square of squares) {
                const result = click(game, move, square);
                expect(result.valid, square).to.equal(true);
                move = result.move!;
            }
            expect(game.validateMove(move).valid, squares.join(" ")).to.equal(true);
            const played = game.clone().move(move);
            expect(played.board.get("e3")).to.deep.equal(["R", 1]);
            expect(played.board.get("f3")).to.deep.equal(["C", 1]);
        }
    });

    it("keeps selection highlighting available while notation is ambiguous", () => {
        const game = position("Ed4,Hf4,Ra1", "re4,ra8,ee8");
        expect(game.validateMove("re4e5").complete).to.equal(-1);
        const selected = click(game, "re4e5", "d4");
        expect(selected.valid).to.equal(true);
        expect(selected.move).to.equal("re4e5 d4");
        expect(selected.canrender).to.equal(true);
        const preview = game.clone().move(selected.move!, {partial: true});
        const markers = (preview.render().board as {
            markers?: Array<{type: string; points?: Array<{row: number; col: number}>}>;
        }).markers ?? [];
        expect(markers.some(marker => marker.type === "flood" &&
            marker.points?.some(({row, col}) => ArimaaGame.coords2algebraic(col, row) === "d4"))).to.equal(true);
    });

    it("preserves placed pieces when another piece is selected from either setup tray", () => {
        for (const variants of [[], ["free"]]) {
            const game = new ArimaaGame(undefined, variants);
            const selected = game.handleClick("Ee2", -1, -1, "pC1");
            expect(selected.move).to.equal("Ee2,C");
            expect(selected.canrender).to.equal(true);
            const preview = game.clone().move(selected.move!, {partial: true});
            expect(preview.board.get("e2")).to.deep.equal(["E", 1]);
            expect(preview.render().pieces).to.be.a("string").and.include("E1");
        }
    });

    it("completes the supplied partially ambiguous horse-and-rabbit move on an empty square", () => {
        const game = position("Ha2,Hh2,Dd2,De1,Cg2,Rc2,Ra1,Rf1,Rg1,Rh1,Cb2,Rb1,Rc1,Re2,Ee5", "hg7,ra7,ra8,rb8,rf8,rg8,rh8,rh7,dd8,cc7,cf7,rc8,md6,eb5,de4,hb6");
        const move = "Hh2f3 Re2f2";
        expect(game.validateMove(move).valid).to.equal(true);
        const completed = click(game, move, "a4", "advanced");
        expect(completed.valid).to.equal(true);
        expect(completed.complete).to.equal(1);
        expect(completed.move).not.to.equal("");
        const before = game.clone();
        game.move(completed.move!);
        expect(game.board.get("f3")).to.deep.equal(["H", 1]);
        expect(game.board.get("f2")).to.deep.equal(["R", 1]);
        expect(before.validateMove(completed.move!).valid).to.equal(true);
    });

    it("honours every explicitly selected link of the horse-over-elephant push chain", () => {
        const game = position("Ha2,Dd2,De1,Cg2,Rc2,Ra1,Rf1,Rg1,Rh1,Cb2,Rb1,Rc1,Ee5,Rf2,Hf3", "hg7,ra7,ra8,rb8,rf8,rg8,rh8,cc7,cf7,rc8,md6,eb5,de4,hb6,rh4,dd7");
        let result = click(game, "", "f3", "advanced");
        expect(result.move).to.equal("f3");
        result = click(game, result.move!, "e4", "advanced");
        expect(result.move).to.equal("f3 e4");
        result = click(game, result.move!, "d4", "advanced");
        expect(result.valid).to.equal(true);
        expect(result.move).to.contain("Hf3e4");
        expect(result.move).to.contain("de4d4");
        const after = game.clone().move(result.move!);
        expect(after.board.get("e4")).to.deep.equal(["H", 1]);
        expect(after.board.get("d4")).to.deep.equal(["D", 2]);
        expect(after.board.get("e5")).to.deep.equal(["E", 1]);
    });

    it("allows a different explicitly selected pusher after an inferred dog flip", () => {
        const game = position("Ha2,Dd2,De1,Cg2,Rc2,Ra1,Rf1,Rg1,Rh1,Cb2,Rb1,Rc1,Ee5,Rf2,He3", "hg7,ra7,ra8,rb8,rf8,rg8,rh8,cc7,cf7,md6,eb5,de4,hb6,rh4,dd7,rd8");
        let result = click(game, "", "e4", "advanced");
        result = click(game, result.move!, "f3", "advanced");
        expect(result.valid).to.equal(true);
        const dogMove = result.move!;
        for (const pusher of ["e5", "e3"]) {
            const selected = click(game, dogMove, pusher, "advanced");
            expect(selected.valid, pusher).to.equal(true);
            expect(selected.move, pusher).to.equal(`${dogMove} ${pusher}`);
            const directed = click(game, selected.move!, "f4", "advanced");
            expect(directed.valid, pusher).to.equal(true);
            const after = game.clone().move(directed.move!);
            expect(after.board.get("f3"), pusher).to.deep.equal(["D", 2]);
            expect(after.board.get("f4"), pusher).to.deep.equal([pusher === "e5" ? "E" : "H", 1]);
        }
    });

});
