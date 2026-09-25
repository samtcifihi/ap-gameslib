/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { addResource } from "../../src";
import { assertChatLogParity } from "../fixtures/chat/helpers";
import {
    BOARD_CELLS,
    RESERVES,
    SquaresGame,
    connectedTo,
    diagonalTo,
    distance,
    type playerid,
} from "../../src/games/squares";

/** Put a unit somewhere (call `commit` afterwards if the position must survive a clone). */
const place = (g: SquaresGame, id: string, loc: string): void => {
    g.unit(id).loc = loc;
};

/** Spread a player's reserve over the given cells, leaving any extra units in the reserve. */
const evacuate = (g: SquaresGame, player: playerid, cells: string[]): void => {
    const pool = [...cells];
    for (const u of g.reserveUnits(player)) {
        const cell = pool.shift();
        if (cell !== undefined) {
            u.loc = cell;
        }
    }
};

const commit = (g: SquaresGame): SquaresGame => {
    g.stack[0] = g.moveState();
    return g;
};

const alive = (g: SquaresGame, id: string): boolean => g.unit(id).loc !== "X";

describe("Squares: board geometry", () => {
    it("names thirty cells and two reserves", () => {
        expect(BOARD_CELLS.length).to.equal(30);
        expect(RESERVES[1]).to.equal("BR");
        expect(RESERVES[2]).to.equal("GR");
    });

    it("connects cells that share any length of edge", () => {
        expect(connectedTo("B3R")).to.include.members(["B3C", "B2R", "B2CR", "NWF", "BR"]);
        expect(connectedTo("B3R")).to.not.include("B2CL");
        expect(connectedTo("B2L")).to.include.members(["B3L", "B2CL", "B1L", "NEF", "EF"]);
        expect(connectedTo("B2R")).to.include.members(["B1R", "NWF", "WF"]);
        expect(connectedTo("B1R")).to.include.members(["G1L", "B1CR", "WF", "B2R", "B2CR"]);
        expect(connectedTo("B1R")).to.not.include("G1R");
        expect(connectedTo("NWF")).to.have.members(["B3R", "B2R", "WF", "SWF"]);
        expect(connectedTo("WF")).to.have.members(["NWF", "SWF", "B2R", "B1R", "G1L", "G2L"]);
    });

    it("only has diagonals between the two centre rows", () => {
        expect(diagonalTo("B1R")).to.have.members(["G1CL"]);
        expect(diagonalTo("B1C")).to.have.members(["G1CL", "G1CR"]);
        expect(diagonalTo("G1L")).to.have.members(["B1CR"]);
        for (const cell of BOARD_CELLS) {
            if (diagonalTo(cell).length > 0) {
                expect(cell.startsWith("B1") || cell.startsWith("G1"), cell).to.be.true;
            }
        }
    });

    it("attaches each reserve to its three back-line squares only", () => {
        expect(connectedTo("BR")).to.have.members(["B3R", "B3C", "B3L"]);
        expect(connectedTo("GR")).to.have.members(["G3L", "G3C", "G3R"]);
        expect(diagonalTo("BR")).to.be.empty;
    });

    it("measures distance from the centre of each square", () => {
        expect(distance("B3C", 1)).to.equal(25);
        expect(distance("B1L", 1)).to.equal(125);
        expect(distance("NWF", 1)).to.equal(100);
        expect(distance("WF", 1)).to.equal(150);
        expect(distance("WF", 2)).to.equal(150);
        expect(distance("SWF", 1)).to.equal(200);
        expect(distance("G3C", 2)).to.equal(25);
        expect(distance("BR", 1)).to.be.lessThan(distance("B3C", 1));
    });
});

describe("Squares: setup and basic movement", () => {
    it("starts with sixteen units per side in reserve and Blue to move", () => {
        const g = new SquaresGame();
        for (const p of [1, 2] as playerid[]) {
            const reserve = g.reserveUnits(p);
            expect(reserve.length).to.equal(16);
            expect(reserve.filter(u => u.type === "I").length).to.equal(9);
            expect(reserve.filter(u => u.type === "A").length).to.equal(3);
            expect(reserve.filter(u => u.type === "C").length).to.equal(4);
        }
        expect(g.currplayer).to.equal(1);
        const moves = g.moves();
        expect(moves).to.include.members(["pass", "IBR-B3L", "ABR-B3C", "CBR-B3R", "CBR-B3L-B2L", "CBR-B3L,CBR-B3C"]);
        expect(moves.some(m => m.includes(">"))).to.be.false;
        expect(moves.filter(m => m === "IBR-B3L").length).to.equal(1);
    });

    it("moves infantry orthogonally only, one square", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        const mine = g.moves().filter(m => m.startsWith("IB1C"));
        expect(mine).to.have.members(["IB1C-B1CL", "IB1C-B1CR", "IB1C-G1C", "IB1C-B2CL", "IB1C-B2CR"]);
        expect(g.validateMove("IB1C-G1CL").valid).to.be.false;
    });

    it("lets cavalry go two squares, diagonally, or one square into a forest", () => {
        const g = new SquaresGame();
        place(g, "1C1", "B2L");
        const mine = g.moves().filter(m => m.startsWith("CB2L"));
        expect(mine).to.include.members(["CB2L-B1L-G1R", "CB2L-B1L-G1CR", "CB2L-EF", "CB2L-B3L-BR", "CB2L-B1L"]);
        expect(mine).to.not.include("CB2L-B1L-G1L");
        expect(mine.some(m => m.startsWith("CB2L-EF-"))).to.be.false;
        expect(g.validateMove("CB2L-B1L-B2L").valid).to.be.false;
    });

    it("lets cavalry pass through its own reserve", () => {
        const g = new SquaresGame();
        place(g, "1C1", "B3L");
        expect(g.moves()).to.include("CB3L-BR-B3R");
        g.move("CB3L-BR-B3R");
        expect(g.unit("1C1").loc).to.equal("B3R");
    });

    it("moves two cavalry in either order, and lets the second use the first's square", () => {
        const g = new SquaresGame();
        expect(g.validateMove("CBR-B3L,CBR-B3C").valid).to.be.true;
        expect(g.validateMove("CBR-B3C,CBR-B3L").valid).to.be.true;
        place(g, "1C1", "B2L");
        place(g, "1C2", "B3L");
        expect(g.validateMove("CB2L-B1L,CB3L-B2L").valid).to.be.true;
        expect(g.validateMove("CB3L-B2L,CB2L-B1L").valid).to.be.false;
        expect(g.validateMove("CB2L-B1L,CB2L-B1CL").valid).to.be.false;
        g.move("CB2L-B1L,CB3L-B2L");
        expect(g.unit("1C1").loc).to.equal("B1L");
        expect(g.unit("1C2").loc).to.equal("B2L");
        expect(g.currplayer).to.equal(2);
    });

    it("keeps infantry and artillery out of forests without a double turn", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B2R");
        place(g, "1A1", "B2L");
        expect(g.validateMove("IB2R-NWF").valid).to.be.false;
        expect(g.validateMove("AB2L-EF").valid).to.be.false;
        expect(g.moves()).to.include("IB2R-B1R");
        g.move("pass");
        g.move("IGR-G3C");
        expect(g.isDouble).to.be.true;
        expect(g.moves()).to.include.members(["IB2R-NWF", "AB2L-EF"]);
        g.move("IB2R-NWF");
        expect(g.unit("1I1").loc).to.equal("NWF");
        // the whole double turn is spent
        expect(g.currplayer).to.equal(2);
        expect(g.unit("1I1").moveStreak).to.equal(2);
    });

    it("lets infantry move diagonally only with a double move", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "2I1", "G1C");
        expect(g.validateMove("IB1C-G1CL").valid).to.be.false;
        g.move("pass");
        g.move("IGR-G3C");
        expect(g.moves()).to.include("IB1C-G1CL");
        g.move("IB1C-G1CL");
        expect(g.unit("1I1").loc).to.equal("G1CL");
        expect(g.currplayer).to.equal(2);
    });

    it("forbids passing during a double turn and gives it two actions", () => {
        const g = new SquaresGame();
        g.move("pass");
        expect(g.currplayer).to.equal(2);
        g.move("IGR-G3C");
        expect(g.currplayer).to.equal(1);
        expect(g.isDouble).to.be.true;
        expect(g.actionsLeft).to.equal(2);
        expect(g.validateMove("pass").valid).to.be.false;
        g.move("IBR-B3C");
        expect(g.currplayer).to.equal(1);
        expect(g.actionsLeft).to.equal(1);
        g.move("IB3C-B2CL");
        expect(g.currplayer).to.equal(2);
        expect(g.isDouble).to.be.false;
        expect(g.validateMove("pass").valid).to.be.true;
    });

    it("wins by entering an empty enemy reserve", () => {
        const g = new SquaresGame();
        evacuate(g, 2, ["G2L", "G2CL", "G2CR", "G2R", "G1L", "G1CL", "G1C", "G1CR", "G1R", "SWF", "SEF", "WF", "EF", "B2L", "B2R", "B3R"]);
        place(g, "1I1", "G3C");
        expect(g.moves()).to.include("IG3C-GR");
        g.move("IG3C-GR");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });
});

describe("Squares: consecutive-turn limits and freezes", () => {
    it("stops a unit moving on a third consecutive turn", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B3C");
        g.move("IB3C-B2CL");
        g.move("IGR-G3C");
        g.move("IB2CL-B1C");
        g.move("IG3C-G2CL");
        expect(g.unit("1I1").moveStreak).to.equal(2);
        expect(g.moves().some(m => m.startsWith("IB1C-"))).to.be.false;
        expect(g.validateMove("IB1C-B1CL").valid).to.be.false;
        g.move("IBR-B3L");
        g.move("IGR-G3C");
        expect(g.moves()).to.include("IB1C-B1CL");
    });

    it("follows the rulebook example: a pass resets the count, a double turn counts as two turns", () => {
        const g = new SquaresGame();
        place(g, "1C1", "B3C");
        g.move("CB3C-B2CL");
        g.move("IGR-G3C");
        g.move("pass");
        g.move("IG3C-G2CL");
        g.move("CB2CL-B1C");
        g.move("CB1C-B1CL");
        expect(g.currplayer).to.equal(2);
        g.move("IGR-G3C");
        expect(g.moves().some(m => m.startsWith("CB1CL-"))).to.be.false;
        expect(g.canMove(g.unit("1C1"))).to.be.false;
        expect(g.canAttack(g.unit("1C1"))).to.be.true;
    });

    it("freezes a retreated infantry for its owner's next turn only", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "2I1", "G1C");
        evacuate(g, 2, ["G2L", "G2CL", "G2CR", "G2R", "G1L", "G1CL", "G1CR", "G1R", "SWF", "SEF", "WF", "EF", "NWF", "NEF", "B2R"]);
        g.move("IB1C>IG1C");
        expect(g.currplayer).to.equal(2);
        expect(g.moves()).to.have.members(["stand", "retreat:IG1C-GR"]);
        g.move("retreat:IG1C-GR");
        expect(g.unit("2I1").loc).to.equal("GR");
        expect(g.currplayer).to.equal(2);
        expect(g.canMove(g.unit("2I1"))).to.be.false;
        expect(g.moves().some(m => m.startsWith("IGR-"))).to.be.false;
        g.move("CB2R-B3R");
        g.move("IBR-B3L");
        expect(g.canMove(g.unit("2I1"))).to.be.true;
        expect(g.moves()).to.include("IGR-G3C");
    });
});

describe("Squares: attacks", () => {
    it("eliminates both units when an unsupported attack is met by a stand", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "2I1", "G1C");
        g.move("IB1C>IG1C");
        g.move("stand");
        expect(alive(g, "1I1")).to.be.false;
        expect(alive(g, "2I1")).to.be.false;
        expect(g.combat).to.be.undefined;
        expect(g.currplayer).to.equal(2);
        expect(g.points(1)).to.equal(1);
        expect(g.points(2)).to.equal(1);
    });

    it("never lets cavalry attack infantry unsupported, and never lets artillery attack anything but artillery", () => {
        const g = new SquaresGame();
        place(g, "1C1", "B1R");
        place(g, "1I1", "B1CR");
        place(g, "2I1", "G1L");
        let moves = g.moves();
        expect(moves).to.not.include("CB1R>IG1L");
        expect(moves).to.include("CB1R+IB1CR>IG1L");
        // B1CR only touches G1L at a corner, so the infantry may support but never attack it
        expect(moves).to.not.include("IB1CR>IG1L");
        // the unsupported attack is a legal step towards the supported one, but cannot be submitted
        expect(g.validateMove("CB1R>IG1L").complete).to.equal(-1);
        expect(() => g.move("CB1R>IG1L")).to.throw();
        let click = g.handleClick("", 2, 0);
        click = g.handleClick(click.move, 2, 9);
        expect(click.move).to.equal("CB1R>IG1L");
        expect(click.complete).to.equal(-1);
        click = g.handleClick(click.move, 2, 1);
        expect(click.move).to.equal("CB1R+IB1CR>IG1L");
        expect(click.complete).to.equal(1);
        place(g, "1I1", "BR");
        expect(g.validateMove("CB1R>IG1L").valid).to.be.false;

        const h = new SquaresGame();
        place(h, "1A1", "B1C");
        place(h, "1A2", "B1L");
        place(h, "2A1", "G1C");
        place(h, "2I1", "G1R");
        moves = h.moves();
        expect(moves).to.include("AB1C>AG1C");
        expect(moves).to.not.include("AB1L>IG1R");
        expect(moves).to.not.include("AB1L+AB1C>IG1R");
    });

    it("pins units next to enemy artillery", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "1I2", "B1CR");
        place(g, "2I1", "G1CL");
        place(g, "2I2", "G1C");
        place(g, "2A1", "G1CR");
        // B1C touches G1CR only at a corner, so it can neither attack the guns nor anything else
        expect(g.moves().some(m => m.startsWith("IB1C>") || m.startsWith("IB1C+"))).to.be.false;
        expect(g.moves()).to.not.include("IB1CR+IB1C>IG1CL");
        expect(g.moves()).to.include("IB1CR>IG1CL");
        // a unit sharing an edge with the guns may attack them and nothing else
        place(g, "1I3", "B1CL");
        expect(g.moves()).to.include("IB1CL>AG1CR");
        expect(g.moves()).to.not.include("IB1CL>IG1C");
        // artillery in a reserve pins nothing
        place(g, "2A1", "GR");
        expect(g.moves()).to.include("IB1C>IG1C");
        expect(g.moves()).to.include("IB1CR+IB1C>IG1CL");
    });

    it("throws away an unsupported attacker against a forest or against artillery", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1R");
        place(g, "2I1", "WF");
        g.move("IB1R>IWF");
        expect(alive(g, "1I1")).to.be.false;
        expect(alive(g, "2I1")).to.be.true;
        expect(g.currplayer).to.equal(2);
        g.move("pass");
        place(g, "1I2", "B1C");
        place(g, "2A1", "G1C");
        g.move("IB1C>AG1C");
        expect(alive(g, "1I2")).to.be.false;
        expect(alive(g, "2A1")).to.be.true;
    });

    it("lets unsupported artillery and defending artillery destroy each other", () => {
        const g = new SquaresGame();
        place(g, "1A1", "B1C");
        place(g, "2A1", "G1C");
        g.move("AB1C>AG1C");
        expect(alive(g, "1A1")).to.be.false;
        expect(alive(g, "2A1")).to.be.false;
    });

    it("offers the attacker the rulebook options when a supported attack is stood", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "1C1", "B1CL");
        place(g, "2I1", "G1C");
        g.move("IB1C+CB1CL>IG1C");
        expect(g.currplayer).to.equal(2);
        g.move("stand");
        expect(g.currplayer).to.equal(1);
        expect(g.combat!.stage).to.equal("resolve");
        expect(g.moves()).to.have.members(["option1:CB1CL-B2CL", "option2", "option3", "option4", "option5:CB1CL-B2CL"]);
        g.move("option2");
        expect(alive(g, "2I1")).to.be.false;
        expect(alive(g, "1C1")).to.be.false;
        expect(g.combat!.stage).to.equal("advance");
        expect(g.moves()).to.have.members(["advance", "stay"]);
        g.move("advance");
        expect(g.unit("1I1").loc).to.equal("G1C");
        expect(g.currplayer).to.equal(2);
    });

    it("denies attacking cavalry the retreat options", () => {
        const g = new SquaresGame();
        place(g, "1C1", "B1C");
        place(g, "1I1", "B1CL");
        place(g, "2I1", "G1C");
        g.move("CB1C+IB1CL>IG1C");
        g.move("stand");
        expect(g.moves()).to.have.members(["option2", "option3", "option5"]);
        g.move("option5");
        expect(g.unit("1I1").loc).to.equal("BR");
        expect(alive(g, "2I1")).to.be.true;
        expect(g.combat).to.be.undefined;
    });

    it("gives the defender a second chance when supporting artillery withdraws under option 1", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "1A1", "B1CL");
        place(g, "2I1", "G1C");
        g.move("IB1C+AB1CL>IG1C");
        g.move("stand");
        expect(g.moves()).to.include("option1");
        g.move("option1");
        expect(g.unit("1A1").loc).to.equal("BR");
        expect(g.combat!.stage).to.equal("second");
        expect(g.currplayer).to.equal(2);
        expect(g.moves()).to.have.members(["stand", "retreat:IG1C-GR"]);
        g.move("retreat:IG1C-GR");
        expect(alive(g, "2I1")).to.be.true;
        expect(g.combat!.stage).to.equal("advance");
        g.move("stay");
        expect(g.unit("1I1").loc).to.equal("B1C");
        expect(g.currplayer).to.equal(2);
    });

    it("eliminates a defender that stands again after the second chance, and retreats the attacker", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "1A1", "B1CL");
        place(g, "2I1", "G1C");
        g.move("IB1C+AB1CL>IG1C");
        g.move("stand");
        g.move("option1");
        g.move("stand");
        expect(alive(g, "2I1")).to.be.false;
        expect(g.unit("1I1").loc).to.equal("BR");
        expect(g.combat).to.be.undefined;
    });

    it("resolves a flank attack: forced retreat, or elimination at no cost", () => {
        const g = new SquaresGame();
        place(g, "1C1", "G3C");
        place(g, "1I1", "G1C");
        place(g, "2I1", "G2CL");
        g.move("CG3C+IG1C>IG2CL");
        // the retreat is forced and unique, so it happens at once
        expect(g.unit("2I1").loc).to.equal("GR");
        expect(g.combat!.stage).to.equal("advance");
        g.move("advance");
        expect(g.unit("1C1").loc).to.equal("G2CL");

        const h = new SquaresGame();
        place(h, "1C1", "G3C");
        place(h, "1I1", "G1C");
        place(h, "1I2", "G3L");
        place(h, "2I1", "G2CL");
        h.move("CG3C+IG1C>IG2CL");
        expect(alive(h, "2I1")).to.be.false;
        expect(alive(h, "1C1")).to.be.true;
        expect(alive(h, "1I1")).to.be.true;
        expect(h.combat!.stage).to.equal("advance");
    });

    it("answers the rulebook FAQ: flanked artillery outside a forest simply dies", () => {
        const g = new SquaresGame();
        g.move("pass");
        place(g, "1A1", "B1L");
        place(g, "2C1", "B2L");
        place(g, "2C2", "B1CL");
        g.move("CB2L+CB1CL>AB1L");
        expect(alive(g, "1A1")).to.be.false;
        expect(alive(g, "2C1")).to.be.true;
        expect(alive(g, "2C2")).to.be.true;
        expect(g.combat!.stage).to.equal("advance");
        g.move("advance");
        expect(g.unit("2C1").loc).to.equal("B1L");
    });
});

describe("Squares: retreats", () => {
    it("makes attacked cavalry retreat, displacing friends when nothing is vacant", () => {
        const g = new SquaresGame();
        place(g, "1C1", "B1C");
        place(g, "1I1", "B1CL");
        place(g, "2C1", "G1C");
        place(g, "2I1", "G2CL");
        place(g, "2I2", "G2CR");
        g.move("CB1C+IB1CL>CG1C");
        expect(g.currplayer).to.equal(2);
        expect(g.moves()).to.have.members(["retreat:CG1C-G2CL,IG2CL-GR", "retreat:CG1C-G2CR,IG2CR-GR"]);
        g.move("retreat:CG1C-G2CL,IG2CL-GR");
        expect(g.unit("2C1").loc).to.equal("G2CL");
        expect(g.unit("2I1").loc).to.equal("GR");
        expect(g.canMove(g.unit("2I1"))).to.be.false;
        expect(g.canMove(g.unit("2C1"))).to.be.true;
        expect(g.combat!.stage).to.equal("advance");
    });

    it("lets cavalry stand against unsupported cavalry, in a forest, or when it cannot retreat", () => {
        const g = new SquaresGame();
        place(g, "1C1", "B1C");
        place(g, "2C1", "G1C");
        g.move("CB1C>CG1C");
        expect(g.moves()).to.include("stand");
        expect(g.moves()).to.include("retreat:CG1C-G2CL");

        const h = new SquaresGame();
        place(h, "1C1", "B1C");
        place(h, "1I1", "B1CL");
        place(h, "2C1", "G1C");
        place(h, "2A1", "G2CL");
        place(h, "2A2", "G2CR");
        place(h, "1I2", "G3L");
        place(h, "1I3", "G3C");
        place(h, "1I4", "G3R");
        h.move("CB1C+IB1CL>CG1C");
        // both squares behind are friendly artillery with no clear path, so the cavalry must stand
        expect(h.combat!.stage).to.equal("resolve");
        expect(h.currplayer).to.equal(1);
    });

    it("lets infantry attacked in a forest fall back into a closer forest", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1R");
        place(g, "1C1", "B2R");
        place(g, "2I1", "WF");
        g.move("IB1R+CB2R>IWF");
        expect(g.moves()).to.have.members(["stand", "retreat:IWF-GR", "retreat:IWF-SWF"]);
        g.move("retreat:IWF-SWF");
        expect(g.unit("2I1").loc).to.equal("SWF");
    });

    it("blocks a clear path with enemy units but not with friendly ones", () => {
        const g = new SquaresGame();
        place(g, "2I1", "G1CL");
        place(g, "2I2", "G2CL");
        expect(g.hasClearPath(g.unit("2I1"))).to.be.true;
        place(g, "1I1", "G3L");
        place(g, "1I2", "G3C");
        expect(g.hasClearPath(g.unit("2I1"))).to.be.false;
        place(g, "1I2", "X");
        expect(g.hasClearPath(g.unit("2I1"))).to.be.true;
        place(g, "1I3", "G2CL");
        place(g, "2I2", "GR");
        expect(g.hasClearPath(g.unit("2I1"))).to.be.false;
    });
});

describe("Squares: reserves and winning", () => {
    it("lets the reserve's owner choose which unit type is lost", () => {
        const g = new SquaresGame();
        place(g, "1I1", "G3C");
        g.move("IG3C>GR");
        expect(g.currplayer).to.equal(2);
        expect(g.moves()).to.have.members(["lose:I", "lose:A", "lose:C"]);
        g.move("lose:A");
        expect(g.reserveUnits(2).filter(u => u.type === "A").length).to.equal(2);
        expect(alive(g, "1I1")).to.be.true;
        expect(g.combat).to.be.undefined;
        expect(g.currplayer).to.equal(2);
    });

    it("lets a supported attack that empties the reserve advance into it and win", () => {
        const g = new SquaresGame();
        evacuate(g, 2, ["G2L", "G2CL", "G2CR", "G2R", "G1L", "G1CL", "G1C", "G1CR", "G1R", "B2L", "B2R", "B3R", "SWF", "SEF", "WF"]);
        expect(g.reserveUnits(2).length).to.equal(1);
        place(g, "1I1", "G3C");
        place(g, "1I2", "G3L");
        g.move("IG3C+IG3L>GR");
        expect(g.reserveUnits(2).length).to.equal(0);
        expect(g.combat!.stage).to.equal("advance");
        g.move("advance");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1]);
    });

    it("scores artillery double and cavalry double once three are lost, per the rulebook example", () => {
        const g = new SquaresGame();
        g.move("pass");
        // Blue has lost 1 artillery, 2 cavalry and 4 infantry; Gray 1 artillery, 2 cavalry and 5 infantry.
        for (const id of ["1A1", "1C1", "1C2", "1I1", "1I2", "1I3", "1I4"]) {
            place(g, id, "X");
        }
        for (const id of ["2A1", "2C1", "2C2", "2I1", "2I2", "2I3", "2I4", "2I5"]) {
            place(g, id, "X");
        }
        expect(g.points(2)).to.equal(8);
        expect(g.points(1)).to.equal(9);
        place(g, "1C4", "B1C");
        place(g, "2I6", "G1C");
        place(g, "2A2", "G1CL");
        place(g, "2I7", "B2CL");
        place(g, "2I8", "B2CR");
        g.move("IG1C+AG1CL>CB1C");
        expect(g.combat!.stage).to.equal("resolve");
        g.move("option2");
        expect(g.gameover).to.be.false;
        g.move("stay");
        expect(g.points(2)).to.equal(12);
        expect(g.points(1)).to.equal(11);
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([2]);
    });

    it("draws when both reach ten with the same totals and unit counts", () => {
        const g = new SquaresGame();
        for (let i = 1; i <= 9; i++) {
            place(g, `1I${i}`, "X");
            place(g, `2I${i}`, "X");
        }
        place(g, "1C1", "B1C");
        place(g, "2C1", "G1C");
        g.move("CB1C>CG1C");
        g.move("stand");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1, 2]);
    });

    it("loses a player who cannot complete a double turn", () => {
        const g = new SquaresGame();
        place(g, "2I1", "B3R");
        place(g, "2I2", "B3C");
        place(g, "2I3", "B3L");
        expect(g.moves()).to.deep.equal(["pass"]);
        g.move("pass");
        g.move("IGR-G3C");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([2]);
    });
});

describe("Squares: plumbing", () => {
    it("lists only moves that validate and apply, and validates every listed move", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "1C1", "B1CL");
        place(g, "1A1", "B2CL");
        place(g, "1C2", "B3L");
        place(g, "2I1", "G1C");
        place(g, "2C1", "G1CR");
        place(g, "2A1", "G2CR");
        commit(g);
        const moves = g.moves();
        expect(moves.length).to.be.greaterThan(20);
        for (const m of moves) {
            const result = g.validateMove(m);
            expect(result.valid, m).to.be.true;
            expect(result.complete, m).to.not.equal(-1);
            const clone = g.clone();
            clone.move(m);
        }
        expect(new Set(moves).size).to.equal(moves.length);
    });

    it("survives serialisation with a combat pending", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "1C1", "B1CL");
        place(g, "2I1", "G1C");
        commit(g);
        g.move("IB1C+CB1CL>IG1C");
        const clone = g.clone();
        expect(clone.currplayer).to.equal(2);
        expect(clone.combat).to.deep.equal(g.combat);
        expect(clone.moves()).to.have.members(g.moves());
        clone.move("stand");
        expect(clone.currplayer).to.equal(1);
        expect(clone.moves()).to.include("option2");
    });

    it("keeps a full turn of plies in one export round", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "1C1", "B1CL");
        place(g, "2I1", "G1C");
        commit(g);
        g.move("IB1C+CB1CL>IG1C");
        g.move("retreat:IG1C-GR");
        g.move("advance");
        g.move("IGR-G3C");
        g.move("IBR-B3C");
        const plies = g.getPlies();
        expect(plies.map(p => p.actor)).to.deep.equal([1, 2, 1, 2, 1]);
        expect(plies.map(p => p.round)).to.deep.equal([0, 0, 0, 0, 1]);
    });

    it("builds moves from clicks", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "1C1", "B1CL");
        place(g, "2I1", "G1C");
        let click = g.handleClick("", 2, 2);
        expect(click.move).to.equal("IB1C");
        click = g.handleClick(click.move, 2, 7);
        expect(click.move).to.equal("IB1C>IG1C");
        expect(click.complete).to.equal(0);
        click = g.handleClick(click.move, 2, 3);
        expect(click.move).to.equal("IB1C+CB1CL>IG1C");
        expect(click.complete).to.equal(1);
        click = g.handleClick("", -1, -1, "BC");
        expect(click.move).to.equal("CBR");
        click = g.handleClick(click.move, 0, 2);
        expect(click.move).to.equal("CBR-B3L");
        expect(click.complete).to.equal(0);
        click = g.handleClick(click.move, 1, 3);
        expect(click.move).to.equal("CBR-B3L-B2L");
        expect(click.complete).to.equal(1);
        // clicking the square the cavalry was just shown on leaves the move as it is
        click = g.handleClick("CBR-B3L", 0, 2);
        expect(click.move).to.equal("CBR-B3L");
        expect(click.valid).to.be.true;
        expect(click.complete).to.equal(0);
        // a square two steps away can be clicked directly; the engine supplies the path
        click = g.handleClick("CBR", 1, 3);
        expect(click.move).to.equal("CBR-B3L-B2L");
        expect(click.complete).to.equal(1);
        place(g, "1C1", "B1CR");
        click = g.handleClick("CB1CR", 1, 1);
        expect(click.move).to.equal("CB1CR-B2CR");
        expect(click.complete).to.equal(0);
        click = g.handleClick("CB1CR", 1, 2);
        expect(click.move).to.match(/^CB1CR-[A-Z0-9]+-B2CL$/);
        expect(click.complete).to.equal(1);
    });

    it("builds retreat chains and reserve losses from clicks", () => {
        const g = new SquaresGame();
        place(g, "1C1", "B1C");
        place(g, "1I1", "B1CL");
        place(g, "2C1", "G1C");
        place(g, "2I1", "G2CL");
        place(g, "2I2", "G2CR");
        g.move("CB1C+IB1CL>CG1C");
        let click = g.handleClick("", 1, 7);
        expect(click.move).to.equal("retreat:CG1C-G2CL");
        expect(click.complete).to.equal(-1);
        click = g.handleClick(click.move, -1, -1, "_reserves_S");
        expect(click.move).to.equal("retreat:CG1C-G2CL,IG2CL-GR");
        expect(click.complete).to.equal(1);

        const h = new SquaresGame();
        place(h, "1I1", "G3C");
        h.move("IG3C>GR");
        click = h.handleClick("", -1, -1, "GA");
        expect(click.move).to.equal("lose:A");
        expect(click.complete).to.equal(1);
    });

    it("renders the dvgc board with both reserves, each player's side at the bottom", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "2C1", "G1C");
        const rep = g.render({ perspective: 1 });
        expect(rep.board).to.deep.equal({ style: "dvgc", rotate: 180 });
        expect(rep.pieces).to.equal("-,-,-,-,-,-,-,-,-,-\n-,-,-,-,-,-,-,-,-,-\n-,-,BI,-,-,-,-,GC,-,-");
        expect(Object.keys(rep.legend!)).to.have.members(["BI", "BA", "BC", "GI", "GA", "GC"]);
        expect(rep.areas!.length).to.equal(2);
        const north = rep.areas![0] as { side: string; pieces: string[] };
        expect(north.side).to.equal("N");
        expect(north.pieces.length).to.equal(15);
        expect(north.pieces.every(k => k.startsWith("B"))).to.be.true;
        expect(g.render({ perspective: 2 }).board).to.deep.equal({ style: "dvgc" });
        expect(g.render().board).to.deep.equal({ style: "dvgc", rotate: 180 });
        expect(g.getCustomRotation()).to.equal(180);
    });

    it("writes a move log that matches the legacy formatter", () => {
        addResource("en");
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "1A1", "B1CL");
        place(g, "2I1", "G1C");
        place(g, "2C1", "G1L");
        commit(g);
        g.move("IB1C+AB1CL>IG1C");
        g.move("stand");
        g.move("option1");
        g.move("retreat:IG1C-GR");
        g.move("advance");
        g.move("CG1L-G2L");
        g.move("pass");
        const names = ["Alice", "Bob"];
        assertChatLogParity(g, names);
        const text = g.chatLog(names).flat().join("\n");
        expect(text).to.contain("Alice's infantry at B1C attacked G1C.");
        expect(text).to.contain("supported by artillery at B1CL");
        expect(text).to.contain("Bob's unit at G1C stands its ground.");
        expect(text).to.contain("Alice's artillery retreated from B1CL to BR.");
        expect(text).to.contain("Bob's infantry retreated from G1C to GR.");
        expect(text).to.contain("Alice's infantry advanced from B1C into G1C.");
        expect(text).to.contain("Bob moved cavalry from G1L to G2L.");
        expect(text).to.contain("Alice passed and will take a double turn next.");
    });
});

describe("Squares: interface helpers", () => {
    it("adds a second cavalry from the reserve by clicking the strip again", () => {
        const g = new SquaresGame();
        let click = g.handleClick("", -1, -1, "BC");
        click = g.handleClick(click.move, 0, 2);
        expect(click.move).to.equal("CBR-B3L");
        click = g.handleClick(click.move, -1, -1, "BC");
        expect(click.move).to.equal("CBR-B3L,CBR");
        expect(click.complete).to.equal(-1);
        click = g.handleClick(click.move, 0, 1);
        expect(click.move).to.equal("CBR-B3L,CBR-B3C");
        expect(click.complete).to.equal(1);
    });

    it("offers buttons for every combat decision and finishes option prefixes by clicking", () => {
        const g = new SquaresGame();
        expect(g.getButtons()).to.deep.equal([{ label: "pass", move: "pass" }]);
        place(g, "1I1", "B1C");
        place(g, "1C1", "B1CL");
        place(g, "2I1", "G1C");
        g.move("IB1C+CB1CL>IG1C");
        expect(g.getButtons().map(b => [b.label, b.move])).to.deep.equal([["squares.stand", "stand"], ["squares.retreatReserve", "retreat:IG1C-GR"]]);
        g.move("stand");
        const buttons = g.getButtons();
        expect(buttons.map(b => b.label)).to.deep.equal(["squares.option1", "squares.option2", "squares.option3", "squares.option4", "squares.option5"]);
        expect(buttons[0].move).to.equal("option1:CB1CL-B2CL");
        expect(buttons[4].move).to.equal("option5:CB1CL-B2CL");
        expect(g.validateMove("option1").complete).to.equal(-1);
        expect(g.validateMove("option5:").complete).to.equal(-1);
        const click = g.handleClick("option1", 1, 2);
        expect(click.move).to.equal("option1:CB1CL-B2CL");
        expect(click.complete).to.equal(1);
        g.move("option2");
        expect(g.getButtons().map(b => b.move)).to.deep.equal(["advance", "stay"]);
        g.move("stay");
        expect(g.getButtons()).to.deep.equal([{ label: "pass", move: "pass" }]);
        const h = new SquaresGame();
        place(h, "1I1", "G3C");
        h.move("IG3C>GR");
        expect(h.getButtons().map(b => [b.label, b.move])).to.deep.equal([["squares.loseI", "lose:I"], ["squares.loseA", "lose:A"], ["squares.loseC", "lose:C"]]);
        expect(h.validateMove("lose:").complete).to.equal(-1);
        h.move("pass".slice(0, 0) + "lose:C");
        expect(h.getButtons()).to.deep.equal([{ label: "pass", move: "pass" }]);
    });

    it("explains why a retreat square is not allowed", () => {
        addResource("en");
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "1C1", "B1CL");
        place(g, "2I1", "G1C");
        g.move("IB1C+CB1CL>IG1C");
        expect(g.validateMove("retreat:IG1C-G2CL").message).to.contain("retreat to their reserve");
        expect(g.validateMove("retreat:IG1C-EF").message).to.contain("attacked while in a forest");
        // lone cavalry attacking cavalry: the defender may stand or take the one vacant square
        const h = new SquaresGame();
        place(h, "1C1", "B1C");
        place(h, "2C1", "G1C");
        place(h, "2I1", "G2CL");
        h.move("CB1C>CG1C");
        expect(h.moves()).to.have.members(["stand", "retreat:CG1C-G2CR"]);
        expect(h.validateMove("retreat:CG1C-G2CL,IG2CL-GR").message).to.contain("vacant");
        expect(h.validateMove("retreat:CG1C-B1CR").message).to.contain("not closer");
        expect(h.validateMove("retreat:CG1C-G3C").message).to.contain("touching");
        expect(h.validateMove("retreat:CG1C-G2CR").valid).to.be.true;
        // supported attack with two vacant squares behind: the cavalry must retreat
        const k = new SquaresGame();
        place(k, "1C1", "B1C");
        place(k, "1I1", "B1CL");
        place(k, "2C1", "G1C");
        k.move("CB1C+IB1CL>CG1C");
        expect(k.moves()).to.have.members(["retreat:CG1C-G2CL", "retreat:CG1C-G2CR"]);
        expect(k.validateMove("stand").message).to.contain("must retreat");
    });

    it("previews selections, attacks and reserve-bound retreats", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "1C1", "B1CL");
        place(g, "2I1", "G1C");
        commit(g);
        expect(g.validateMove("IB1C").canrender).to.be.true;
        const sel = g.clone();
        sel.move("IB1C", { partial: true });
        expect(sel.render().annotations).to.deep.include({ type: "enter", targets: [{ row: 2, col: 2 }] });
        const atk = g.clone();
        atk.move("IB1C>IG1C", { partial: true });
        expect(atk.render().annotations).to.deep.include({ type: "move", targets: [{ row: 2, col: 2 }, { row: 2, col: 7 }], style: "solid" });
        const sup = g.clone();
        sup.move("IB1C+CB1CL>IG1C", { partial: true });
        expect(sup.render().annotations).to.deep.include({ type: "move", targets: [{ row: 2, col: 3 }, { row: 2, col: 7 }], style: "dashed" });
        const r = g.clone();
        r.move("IB1C>IG1C");
        r.move("retreat:IG1C-GR");
        const rep = r.render({ perspective: 2 });
        expect(rep.board).to.deep.equal({ style: "dvgc", markers: [{ type: "edge", edge: "S", colour: r.getPlayerColour(2) }] });
        expect(rep.annotations).to.deep.include({ type: "move", targets: [{ row: 2, col: 7 }, { row: 0, col: 6 }], style: "dashed" });
        expect(JSON.stringify(rep.annotations)).to.not.contain("#c00");
        const out = new SquaresGame();
        out.move("IBR-B3C");
        expect(out.render().board).to.deep.equal({ style: "dvgc", rotate: 180, markers: [{ type: "edge", edge: "N", colour: out.getPlayerColour(1) }] });
        expect(out.render().annotations).to.deep.include({ type: "enter", targets: [{ row: 0, col: 1 }] });
    });

    it("reports losses with glyphs and points with unit counts", () => {
        const g = new SquaresGame();
        place(g, "1I1", "B1C");
        place(g, "2I1", "G1C");
        g.move("IB1C>IG1C");
        g.move("stand");
        expect(JSON.stringify(g.sidebarStatuses())).to.contain('"glyph":"nato-infantry"');
        expect(g.sidebarScores()[0].scores).to.deep.equal(["1 (1)", "1 (1)"]);
    });

    it("draws by threefold repetition", () => {
        const g = new SquaresGame();
        place(g, "1C1", "B1C");
        place(g, "1I1", "B2R");
        place(g, "2C1", "G1C");
        place(g, "2I1", "G2L");
        commit(g);
        const cycle = ["CB1C-B1CL", "CG1C-G1CL", "CB1CL-B1C", "CG1CL-G1C", "IB2R-B2CR", "IG2L-G2CL", "IB2CR-B2R", "IG2CL-G2L"];
        let plies = 0;
        while (!g.gameover && plies < 40) {
            g.move(cycle[plies % cycle.length]);
            plies += 1;
        }
        expect(g.gameover).to.be.true;
        expect(g.winner).to.deep.equal([1, 2]);
        expect(plies).to.equal(18);
        expect(g.stack[g.stack.length - 1]._results).to.deep.include({ type: "eog", reason: "repetition" });
    });
});

describe("Squares: annotation safety", () => {
    const sameEnds = (g: SquaresGame): boolean => (g.render().annotations ?? []).some(a =>
        a.type === "move" && a.targets.length === 2 && a.targets[0].row === a.targets[1].row && a.targets[0].col === a.targets[1].col);

    it("never draws an arrow from a square to itself", () => {
        // out of the reserve straight onto the back line, previewed and played
        const g = new SquaresGame();
        const preview = g.clone();
        preview.move("IBR-B3C", { partial: true });
        expect(sameEnds(preview)).to.be.false;
        g.move("IBR-B3C");
        expect(sameEnds(g)).to.be.false;
        // an attack on a reserve from the back line, previewed, pending and resolved
        const h = new SquaresGame();
        place(h, "1I1", "G3C");
        place(h, "1I2", "G3L");
        commit(h);
        const hp = h.clone();
        hp.move("IG3C+IG3L>GR", { partial: true });
        expect(sameEnds(hp)).to.be.false;
        h.move("IG3C+IG3L>GR");
        expect(sameEnds(h)).to.be.false;
        h.move("lose:A");
        expect(sameEnds(h)).to.be.false;
        // a retreat into the reserve from the back line itself
        const k = new SquaresGame();
        place(k, "1I1", "G3C");
        place(k, "2I1", "G2CL");
        place(k, "1C1", "G1C");
        commit(k);
        k.move("IG3C+CG1C>IG2CL");
        expect(sameEnds(k)).to.be.false;
        const m = new SquaresGame();
        place(m, "1I1", "B1C");
        place(m, "2I1", "G3C");
        commit(m);
        m.move("IB1C-B2CL");
        m.move("IG3C-GR");
        expect(sameEnds(m)).to.be.false;
        expect(m.render().board).to.deep.include({ markers: [{ type: "edge", edge: "S", colour: m.getPlayerColour(2) }] });
    });
});
