/** @typedef {import('./types.mjs').PageComposition} PageComposition */
/** @typedef {import('./types.mjs').PageCompositionSource} PageCompositionSource */
/** @typedef {import('../../types/core.mjs').ComposedSection} ComposedSection */

/**
 * Fixed compositions account for every source block exactly once.
 * Coordinates are PDF points measured from the physical page's top-left corner.
 * @param {PageComposition} configuration
 * @param {ReadonlyArray<ComposedSection>} sections
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @param {(node: import("../../nodes/BaseNode.mjs").BaseNode) => string} readHeading
 * @returns {Map<string, PageCompositionSource>}
 */
export function layoutPageComposition(configuration, sections, pageWidth, pageHeight, readHeading) {
    if (configuration.mode !== 'fixed') throw new Error('Unsupported page composition mode');
    if (sections.length !== 1) throw new Error('Fixed page composition requires one source document');
    if (configuration.regions.length === 0) throw new Error('Fixed page composition requires source regions');
    const source = new Map();
    let active = null;
    for (const node of sections[0].content) {
        if (node.type === 'heading') {
            const heading = readHeading(node).trim();
            if (source.has(heading)) throw new Error('Duplicate source heading: ' + heading);
            active = {heading, nodes: []};
            source.set(heading, active);
        } else {
            if (active === null) throw new Error('Content precedes the first source heading');
            if (node.type !== 'paragraph') throw new Error('Fixed page composition requires paragraph content: ' + active.heading);
            active.nodes.push(node);
        }
    }
    const selected = new Set();
    for (const region of configuration.regions) {
        if (!source.has(region.sourceHeading)) throw new Error('Missing source heading: ' + region.sourceHeading);
        if (selected.has(region.sourceHeading)) throw new Error('Source heading selected twice: ' + region.sourceHeading);
        if (source.get(region.sourceHeading).nodes.length === 0) throw new Error('Empty source block: ' + region.sourceHeading);
        selected.add(region.sourceHeading);
        if (!Number.isFinite(region.fontSize) || region.fontSize <= 0) throw new Error('Invalid region font size');
        if (region.lineSpacing !== undefined && (!Number.isFinite(region.lineSpacing) || region.lineSpacing < 1)) throw new Error('Invalid region line spacing');
        if (region.headingFontSize !== undefined && (!Number.isFinite(region.headingFontSize) || region.headingFontSize <= 0)) throw new Error('Invalid heading font size');
        for (const spacing of [region.paragraphGap, region.headingGap]) {
            if (spacing !== undefined && (!Number.isFinite(spacing) || spacing < 0)) throw new Error('Invalid region spacing');
        }
    }
    for (const heading of source.keys()) {
        if (!selected.has(heading)) throw new Error('Unplaced source heading: ' + heading);
    }
    for (const box of [...configuration.regions, ...(configuration.decorations ?? [])]) {
        if (![box.x, box.top, box.width, box.height].every(Number.isFinite) || box.x < 0 || box.top < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > pageWidth || box.top + box.height > pageHeight) {
            throw new Error('Page composition box lies outside the physical page');
        }
    }
    for (let first = 0; first < configuration.regions.length; first++) {
        const a = configuration.regions[first];
        for (let second = first + 1; second < configuration.regions.length; second++) {
            const b = configuration.regions[second];
            if (a.x < b.x + b.width && b.x < a.x + a.width && a.top < b.top + b.height && b.top < a.top + a.height) {
                throw new Error('Overlapping source regions: ' + a.sourceHeading + ' / ' + b.sourceHeading);
            }
        }
    }
    return source;
}
