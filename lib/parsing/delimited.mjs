/**
 * Parse comma- or tab-separated records with quoted fields and doubled quotes.
 * @param {string} source
 * @param {"," | "\t"} delimiter
 * @returns {string[][]}
 */
export function parseDelimitedRecords(source, delimiter) {
    const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    /** @type {string[][]} */
    const records = [];
    /** @type {string[]} */
    let record = [];
    let field = "";
    /** @type {"start" | "plain" | "quoted" | "closed"} */
    let state = "start";
    let line = 1;
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (state === "quoted") {
            if (character === '"') {
                if (text[index + 1] === '"') {
                    field += '"';
                    index++;
                } else state = "closed";
            } else {
                field += character;
                if (character === "\n") line++;
            }
            continue;
        }
        if (character === delimiter || character === "\n") {
            record.push(field);
            field = "";
            state = "start";
            if (character === "\n") {
                records.push(record);
                record = [];
                line++;
            }
            continue;
        }
        if (state === "closed")
            throw new Error(
                "Unexpected character after quoted field at line " + line + "."
            );
        if (character === '"') {
            if (state !== "start")
                throw new Error(
                    "Unexpected quote in unquoted field at line " + line + "."
                );
            state = "quoted";
        } else {
            field += character;
            state = "plain";
        }
    }
    if (state === "quoted")
        throw new Error("Unclosed quoted field at line " + line + ".");
    if (field.length || record.length || state !== "start") {
        record.push(field);
        records.push(record);
    }
    return records;
}
