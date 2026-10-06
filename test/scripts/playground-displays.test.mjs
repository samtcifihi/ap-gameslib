import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

const store = new Map();
const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
        store.set(key, value);
    },
    removeItem: (key) => {
        store.delete(key);
    },
};

const {
    STORAGE,
    buildDisplayModel,
    collectActiveDisplayUids,
    initialDisplaySelection,
    loadStoredDisplayUids,
    saveStoredDisplayUids,
    selectionFromUids,
    withDisplayRenderOpts,
} = await import("../../playground/playgroundDisplays.mjs");

/** Ice Palace-shaped displays as `alternativeDisplays()` returns them: sentinels first. */
const twoGroups = [
    { uid: "#board", group: "board" },
    { uid: "#areas", group: "areas", name: "Flat areas" },
    { uid: "perspective", group: "board", name: "Perspective board", description: "Tilted board" },
    { uid: "perspective-areas", group: "areas", name: "Perspective areas" },
];

/** Tumbleweed-shaped displays: toggles plus a composite that implies two of them. */
const toggles = [
    { uid: "hide-threatened", name: "Hide threatened" },
    { uid: "hide-influence", name: "Hide influence" },
    { uid: "hide-both", name: "Hide both", implies: ["hide-threatened", "hide-influence"], impliesLock: true },
];

describe("playground display helpers", () => {
    beforeEach(() => {
        store.clear();
    });

    it("builds one radio group per group, its default first, and a toggle per ungrouped display", () => {
        const model = buildDisplayModel([...twoGroups, ...toggles]);
        assert.deepEqual(model.groups.map((g) => g.group), ["board", "areas"]);
        assert.deepEqual(model.groups[0].members.map((d) => d.uid), ["#board", "perspective"]);
        assert.equal(model.groups[0].members[0].name, "Default board");
        assert.equal(model.groups[1].members[0].name, "Flat areas");
        assert.deepEqual(model.toggles.map((d) => d.uid), ["hide-threatened", "hide-influence", "hide-both"]);
    });

    it("orders groups by their first member, not by the sentinels the engine lists first", () => {
        const model = buildDisplayModel([
            { uid: "#areas", group: "areas" },
            { uid: "#board", group: "board" },
            { uid: "perspective", group: "board" },
            { uid: "perspective-areas", group: "areas" },
        ]);
        assert.deepEqual(model.groups.map((g) => g.group), ["board", "areas"]);
        assert.deepEqual(model.groups.map((g) => g.members.map((d) => d.uid)), [["#board", "perspective"], ["#areas", "perspective-areas"]]);
    });

    it("gives no control to uids the library expands before sanitizing", () => {
        const model = buildDisplayModel(toggles, new Set(["hide-both"]));
        assert.deepEqual(model.toggles.map((d) => d.uid), ["hide-threatened", "hide-influence"]);
        assert.deepEqual(Object.keys(initialDisplaySelection(model).toggles), ["hide-threatened", "hide-influence"]);
    });

    it("adds the default of a group that declares none, and tolerates no displays", () => {
        const model = buildDisplayModel([{ uid: "flat", group: "projection" }]);
        assert.deepEqual(model.groups[0].members.map((d) => d.uid), ["#projection", "flat"]);
        assert.deepEqual(buildDisplayModel(undefined), { groups: [], toggles: [] });
        assert.deepEqual(buildDisplayModel([]), { groups: [], toggles: [] });
    });

    it("starts every group at its default and every toggle off, listing nothing as active", () => {
        const model = buildDisplayModel([...twoGroups, ...toggles]);
        const selection = initialDisplaySelection(model);
        assert.deepEqual(selection.groupChoice, { board: "#board", areas: "#areas" });
        assert.deepEqual(selection.toggles, { "hide-threatened": false, "hide-influence": false, "hide-both": false });
        assert.deepEqual(collectActiveDisplayUids(selection), []);
    });

    it("lists the chosen group members before the toggles that are on, never the defaults", () => {
        const selection = {
            groupChoice: { board: "perspective", areas: "#areas" },
            toggles: { "hide-threatened": true, "hide-influence": false },
        };
        assert.deepEqual(collectActiveDisplayUids(selection), ["perspective", "hide-threatened"]);
    });

    it("rebuilds a selection from a sanitized uid list", () => {
        const model = buildDisplayModel([...twoGroups, ...toggles]);
        const selection = selectionFromUids(model, ["perspective-areas", "hide-both", "hide-threatened", "hide-influence"]);
        assert.deepEqual(selection.groupChoice, { board: "#board", areas: "perspective-areas" });
        assert.deepEqual(selection.toggles, { "hide-threatened": true, "hide-influence": true, "hide-both": true });
        // Unknown uids and sentinels are ignored.
        assert.deepEqual(selectionFromUids(model, ["#board", "nope"]).groupChoice, { board: "#board", areas: "#areas" });
    });

    it("stores the active uids as a list and migrates the single uid of the old playground", () => {
        assert.deepEqual(loadStoredDisplayUids(storage), []);
        store.set(STORAGE.legacyDisplay, "flat");
        assert.deepEqual(loadStoredDisplayUids(storage), ["flat"]);
        assert.equal(store.has(STORAGE.legacyDisplay), false);
        store.set(STORAGE.legacyDisplay, "default");
        assert.deepEqual(loadStoredDisplayUids(storage), []);
        saveStoredDisplayUids(["perspective", "#board", "hide-influence"], storage);
        assert.equal(store.get(STORAGE.displays), JSON.stringify(["perspective", "hide-influence"]));
        assert.deepEqual(loadStoredDisplayUids(storage), ["perspective", "hide-influence"]);
        // The new key wins over a leftover old one, and unreadable storage counts as nothing.
        store.set(STORAGE.legacyDisplay, "flat");
        assert.deepEqual(loadStoredDisplayUids(storage), ["perspective", "hide-influence"]);
        store.set(STORAGE.displays, "not json");
        assert.deepEqual(loadStoredDisplayUids(storage), []);
    });

    it("passes active displays to render as altDisplays and otherwise passes none", () => {
        const base = { perspective: 2, altDisplay: "stale" };
        assert.deepEqual(withDisplayRenderOpts(base, ["flat", "hide-influence"]), { perspective: 2, altDisplays: ["flat", "hide-influence"] });
        assert.deepEqual(withDisplayRenderOpts(base, []), { perspective: 2 });
        assert.deepEqual(withDisplayRenderOpts({ altDisplays: ["old"] }, ["#projection"]), {});
    });
});
