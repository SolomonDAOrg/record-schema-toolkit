import assert from "node:assert/strict";
import test from "node:test";

import { Repository } from "../lib/record-schema/Repository.mjs";
import { IndManager } from "../lib/record-schema/IndManager.mjs";
import { RenderPack } from "../lib/record-schema/RenderPack.mjs";
import { FilingPacketGenerator } from "../lib/record-schema/generators/FilingPacketGenerator.mjs";

function renderPack(packId, headerText) {
    return new RenderPack({
        schema: "record-schema-render-pack",
        schema_version: 1,
        pack_id: packId,
        packet_config: {
            header_text: headerText,
        },
        document_policies: {
            targets: {
                pdf: {
                    format: "pdf",
                },
            },
        },
    }, null);
}

test("an explicitly provided render pack overrides repository resolution", () => {
    const repositoryResolvedPack = renderPack("estate", "PRIVATE ESTATE DRAFT");
    const explicitPack = renderPack("deployment-release", "CHANCERY DEPLOYMENT RECORD");
    const repository = new Repository(process.cwd());
    repository.getResolvedRenderPack = () => repositoryResolvedPack;
    repository.getLoadedRenderPacks = () => [repositoryResolvedPack];
    const generator = new FilingPacketGenerator(repository, new IndManager(null), explicitPack, false, true);
    const resolved = generator["_resolveActiveRenderPack"]({ record_id: "ABC-00001", dir_name: "ABC-00001", abs_path: process.cwd(), rel_path: "ABC-00001", bucket: null, metafile: null }, {});
    assert.equal(resolved.getId(), "deployment-release");
    assert.equal(resolved.getResolvedPacketConfig().header_text, "CHANCERY DEPLOYMENT RECORD");
});
