/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { TintasGame } from "../../src/games/tintas";
import type { IStatus } from "../../src/games/_base";
import { isStructuredRenderLabel } from "../../src/common/render-label";

function findStatus(statuses: IStatus[], key: string, seat: number): IStatus {
    const found = statuses.find((s) =>
        isStructuredRenderLabel(s.key) && s.key.textKey === key
        && s.key.actor?.kind === "seat" && s.key.actor.seat === seat);
    expect(found, `${key} for seat ${seat}`).to.not.be.undefined;
    return found!;
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
            expect(statuses).to.have.lengthOf(4);
            for (const seat of [1, 2]) {
                expect(colours(findStatus(statuses, "apgames:status.tintas.MONOCHROME", seat).value)).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);
                expect(colours(findStatus(statuses, "apgames:status.tintas.MAJORITIES", seat).value)).to.deep.equal([]);
            }
        });

        it("keeps a colour as monochrome potential only while the opponent has none of it", () => {
            const g = new TintasGame();
            g.captured = [[1, 1, 1, 1, 2, 3], [5, 2, 5, 5, 5]];
            const statuses = g.sidebarStatuses();
            expect(colours(findStatus(statuses, "apgames:status.tintas.MONOCHROME", 1).value)).to.deep.equal([1, 3, 4, 6, 7]);
            expect(colours(findStatus(statuses, "apgames:status.tintas.MONOCHROME", 2).value)).to.deep.equal([4, 5, 6, 7]);
            expect(colours(findStatus(statuses, "apgames:status.tintas.MAJORITIES", 1).value)).to.deep.equal([1]);
            expect(colours(findStatus(statuses, "apgames:status.tintas.MAJORITIES", 2).value)).to.deep.equal([5]);
        });
    });

    it("has no scores table", () => {
        expect(new TintasGame().sidebarScores()).to.deep.equal([]);
    });
});
