/**
 * SigningPageGenerator
 * Normalizes signing/execution page party data for the renderer.
 *
 * Config resolution (enabled checks, CLI vs pack, scalar fields) is handled
 * by RenderPack.resolveSigningConfig(). This class only normalizes the
 * party/signatory structures.
 *
 * @module generators/SigningPageGenerator
 */

import { isArray, isString } from "../../util/general.mjs";
import { isObject } from "../../util/objects.mjs";

/** @typedef {import("../types/general.mjs").Metadata} Metadata */
/** @typedef {import("./../types/general.mjs").ResolvedSigningConfig} ResolvedSigningConfig */

export class SigningPageGenerator {
    /**
     * @param {{ trace?: (msg: string) => void, verbose?: boolean }} [opts]
     */
    constructor(opts) {
        /** @type {boolean} */
        this._verbose = opts?.verbose === true;
        /** @type {(msg: string) => void} */
        this._trace_fn =
            typeof opts?.trace === "function" ? opts.trace : () => {};
    }

    /**
     * Normalize party/signatory data from a resolved signing config.
     * RenderPack.resolveSigningConfig() handles merging; this handles
     * the complex signatory value extraction and field normalization.
     *
     * @param {ResolvedSigningConfig} resolved
     * @returns {ResolvedSigningConfig}
     */
    normalizeParties(resolved) {
        const raw_parties = resolved.parties;
        if (!isArray(raw_parties) || raw_parties.length === 0) {
            return resolved;
        }

        const parties = [];
        for (let i = 0, len = raw_parties.length; i < len; i++) {
            const p = raw_parties[i];
            if (!isObject(p) || !isString(p.label)) {
                continue;
            }

            const fields = this._normalizeFields(p.fields);

            const raw_signatories = isArray(p.signatories)
                ? p.signatories
                : p.name !== undefined
                ? [{ name: p.name, title: p.title }]
                : [];

            const signatories = [];
            for (let j = 0, j_len = raw_signatories.length; j < j_len; j++) {
                const s = raw_signatories[j];
                if (!isObject(s)) {
                    continue;
                }

                /** @type {Metadata} */
                const sig = /** @type {Metadata} */ (s);
                /** @type {Record<string, string>} */
                const values = this._normalizeValuesMap(sig.values) ?? {};

                // Legacy scalar aliases → values map
                if (isString(sig.name) && values.Name === undefined) {
                    values.Name = sig.name;
                }
                if (isString(sig.title) && values.Title === undefined) {
                    values.Title = sig.title;
                }
                if (isString(sig.date) && values.Date === undefined) {
                    values.Date = sig.date;
                }
                if (isString(sig.signature) && values.Signature === undefined) {
                    values.Signature = sig.signature;
                }
                if (isString(sig.by) && values.By === undefined) {
                    values.By = sig.by;
                }

                // Match declared fields by canonical key
                if (isArray(fields) && fields.length > 0) {
                    const key_entries = Object.entries(sig);
                    for (let f = 0, f_len = fields.length; f < f_len; f++) {
                        const field_label = fields[f];
                        if (values[field_label] !== undefined) {
                            continue;
                        }

                        if (isString(sig[field_label])) {
                            values[field_label] = /** @type {string} */ (
                                sig[field_label]
                            );
                            continue;
                        }

                        const target_canon =
                            this._canonicalFieldKey(field_label);
                        for (
                            let ke = 0, k_len = key_entries.length;
                            ke < k_len;
                            ke++
                        ) {
                            const [raw_key, raw_value] = key_entries[ke];
                            if (raw_key === "values") {
                                continue;
                            }
                            if (!isString(raw_value)) {
                                continue;
                            }
                            if (
                                this._canonicalFieldKey(raw_key) ===
                                target_canon
                            ) {
                                values[field_label] = raw_value;
                                break;
                            }
                        }
                    }
                }

                signatories.push({ values });
            }

            if (signatories.length === 0) {
                continue;
            }

            parties.push({
                label: p.label,
                fields,
                signatories
            });
        }

        if (parties.length === 0) {
            return resolved;
        }

        return { ...resolved, parties };
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /**
     * @param {unknown} value
     * @returns {string[] | undefined}
     * @private
     */
    _normalizeFields(value) {
        if (!isArray(value)) {
            return undefined;
        }
        const out = [];
        const seen = new Set();
        for (let i = 0, len = value.length; i < len; i++) {
            const v = value[i];
            if (!isString(v)) {
                continue;
            }
            const trimmed = v.trim();
            if (trimmed.length === 0) {
                continue;
            }
            const key = trimmed.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            out.push(trimmed);
        }
        return out.length > 0 ? out : undefined;
    }

    /**
     * @param {unknown} value
     * @returns {Record<string, string> | undefined}
     * @private
     */
    _normalizeValuesMap(value) {
        if (!isObject(value)) {
            return undefined;
        }
        /** @type {Record<string, string>} */
        const out = {};
        const entries = Object.entries(/** @type {Metadata} */ (value));
        for (let i = 0, len = entries.length; i < len; i++) {
            const [k, v] = entries[i];
            if (!isString(k)) {
                continue;
            }
            const label = k.trim();
            if (label.length === 0) {
                continue;
            }
            if (!isString(v)) {
                continue;
            }
            out[label] = v;
        }
        return Object.keys(out).length > 0 ? out : {};
    }

    /**
     * @param {string} value
     * @returns {string}
     * @private
     */
    _canonicalFieldKey(value) {
        return value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "");
    }
}
