/**
 * Staging buffer for dictionary changes destined for an incremental update.
 *
 * The editor's update map holds serialised object bodies, so writing to the
 * same object twice means re-parsing what the first write produced. That
 * happens routinely: a form field and its widget annotation are frequently one
 * dictionary, and filling it sets a value on the field and an appearance state
 * on the widget. This keeps each object's entries in parsed form until the
 * whole set of changes is settled, then serialises each object once.
 * @module DictionaryEdits
 */

import { serializeDict, setEntry } from "./reader.mjs";

/**
 * A set of pending dictionary changes, keyed by object id.
 */
export class DictionaryEdits {
    constructor() {
        /** @type {Map<number, { key: string, raw: string }[]>} */
        this.entriesById = new Map();
    }

    /**
     * The working entries for an object, seeded from `entries` on first use.
     * @param {number} id
     * @param {{ key: string, raw: string }[]} entries
     * @returns {{ key: string, raw: string }[]}
     */
    open(id, entries) {
        const existing = this.entriesById.get(id);
        if (existing !== undefined) {
            return existing;
        }
        const copy = entries.map((entry) => ({ ...entry }));
        this.entriesById.set(id, copy);
        return copy;
    }

    /**
     * Set a key on an object.
     * @param {number} id
     * @param {{ key: string, raw: string }[]} entries
     * @param {string} key
     * @param {string} raw
     * @returns {void}
     */
    set(id, entries, key, raw) {
        setEntry(this.open(id, entries), key, raw);
    }

    /**
     * Remove a key from an object.
     * @param {number} id
     * @param {{ key: string, raw: string }[]} entries
     * @param {string} key
     * @returns {void}
     */
    remove(id, entries, key) {
        const working = this.open(id, entries);
        for (let i = working.length - 1; i >= 0; i--) {
            if (working[i].key === key) {
                working.splice(i, 1);
            }
        }
    }

    /**
     * True when any change has been staged.
     * @returns {boolean}
     */
    get empty() {
        return this.entriesById.size === 0;
    }

    /**
     * Serialise every staged object into the editor's pending update.
     * @param {import("./reader.mjs").PdfEditor} editor
     * @returns {void}
     */
    flush(editor) {
        for (const [id, entries] of this.entriesById) {
            editor.updated.set(id, serializeDict(entries));
        }
    }
}

export default { DictionaryEdits };
