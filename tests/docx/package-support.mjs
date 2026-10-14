import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";

/** @param {Uint8Array} archive @returns {Map<string, string | Buffer>} */
export function readPackage(archive) {
    const bytes = Buffer.from(archive);
    const parts = new Map();
    let offset = 0;
    while (bytes.readUInt32LE(offset) === 0x04034b50) {
        assert.equal(bytes.readUInt16LE(offset + 6) & 8, 0);
        const method = bytes.readUInt16LE(offset + 8);
        const compressedSize = bytes.readUInt32LE(offset + 18);
        const size = bytes.readUInt32LE(offset + 22);
        const nameSize = bytes.readUInt16LE(offset + 26);
        const extraSize = bytes.readUInt16LE(offset + 28);
        const name = bytes.toString(
            "utf8",
            offset + 30,
            offset + 30 + nameSize
        );
        const start = offset + 30 + nameSize + extraSize;
        const compressed = bytes.subarray(start, start + compressedSize);
        const part = method === 8 ? inflateRawSync(compressed) : compressed;
        assert.equal(part.length, size, name);
        assert.equal(parts.has(name), false, "duplicate " + name);
        parts.set(
            name,
            /\.xml$|\.rels$/.test(name) ? part.toString("utf8") : part
        );
        offset = start + compressedSize;
    }
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const end = bytes.length - 22;
    assert.equal(bytes.readUInt32LE(end), 0x06054b50);
    assert.equal(bytes.readUInt16LE(end + 10), parts.size);
    assert.equal(bytes.readUInt32LE(end + 16), offset);
    for (const [name, part] of parts)
        if (typeof part === "string") assertXml(part, name);
    return parts;
}

/** @param {Map<string, string | Buffer>} parts @param {string} name @returns {string} */
export function readXmlPart(parts, name) {
    const part = parts.get(name);
    assert.ok(typeof part === "string", "Missing XML part: " + name);
    return part;
}

/** Check nesting, duplicate attributes, namespace bindings and XML escaping.
 * @param {string} xml @param {string} name
 */
function assertXml(xml, name) {
    const stack = [];
    const namespaces = [new Set(["xml"])];
    let offset = 0;
    for (const token of xml.matchAll(/<[^>]+>/g)) {
        assert.doesNotMatch(
            xml.slice(offset, token.index),
            /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9A-Fa-f]+;)/,
            name
        );
        offset = token.index + token[0].length;
        const text = token[0];
        if (text.startsWith("<?")) continue;
        if (text.startsWith("</")) {
            assert.equal(text.slice(2, -1), stack.pop(), name);
            namespaces.pop();
            continue;
        }
        const match = /^<([\w:.-]+)/.exec(text);
        assert.ok(match, name);
        const element = match[1];
        const scope = new Set(namespaces.at(-1));
        const attributes = new Set();
        for (const attribute of text.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
            assert.ok(
                !attributes.has(attribute[1]),
                name + " duplicate attribute"
            );
            attributes.add(attribute[1]);
            if (attribute[1].startsWith("xmlns:"))
                scope.add(attribute[1].slice(6));
            assert.doesNotMatch(
                attribute[2],
                /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9A-Fa-f]+;)/,
                name
            );
        }
        for (const qualified of [element, ...attributes]) {
            const prefix = qualified.split(":")[0];
            if (qualified.includes(":") && prefix !== "xmlns")
                assert.ok(
                    scope.has(prefix),
                    name + " unbound namespace " + prefix
                );
        }
        if (!text.endsWith("/>")) {
            stack.push(element);
            namespaces.push(scope);
        }
    }
    assert.deepEqual(stack, [], name);
}
