import "mocha";
import { expect } from "chai";
import { TintasGame } from "../../src/games/tintas";
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

describe("Tintas", () => {
    describe("sidebarStatuses", () => {
        it("lists every colour as monochrome potential and no majorities at the start", () => {
            const statuses = new TintasGame().sidebarStatuses();
            expect(statuses).to.have.lengthOf(6);
            const [mono1, mono2] = section(statuses, "apgames:status.tintas.MONOCHROME");
            expect(colours(mono1)).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);
            expect(colours(mono2)).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);
            expect(section(statuses, "apgames:status.tintas.MAJORITIES")).to.deep.equal([[], []]);
        });

        it("keeps a colour as monochrome potential only while the opponent has none of it", () => {
            const g = new TintasGame();
            g.captured = [[1, 1, 1, 1, 2, 3], [5, 2, 5, 5, 5]];
            const statuses = g.sidebarStatuses();
            const [mono1, mono2] = section(statuses, "apgames:status.tintas.MONOCHROME");
            expect(colours(mono1)).to.deep.equal([1, 3, 4, 6, 7]);
            expect(colours(mono2)).to.deep.equal([4, 5, 6, 7]);
            const [maj1, maj2] = section(statuses, "apgames:status.tintas.MAJORITIES");
            expect(colours(maj1)).to.deep.equal([1]);
            expect(colours(maj2)).to.deep.equal([5]);
        });
    });

    it("has no scores table", () => {
        expect(new TintasGame().sidebarScores()).to.deep.equal([]);
    });
});
