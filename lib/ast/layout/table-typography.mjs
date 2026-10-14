/** @typedef {import("../types/core.mjs").TableRenderConfig} TableRenderConfig */

/** @param {TableRenderConfig} configuration @param {number} baseFontSize @param {number} averageColumnWidth @returns {number} */
export function tableFontSize(configuration, baseFontSize, averageColumnWidth) {
    if (Number.isFinite(configuration.fontSize)) return configuration.fontSize;
    let size = Number.isFinite(configuration.fontSizeScale) ? baseFontSize * configuration.fontSizeScale : baseFontSize;
    if ((configuration.autoShrink ?? true) !== false) {
        if (averageColumnWidth < 80) size *= 0.9;
        if (averageColumnWidth < 60) size *= 0.85;
        if (averageColumnWidth < 45) size *= 0.8;
    }
    const minimum = configuration.minFontSize ?? 7.5;
    const maximum = configuration.maxFontSize ?? baseFontSize;
    if (Number.isFinite(minimum)) size = Math.max(minimum, size);
    if (Number.isFinite(maximum)) size = Math.min(maximum, size);
    return size;
}

/** @param {TableRenderConfig} configuration @param {number} baseLineHeight @returns {number} */
export function tableLineHeight(configuration, baseLineHeight) {
    if (Number.isFinite(configuration.lineHeight) && configuration.lineHeight > 0) return configuration.lineHeight;
    const scale = configuration.lineHeightScale ?? configuration.lineSpacingScale;
    return Number.isFinite(scale) && scale > 0 ? baseLineHeight * scale : baseLineHeight;
}
