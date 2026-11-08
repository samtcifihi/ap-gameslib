import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { ArimaaGame } from "../../src/games/arimaa";
import { parseMove, parseToken } from "../../src/games/arimaa/notation";

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
});
