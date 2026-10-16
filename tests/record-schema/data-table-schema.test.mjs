import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { Schema } from "../../lib/record-schema/Schema.mjs";

const path = new URL(
    "../../../record-schema/schema/document.template.schema.json",
    import.meta.url
);
test(
    "published dataset schema declares Markdown only for text columns",
    { skip: !existsSync(path) },
    () => {
        const template = JSON.parse(readFileSync(path, "utf8"));
        const dataset =
            template.properties.datasets.patternProperties[
                "^[A-Za-z][A-Za-z0-9]*$"
            ];
        const schema = new Schema(dataset.properties.columns.items);
        const column = {
            header: "Particulars",
            type: "text",
            align: "left",
            width: "auto"
        };
        for (const value of [
            column,
            { ...column, format: "plain" },
            { ...column, format: "markdown" }
        ])
            assert.deepEqual(schema.validate(value), []);
        for (const value of [
            { ...column, format: "html" },
            { ...column, type: "date", format: "markdown" },
            {
                ...column,
                type: "decimal",
                decimal_places: 2,
                rounding: "half-up",
                format: "markdown"
            }
        ])
            assert.notEqual(schema.validate(value).length, 0);
    }
);
