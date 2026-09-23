/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { MvolcanoGame, CellContents } from "../../src/games/mvolcano";
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

describe("Mega-Volcano", () => {
    describe("sidebarStatuses", () => {
        it("lists every colour as uncaptured and no pyramids captured at the start", () => {
            const statuses = new MvolcanoGame().sidebarStatuses();
            expect(statuses).to.have.lengthOf(4);
            for (const seat of [1, 2]) {
                expect(colours(findStatus(statuses, "apgames:status.mvolcano.UNCAPTUREDCOLOURS", seat).value)).to.deep.equal([1, 2, 3, 4, 5, 6, 7]);
                expect(findStatus(statuses, "apgames:status.mvolcano.PYRAMIDSCAPTURED", seat).value).to.deep.equal(["0"]);
            }
        });

        it("drops captured colours in palette order and counts white pyramids", () => {
            const g = new MvolcanoGame();
            g.captured = [
                [["RD", 1], ["WH", 2], ["GN", 3], ["RD", 2]] as CellContents[],
                [["BN", 1]] as CellContents[],
            ];
            const statuses = g.sidebarStatuses();
            expect(colours(findStatus(statuses, "apgames:status.mvolcano.UNCAPTUREDCOLOURS", 1).value)).to.deep.equal([2, 4, 5, 6, 7]);
            expect(colours(findStatus(statuses, "apgames:status.mvolcano.UNCAPTUREDCOLOURS", 2).value)).to.deep.equal([1, 2, 3, 4, 5, 6]);
            expect(findStatus(statuses, "apgames:status.mvolcano.PYRAMIDSCAPTURED", 1).value).to.deep.equal(["4"]);
            expect(findStatus(statuses, "apgames:status.mvolcano.PYRAMIDSCAPTURED", 2).value).to.deep.equal(["1"]);
        });
    });

    it("keeps the scores table to the scores alone", () => {
        const scores = new MvolcanoGame().sidebarScores();
        expect(scores).to.have.lengthOf(1);
        expect(isStructuredRenderLabel(scores[0].name) && scores[0].name.textKey).to.equal("apgames:status.SCORES");
    });
});
