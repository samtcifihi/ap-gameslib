import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { ArimaaGame } from "../../src/games/arimaa";
import { parseMove, parseToken } from "../../src/games/arimaa/notation";
import { captureAlternatives, captureControlLines, captureControlSquare } from "../../src/games/arimaa/input";

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

    it("renders a clickable Advanced trap triangle and captures the cat on f3", () => {
        const g = position("Rf2,Cg2,Ra1", "ra8,ee8");
        expect(captureAlternatives(g.board, g.currplayer, 4, "g2")).to.include("f3");
        const preview = g.clone().move("g2", {partial: true});
        const advanced = preview.render({inputMode: "advanced"});
        // The piece board stays unchanged: no virtual wedge or square
        // hitbox overlaps the other 7/8 of the trap.
        expect(typeof advanced.pieces).to.equal("string");
        expect(g.board.has("f3")).to.equal(false);
        const markers = (advanced.board as {markers?: Array<{
            type: string;
            clickable?: boolean;
            colour?: unknown;
            opacity?: number;
            width?: number;
            points?: Array<{row?: number; col?: number}>;
        }>}).markers ?? [];
        const triangle = markers.filter(m => m.type === "shading");
        expect(triangle).to.have.length(1);
        expect(triangle[0].points).to.deep.equal([
            {col: 5.5, row: 5},
            {col: 6, row: 5},
            {col: 6, row: 5.5},
        ]);
        expect(triangle[0].colour).to.deep.equal({
            func: "flatten",
            fg: "_context_fill",
            bg: "_context_board",
            opacity: 0.5,
        });
        expect(triangle[0].opacity).to.equal(1);

        const hits = captureControlLines("f3");
        expect(hits).to.have.length(97);
        expect(markers.filter(m => m.type === "line" && m.clickable)).to.have.length(97);
        // Stroke centers occupy only the upper-right half-square triangle,
        // with subpixel horizontal spacing. No displaced stock wedge exists.
        for (const hit of hits.slice(0, -1)) {
            const [a, b] = hit.points;
            expect(a.row).to.equal(b.row);
            expect(a.row).to.be.greaterThan(5);
            expect(a.row).to.be.lessThan(5.5);
            expect(a.col).to.be.at.least(5.5 + (a.row - 5));
            expect(b.col).to.be.at.most(6);
            expect(hit.width).to.be.lessThan(0.3);
            expect(captureControlSquare(hit.id)).to.equal("f3");
        }
        const diagonal = hits[hits.length - 1];
        expect(diagonal.points).to.deep.equal([
            {row: 5, col: 5.5},
            {row: 5.5, col: 6},
        ]);
        expect(diagonal.width).to.equal(0.35);
        expect(captureControlSquare(diagonal.id)).to.equal("f3");
        expect(captureControlSquare("not-a-control")).to.equal(undefined);
        // Geometry regression at the renderer's default 50px cell size:
        // every pixel centre in the intended 1/8-square triangle is
        // clickable, and none of the other centres in the square is.
        const distanceToSegment = (px: number, py: number, hit: typeof hits[number]): number => {
            const [a, b] = hit.points;
            const dx = b.col - a.col;
            const dy = b.row - a.row;
            const t = Math.max(0, Math.min(1, ((px - a.col) * dx + (py - a.row) * dy) / (dx * dx + dy * dy || 1)));
            return Math.hypot(px - (a.col + t * dx), py - (a.row + t * dy));
        };
        let covered = 0;
        for (let yy = 0; yy < 50; yy++) {
            for (let xx = 0; xx < 50; xx++) {
                const px = 5 + (xx + 0.5) / 50;
                const py = 5 + (yy + 0.5) / 50;
                const inside = px >= 5.5 && py <= 5.5 && px - py >= 0.5;
                const clickable = hits.some(hit => distanceToSegment(px, py, hit) <= hit.width / 100);
                expect(clickable, `hit area at pixel (${xx}, ${yy})`).to.equal(inside);
                if (clickable) covered++;
            }
        }
        expect(covered).to.equal(325);
        const basic = preview.render({inputMode: "basic"});
        expect(typeof basic.pieces).to.equal("string");
        const basicMarkers = (basic.board as {markers?: Array<{type: string; clickable?: boolean}>}).markers ?? [];
        expect(basicMarkers.some(m => m.type === "line" && m.clickable)).to.equal(false);
        // No selection means no trap control, even in Advanced mode.
        const idle = g.render({inputMode: "advanced"});
        const idleMarkers = (idle.board as {markers?: Array<{type: string; clickable?: boolean}>}).markers ?? [];
        expect(idleMarkers.some(m => m.type === "line" && m.clickable)).to.equal(false);

        const ordinary = click(g, "g2", "f3", "advanced");
        expect(ordinary.move).to.equal("Cg2f3");
        expect(ordinary.valid).to.equal(true);
        const survives = g.clone().move(ordinary.move!);
        expect(survives.board.get("f3")).to.deep.equal(["C", 1]);

        // A marker in the triangular interior reports (-1,-1,endpoint-id).
        // Ordinary f3 clicks above must still use the default outcome.
        const special = g.handleClick("g2", -1, -1, hits[32].id, {inputMode: "advanced"});
        expect(special.valid).to.equal(true);
        expect(special.move).to.equal("Cg2f3 Cg2x");
        const captured = g.clone().move(special.move!);
        expect(captured.board.has("f3")).to.equal(false);
        expect(captured.lastmove).not.to.contain("o");

        // Ignore triangle-marker clicks when Basic mode is active.
        const basicSpecial = g.handleClick("g2", -1, -1, hits[32].id, {inputMode: "basic"});
        expect(basicSpecial.move).to.equal("g2");
        expect(g.board.has("f3")).to.equal(false);
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
});
