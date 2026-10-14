import { deflateRawSync } from "node:zlib";

/** @type {Uint32Array} */
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    return value >>> 0;
});

/** @param {Uint8Array} bytes @returns {number} */
export function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
    return (value ^ 0xffffffff) >>> 0;
}

/** Write a deterministic, UTF-8 ZIP32 archive.
 * @param {ReadonlyMap<string, Uint8Array>} entries
 * @returns {Buffer}
 */
export function writeZip(entries) {
    if (entries.size > 65535) throw new Error("ZIP32 entry limit exceeded");
    const local = [];
    const central = [];
    let offset = 0;
    for (const [path, bytes] of entries) {
        if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) {
            throw new Error("Invalid package part path: " + path);
        }
        const name = Buffer.from(path, "utf8");
        const data = Buffer.from(bytes);
        const compressed = deflateRawSync(data);
        if (name.length > 65535 || data.length > 0xffffffff || compressed.length > 0xffffffff) {
            throw new Error("ZIP32 part limit exceeded");
        }
        const checksum = crc32(data);
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(0x800, 6);
        header.writeUInt16LE(8, 8);
        header.writeUInt16LE(33, 12);
        header.writeUInt32LE(checksum, 14);
        header.writeUInt32LE(compressed.length, 18);
        header.writeUInt32LE(data.length, 22);
        header.writeUInt16LE(name.length, 26);
        local.push(header, name, compressed);
        const directory = Buffer.alloc(46);
        directory.writeUInt32LE(0x02014b50, 0);
        directory.writeUInt16LE(20, 4);
        directory.writeUInt16LE(20, 6);
        header.copy(directory, 8, 6, 28);
        directory.writeUInt32LE(offset, 42);
        central.push(directory, name);
        offset += header.length + name.length + compressed.length;
        if (offset > 0xffffffff) throw new Error("ZIP32 archive limit exceeded");
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.size, 8);
    end.writeUInt16LE(entries.size, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, directory, end]);
}
