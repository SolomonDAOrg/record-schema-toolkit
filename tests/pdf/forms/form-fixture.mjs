/**
 * Minimal AcroForm documents built byte by byte, for the field shapes the
 * sample forms do not contain: choice fields, radio groups whose widgets are
 * separate kid annotations, hierarchical names, right-aligned and
 * automatically-sized text.
 *
 * Written as literal PDF source rather than through the document builder,
 * because the builder emits only the flat text-and-signature profile it needs
 * for its own output, and these fixtures exist to exercise everything else.
 */

const encoder = new TextEncoder();

/**
 * @typedef {Object} FixtureObject
 * @property {number} id
 * @property {string} body - The object's content, without the
 *   surrounding `N 0 obj` wrapper.
 */

/**
 * @typedef {Object} TextFieldSpec
 * @property {number} id
 * @property {string} name - Partial name placed in /T.
 * @property {string} rect - Raw /Rect array.
 * @property {number} [parentId] - Object id for /Parent, for a grouped field.
 * @property {string} [defaultAppearance] - /DA body, without its parentheses.
 * @property {string} [extras] - Further raw entries, e.g. "/Ff 4096".
 */

/**
 * @typedef {TextFieldSpec & { options: string }} ChoiceFieldSpec
 */

/**
 * @typedef {Object} RadioGroupSpec
 * @property {number} id
 * @property {string} name
 * @property {string[]} states - One on-state name per option widget.
 * @property {number} firstKidId - Object id of the first widget; ids run on.
 * @property {number} [flags] - /Ff for the group; defaults to the radio bit.
 * @property {boolean} [offAppearance] - Give each widget an Off appearance.
 *   Defaults to true; published forms often supply only the on state.
 */

/**
 * @typedef {Object} FieldGroupSpec
 * @property {number} id
 * @property {string} name
 * @property {number[]} kidIds
 * @property {string} [extras]
 */

/**
 * Assemble numbered objects into a PDF with a classic cross-reference table.
 * @param {FixtureObject[]} objects
 * @param {number} rootId
 * @returns {Uint8Array}
 */
export function assembleFixture(objects, rootId) {
    const sorted = [...objects].sort((a, b) => a.id - b.id);
    let source = "%PDF-1.7\n";
    /** @type {Map<number, number>} */
    const offsets = new Map();
    for (let i = 0, len = sorted.length; i < len; i++) {
        offsets.set(sorted[i].id, source.length);
        source =
            source + sorted[i].id + " 0 obj\n" + sorted[i].body + "\nendobj\n";
    }
    const xrefOffset = source.length;
    const size = sorted[sorted.length - 1].id + 1;
    source = source + "xref\n0 " + size + "\n0000000000 65535 f \n";
    for (let id = 1; id < size; id++) {
        const offset = offsets.get(id);
        source =
            source +
            (offset === undefined
                ? "0000000000 65535 f \n"
                : String(offset).padStart(10, "0") + " 00000 n \n");
    }
    source =
        source +
        "trailer\n<< /Size " +
        size +
        " /Root " +
        rootId +
        " 0 R >>\nstartxref\n" +
        xrefOffset +
        "\n%%EOF\n";
    return encoder.encode(source);
}

/**
 * A one-page document whose AcroForm holds the given field objects.
 *
 * Object ids 1-5 are the catalog, page tree, page, Helvetica and the AcroForm;
 * field objects must use ids from 10 upward.
 * @param {FixtureObject[]} fieldObjects
 * @param {number[]} rootFieldIds - Ids placed in the AcroForm's /Fields array.
 * @param {string} [acroFormExtras] - Further AcroForm entries, such as
 *   "/XFA [(x) 9 0 R]".
 * @returns {Uint8Array}
 */
export function buildFormFixture(fieldObjects, rootFieldIds, acroFormExtras) {
    const annotationIds = fieldObjects
        .filter((object) => object.body.includes("/Subtype /Widget"))
        .map((object) => object.id);
    /** @type {FixtureObject[]} */
    const objects = [
        { id: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R >>" },
        { id: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
        {
            id: 3,
            body:
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]" +
                " /Resources << /Font << /Helv 4 0 R >> >> /Annots [" +
                annotationIds.map((id) => id + " 0 R").join(" ") +
                "] >>"
        },
        {
            id: 4,
            body:
                "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica" +
                " /Encoding /WinAnsiEncoding >>"
        },
        {
            id: 5,
            body:
                "<< /Fields [" +
                rootFieldIds.map((id) => id + " 0 R").join(" ") +
                "] /DA (/Helv 0 Tf 0 g)" +
                " /DR << /Font << /Helv 4 0 R >> >>" +
                (acroFormExtras === undefined ? "" : " " + acroFormExtras) +
                " >>"
        },
        ...fieldObjects
    ];
    return assembleFixture(objects, 1);
}

/**
 * A merged text field and widget annotation.
 * @param {TextFieldSpec} spec
 * @returns {FixtureObject}
 */
export function textField(spec) {
    return {
        id: spec.id,
        body:
            "<< /Type /Annot /Subtype /Widget /FT /Tx /T (" +
            spec.name +
            ")" +
            (spec.parentId === undefined
                ? ""
                : " /Parent " + spec.parentId + " 0 R") +
            " /Rect " +
            spec.rect +
            " /P 3 0 R /DA (" +
            (spec.defaultAppearance === undefined
                ? "/Helv 9 Tf 0 g"
                : spec.defaultAppearance) +
            ")" +
            (spec.extras === undefined ? "" : " " + spec.extras) +
            " >>"
    };
}

/**
 * A merged choice field and widget annotation.
 * @param {ChoiceFieldSpec} spec
 * @returns {FixtureObject}
 */
export function choiceField(spec) {
    return {
        id: spec.id,
        body:
            "<< /Type /Annot /Subtype /Widget /FT /Ch /T (" +
            spec.name +
            ")" +
            (spec.parentId === undefined
                ? ""
                : " /Parent " + spec.parentId + " 0 R") +
            " /Rect " +
            spec.rect +
            " /P 3 0 R /DA (" +
            (spec.defaultAppearance === undefined
                ? "/Helv 9 Tf 0 g"
                : spec.defaultAppearance) +
            ") /Opt " +
            spec.options +
            (spec.extras === undefined ? "" : " " + spec.extras) +
            " >>"
    };
}

/**
 * A radio group: a parent field carrying /FT and /Ff, with one kid widget per
 * option. The kids carry no /T, which is what makes them widgets rather than
 * child fields.
 * @param {RadioGroupSpec} spec
 * @returns {FixtureObject[]}
 */
export function radioGroup(spec) {
    const kidIds = spec.states.map((_state, index) => spec.firstKidId + index);
    /** @type {FixtureObject[]} */
    const objects = [
        {
            id: spec.id,
            body:
                "<< /FT /Btn /Ff " +
                (spec.flags === undefined ? 32768 : spec.flags) +
                " /T (" +
                spec.name +
                ") /Kids [" +
                kidIds.map((id) => id + " 0 R").join(" ") +
                "] >>"
        }
    ];
    for (let i = 0, len = spec.states.length; i < len; i++) {
        objects.push({
            id: kidIds[i],
            body:
                "<< /Type /Annot /Subtype /Widget /Parent " +
                spec.id +
                " 0 R /Rect [" +
                (50 + i * 30) +
                " 700 " +
                (62 + i * 30) +
                " 712] /P 3 0 R /AS /Off /AP << /N << /" +
                spec.states[i] +
                " 90 0 R" +
                (spec.offAppearance === false ? "" : " /Off 91 0 R") +
                " >> >> >>"
        });
    }
    const emptyAppearance =
        "<< /Type /XObject /Subtype /Form /BBox [0 0 12 12] /Length 0 >>" +
        "\nstream\n\nendstream";
    objects.push({ id: 90, body: emptyAppearance });
    objects.push({ id: 91, body: emptyAppearance });
    return objects;
}

/**
 * A non-terminal field node grouping child fields under a shared partial name.
 * @param {FieldGroupSpec} spec
 * @returns {FixtureObject}
 */
export function fieldGroup(spec) {
    return {
        id: spec.id,
        body:
            "<< /T (" +
            spec.name +
            ") /Kids [" +
            spec.kidIds.map((id) => id + " 0 R").join(" ") +
            "]" +
            (spec.extras === undefined ? "" : " " + spec.extras) +
            " >>"
    };
}
