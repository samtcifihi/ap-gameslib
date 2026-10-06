/**
 * Alternative display selection for the playground, shaped like the front end's picker: one radio
 * group per `group`, each with its `#group` default first, and one checkbox per ungrouped display.
 * The active uids go to `render()` as `altDisplays`; the library's display-constraint helpers
 * sanitize the selection and disable what cannot be chosen.
 */

export const STORAGE = {
    /** JSON array of the active display uids. */
    displays: "selectedDisplays",
    /** The single uid stored before displays could be combined; migrated on first read. */
    legacyDisplay: "selectedDisplay",
};

function isDisplayUid(value) {
    return typeof value === "string" && value !== "" && value !== "default" && !value.startsWith("#");
}

/**
 * The display uids stored for the playground, as last saved. A single uid saved by the previous
 * playground becomes a one-element list.
 * @param {{ getItem: (key: string) => string | null, removeItem: (key: string) => void }} storage
 * @returns {string[]}
 */
export function loadStoredDisplayUids(storage = window.localStorage) {
    const raw = storage.getItem(STORAGE.displays);
    if (raw !== null) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.filter(isDisplayUid);
            }
        } catch {
            // Unreadable storage counts as nothing selected.
        }
        return [];
    }
    const legacy = storage.getItem(STORAGE.legacyDisplay);
    if (legacy !== null) {
        storage.removeItem(STORAGE.legacyDisplay);
        return isDisplayUid(legacy) ? [legacy] : [];
    }
    return [];
}

/**
 * @param {string[]} uids
 * @param {{ setItem: (key: string, value: string) => void, removeItem: (key: string) => void }} storage
 */
export function saveStoredDisplayUids(uids, storage = window.localStorage) {
    storage.setItem(STORAGE.displays, JSON.stringify(uids.filter(isDisplayUid)));
    storage.removeItem(STORAGE.legacyDisplay);
}

/**
 * The controls to build for a game's alternative displays, from `alternativeDisplays()`: the radio
 * groups in the order their first member appears (the engine lists the default sentinels first),
 * each with its default first, and the ungrouped displays as independent toggles. Uids in
 * `hiddenUids` get no control: the library expands legacy composites such as `hide-both` into the
 * displays they stand for before sanitizing, so a control for one could never stay checked.
 * @param {Array<{ uid: string, group?: string, name?: string, description?: string }> | undefined} displays
 * @param {Set<string>} hiddenUids
 * @returns {{ groups: Array<{ group: string, members: Array<{ uid: string, group?: string, name?: string, description?: string }> }>, toggles: Array<{ uid: string, group?: string, name?: string, description?: string }> }}
 */
export function buildDisplayModel(displays, hiddenUids = new Set()) {
    const byGroup = new Map();
    const toggles = [];
    for (const display of displays ?? []) {
        if (display.group === undefined) {
            if (!display.uid.startsWith("#") && !hiddenUids.has(display.uid)) {
                toggles.push(display);
            }
            continue;
        }
        if (!byGroup.has(display.group)) {
            byGroup.set(display.group, []);
        }
        byGroup.get(display.group).push(display);
    }
    const order = [];
    for (const display of displays ?? []) {
        if (display.group !== undefined && !display.uid.startsWith("#") && !order.includes(display.group)) {
            order.push(display.group);
        }
    }
    for (const group of byGroup.keys()) {
        if (!order.includes(group)) {
            order.push(group);
        }
    }
    const groups = [];
    for (const group of order) {
        const members = byGroup.get(group);
        const sentinelUid = `#${group}`;
        const declared = members.find((display) => display.uid === sentinelUid);
        const sentinel = {
            uid: sentinelUid,
            group,
            name: declared?.name ?? `Default ${group}`,
            description: declared?.description,
        };
        groups.push({
            group,
            members: [sentinel, ...members.filter((display) => display.uid !== sentinelUid)],
        });
    }
    return { groups, toggles };
}

/**
 * The selection with every group at its default and every toggle off.
 * @param {ReturnType<typeof buildDisplayModel>} model
 * @returns {{ groupChoice: Record<string, string>, toggles: Record<string, boolean> }}
 */
export function initialDisplaySelection(model) {
    const groupChoice = {};
    for (const entry of model.groups) {
        groupChoice[entry.group] = `#${entry.group}`;
    }
    const toggles = {};
    for (const display of model.toggles) {
        toggles[display.uid] = false;
    }
    return { groupChoice, toggles };
}

/**
 * The active display uids of a selection: the chosen member of each group, then the toggles that
 * are on. Group defaults are sentinels and are never listed.
 * @param {{ groupChoice: Record<string, string>, toggles: Record<string, boolean> }} selection
 * @returns {string[]}
 */
export function collectActiveDisplayUids(selection) {
    const uids = [];
    for (const uid of Object.values(selection.groupChoice)) {
        if (isDisplayUid(uid)) {
            uids.push(uid);
        }
    }
    for (const [uid, on] of Object.entries(selection.toggles)) {
        if (on) {
            uids.push(uid);
        }
    }
    return uids;
}

/**
 * The selection that shows a sanitized list of active uids: each group at the listed member or
 * its default, each toggle on exactly when listed.
 * @param {ReturnType<typeof buildDisplayModel>} model
 * @param {string[]} sanitized
 * @returns {{ groupChoice: Record<string, string>, toggles: Record<string, boolean> }}
 */
export function selectionFromUids(model, sanitized) {
    const active = new Set(sanitized.filter(isDisplayUid));
    const groupChoice = {};
    for (const entry of model.groups) {
        const member = entry.members.find((display) => active.has(display.uid));
        groupChoice[entry.group] = member === undefined ? `#${entry.group}` : member.uid;
    }
    const toggles = {};
    for (const display of model.toggles) {
        toggles[display.uid] = active.has(display.uid);
    }
    return { groupChoice, toggles };
}

/**
 * Render options carrying the active displays: `altDisplays` when any is active, and neither
 * `altDisplays` nor the legacy `altDisplay` otherwise.
 * @template T
 * @param {T} renderOpts
 * @param {string[]} uids
 * @returns {T}
 */
export function withDisplayRenderOpts(renderOpts, uids) {
    const { altDisplay, altDisplays, ...rest } = renderOpts;
    void altDisplay;
    void altDisplays;
    const active = uids.filter(isDisplayUid);
    return active.length > 0 ? { ...rest, altDisplays: active } : rest;
}
