/** @typedef {import("../Metafile.mjs").Metafile} Metafile */
/** @typedef {import("../types/general.mjs").MetaCoverFormat} MetaCoverFormat */
/**
 * @typedef {Object} PacketVariables
 * @property {string} recordId
 * @property {string} recordVersion
 * @property {string} documentId
 * @property {string} documentVersion
 * @property {string} packetDocumentId
 * @property {string} documentTitle
 * @property {string} coverTitle
 * @property {string} coverSubtitle
 * @property {string} coverShortName
 * @property {string} coverParty1
 * @property {string} coverParty2
 * @property {string} coverConfidentiality
 */

/** @param {Metafile} metafile @param {MetaCoverFormat | null} cover @returns {PacketVariables} */
export function resolvePacketVariables(metafile, cover) {
    const metadata = metafile.data;
    const identity = metafile.resolveRenderMetadata();
    const documentTitle = metadata.assembly?.packet?.label ?? metadata.title;
    return {
        recordId: metadata.id,
        recordVersion: metadata.document?.version ?? metadata.version ?? "",
        documentId: identity.document_id,
        documentVersion: identity.version ?? "",
        packetDocumentId: metadata.assembly?.packet?.document_id ?? metadata.document?.document_id ?? metadata.id,
        documentTitle,
        coverTitle: cover?.title ?? documentTitle,
        coverSubtitle: cover?.subtitle ?? "",
        coverShortName: cover?.short_name ?? "",
        coverParty1: cover?.party_1 ?? "",
        coverParty2: cover?.party_2 ?? "",
        coverConfidentiality: cover?.confidentiality ?? ""
    };
}
