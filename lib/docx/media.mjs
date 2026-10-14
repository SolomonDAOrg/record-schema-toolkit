import { readFileSync } from "node:fs";
import { parseJpeg, parsePng } from "../pdf/image-embed.mjs";
import { SvgParser } from "../parsing/SvgParser.mjs";
import { escapeXml } from "./xml.mjs";
import { RELATIONSHIP_TYPES } from "./package/Package.mjs";

/** @typedef {import("./package/Package.mjs").DocxPackage} DocxPackage */
/** @typedef {import("../ast/nodes/ProseNode.mjs").ImageData} ImageData */

/** @param {Uint8Array} bytes @returns {{ extension: string, contentType: string, width: number, height: number }} */
function imageInformation(bytes) {
    const buffer = Buffer.from(bytes);
    if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
        const image = parsePng(bytes);
        return { extension: "png", contentType: "image/png", width: image.width, height: image.height };
    }
    if (buffer[0] === 255 && buffer[1] === 216) {
        const image = parseJpeg(bytes);
        return { extension: "jpg", contentType: "image/jpeg", width: image.width, height: image.height };
    }
    const source = buffer.toString("utf8");
    if (/<svg(?:\s|>)/.test(source)) {
        const root = SvgParser.parse(source).children.find(element => element.tag === "svg");
        if (!root) throw new Error("Missing SVG root");
        const viewBox = (root.attrs.viewBox ?? root.attrs.viewbox ?? "").trim().split(/[\s,]+/).map(Number);
        const width = Number.parseFloat(root.attrs.width) || viewBox[2];
        const height = Number.parseFloat(root.attrs.height) || viewBox[3];
        if (!(width > 0 && height > 0)) throw new Error("SVG requires dimensions or a viewBox");
        return { extension: "svg", contentType: "image/svg+xml", width, height };
    }
    throw new Error("DOCX images require PNG, JPEG or SVG");
}

/** @param {DocxPackage} archive @param {string} part @param {ImageData} image @param {number} identifier @param {number} maximumWidth @returns {string} */
export function imageRun(archive, part, image, identifier, maximumWidth) {
    let bytes = image.sourceBytes;
    if (!bytes) {
        const data = /^data:image\/(?:png|jpe?g|svg\+xml);base64,(.*)$/s.exec(image.src);
        if (data) bytes = Buffer.from(data[1], "base64");
        else {
            if (/^[a-z]+:\/\//i.test(image.src)) throw new Error("DOCX image must be resolved to local bytes: " + image.src);
            bytes = readFileSync(image.src);
        }
    }
    const information = imageInformation(bytes);
    const width = image.width ?? (image.height ? image.height * information.width / information.height : Math.min(maximumWidth, information.width));
    const height = image.height ?? width * information.height / information.width;
    if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error("Invalid DOCX image dimensions");
    const filename = "image" + identifier + "." + information.extension;
    archive.addPart("word/media/" + filename, bytes, information.contentType);
    const relationship = archive.relate(part, RELATIONSHIP_TYPES.image, "media/" + filename);
    const x = Math.round(width * 12700);
    const y = Math.round(height * 12700);
    const description = escapeXml(image.alt ?? image.title ?? "");
    const blip = '<a:blip r:embed="' + relationship + '">' + (information.extension === "svg" ? '<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="' + relationship + '"/></a:ext></a:extLst>' : "") + "</a:blip>";
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + x + '" cy="' + y +
        '"/><wp:docPr id="' + identifier + '" name="' + filename + '" descr="' + description +
        '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' +
        identifier + '" name="' + filename + '" descr="' + description +
        '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>' + blip + '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' +
        x + '" cy="' + y + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}
