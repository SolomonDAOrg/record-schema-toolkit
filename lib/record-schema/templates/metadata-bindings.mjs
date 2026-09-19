/** Apply only the metadata destinations in the public template vocabulary. */
/** @param {import("../types/general.mjs").Metadata} metadata @param {string} target @param {string|boolean} value */
export function applyMetadataBinding(metadata, target, value) {
    if (typeof value !== "string") throw new Error("Metadata bindings require text: " + target);
    switch (target) {
        case "title": metadata.title = value; break;
        case "entity_name": metadata.entity_name = value; break;
        case "entity.legal_name": (metadata.entity ??= {}).legal_name = value; break;
        case "entity.short_name": (metadata.entity ??= {}).short_name = value; break;
        case "entity.jurisdiction": (metadata.entity ??= {}).jurisdiction = value; break;
        case "document.effective_date": (metadata.document ??= {}).effective_date = value || null; break;
        case "status.phase": metadata.status.phase = value; break;
        case "status.last_updated": metadata.status.last_updated = value; break;
        case "status.confidentiality": metadata.status.confidentiality = value; break;
        case "assembly.packet.cover.title": metadata.assembly.packet.cover.title = value; break;
        case "assembly.packet.cover.subtitle": metadata.assembly.packet.cover.subtitle = value; break;
        case "assembly.packet.cover.short_name": metadata.assembly.packet.cover.short_name = value; break;
        case "assembly.packet.cover.party_1": metadata.assembly.packet.cover.party_1 = value; break;
        case "assembly.packet.cover.party_2": metadata.assembly.packet.cover.party_2 = value; break;
        case "assembly.packet.cover.confidentiality": metadata.assembly.packet.cover.confidentiality = value; break;
        default: throw new Error("Unsupported metadata destination: " + target);
    }
}
