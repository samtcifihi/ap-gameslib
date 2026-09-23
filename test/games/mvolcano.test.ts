import "mocha";
import { expect } from "chai";
import { MvolcanoGame, CellContents } from "../../src/games/mvolcano";
import type { IStatus } from "../../src/games/_base";
import { isStructuredRenderLabel } from "../../src/common/render-label";

// Each aid is a title row with no value, then a row for each seat keyed by the player's name
function section(statuses: IStatus[], title: string): [unknown[], unknown[]] {
    const idx = statuses.findIndex((s) => isStructuredRenderLabel(s.key) && s.key.textKey === title);
    expect(idx, title).to.be.at.least(0);
    const [head, p1, p2] = statuses.slice(idx, idx + 3);
    expect(head.value).to.deep.equal([]);
    [p1, p2].forEach((row, i) => {
        expect(isStructuredRenderLabel(row.key) && row.key.textKey).to.equal("apgames:status._player");
        expect(isStructuredRenderLabel(row.key) && row.key.actor).to.deep.equal({ kind: "seat", seat: i + 1 });
    });
    return [p1.value, p2.value];
}

function colours(values: unknown[]): number[] {
    return (values as { glyph: string, colour: number }[]).map((v) => {
        expect(v.glyph).to.equal("piece");
        return v.colour;
    });
}

describe("Mega-Volcano", () => {
    describe("sidebarStatuses", () => {
        it("lists every colour as uncaptured and no pyramids captured at the start", () => {
            const statuses = new MvolcanoGame().sidebarStatuses();
            expect(statuses).to.have.lengthOf(6);
            const [un1, un2] = section(statuses, "apgames:status.mvolcano.UNCAPTUREDCOLOURS");
            expect(colours(un1)).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);
            expect(colours(un2)).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);
            expect(section(statuses, "apgames:status.mvolcano.PYRAMIDSCAPTURED")).to.deep.equal([["0"], ["0"]]);
        });

        it("drops captured colours in palette order and counts white pyramids", () => {
            const g = new MvolcanoGame();
            g.captured = [
                [["RD", 1], ["WH", 2], ["GN", 3], ["RD", 2]] as CellContents[],
                [["BN", 1]] as CellContents[],
            ];
            const statuses = g.sidebarStatuses();
            const [un1, un2] = section(statuses, "apgames:status.mvolcano.UNCAPTUREDCOLOURS");
            expect(colours(un1)).to.deep.equal([2, 4, 5, 6, 7]);
            expect(colours(un2)).to.deep.equal([1, 2, 3, 4, 5, 6]);
            expect(section(statuses, "apgames:status.mvolcano.PYRAMIDSCAPTURED")).to.deep.equal([["4"], ["1"]]);
        });
    });

    it("keeps the scores table to the scores alone", () => {
        const scores = new MvolcanoGame().sidebarScores();
        expect(scores).to.have.lengthOf(1);
        expect(isStructuredRenderLabel(scores[0].name) && scores[0].name.textKey).to.equal("apgames:status.SCORES");
    });
});
