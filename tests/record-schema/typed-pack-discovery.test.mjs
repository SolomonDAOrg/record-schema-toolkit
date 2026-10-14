import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Profile } from '../../lib/record-schema/Profile.mjs';
import { Repository } from '../../lib/record-schema/Repository.mjs';
import { stringifyYaml } from '../../lib/parsing/yaml.mjs';

/** @type {import("../../lib/record-schema/types/general.mjs").ProfileData} */
const profile = {
    schema: 'record-schema-registry-profile', schema_version: 1, profile_id: 'typed-packs-v1',
    rules: { document_policies: { pack_paths: [
        { type: 'render', path: 'render.json' },
        { type: 'formatting', path: 'formatting.json' }
    ] } }
};

test('profile paths preserve order and filter by the declared pack type', () => {
    const value = new Profile(profile);
    assert.deepEqual(value.getPackPaths(), ['render.json', 'formatting.json']);
    assert.deepEqual(value.getPackPaths('render'), ['render.json']);
    assert.deepEqual(value.getPackPaths('formatting'), ['formatting.json']);
    assert.equal(value.hasPackPaths(), true);
});

test('legacy string paths retain their formatting-pack meaning', () => {
    const value = new Profile({ ...profile, rules: { document_policies: { pack_paths: ['legacy.json'] } } });
    assert.deepEqual(value.getPackPaths(), ['legacy.json']);
    assert.deepEqual(value.getPackPaths('formatting'), ['legacy.json']);
    assert.deepEqual(value.getPackPaths('render'), []);
});

test('repository discovery routes typed pack paths to their respective loaders', () => {
    const root = mkdtempSync(join(tmpdir(), 'record-typed-packs-'));
    try {
        writeFileSync(join(root, 'registry.profile.yaml'), stringifyYaml(profile));
        writeFileSync(join(root, 'render.json'), '{}');
        writeFileSync(join(root, 'formatting.json'), '{}');
        const discovery = Repository.discoverRepository(root);
        assert.deepEqual(discovery.pack_paths, ['formatting.json']);
        assert.deepEqual(discovery.render_pack_paths, ['render.json']);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
