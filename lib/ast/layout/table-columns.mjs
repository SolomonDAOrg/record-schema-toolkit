/** @typedef {import("../types/core.mjs").ColumnDef} ColumnDef */
/** @typedef {{fontSize: number, measureColumn: (index: number) => number}} ColumnMeasurement */

/** @param {ReadonlyArray<ColumnDef> | undefined} columns @param {number} tableWidth @param {number} columnCount @param {ColumnMeasurement} [measurement] @returns {number[]} */
export function calculateTableColumnWidths(columns, tableWidth, columnCount, measurement) {
    if (!columns?.length) return Array.from({length: columnCount}, () => tableWidth / columnCount);
    const widths = [];
    const padded = [];
    const automatic = [];
    let fixedWidth = 0;
    for (let index = 0; index < Math.max(columnCount, columns.length); index++) {
        const column = columns[index];
        let width = 0;
        switch (column?.widthType) {
            case "max-content": case "max-content-padded":
                if (!measurement) throw new Error("Content-sized columns require table font and padding measurements.");
                width = measurement.measureColumn(index);
                if (column.widthType === "max-content-padded") padded.push(index);
                break;
            case "fixed":
                width = Number.parseFloat(String(column.width ?? 0));
                break;
            case "percent":
                width = tableWidth * (Number.parseFloat(String(column.width ?? 0)) / 100);
                break;
            default: break;
        }
        if (!Number.isFinite(width) || width < 0) throw new Error("Invalid table column width");
        widths.push(width);
        fixedWidth += width;
        if (!width) automatic.push(index);
    }
    if (padded.length && measurement) {
        const automaticWidth = Math.max(20, ...automatic.map(index => measurement.measureColumn(index)));
        const spare = Math.max(0, tableWidth - fixedWidth - automaticWidth * automatic.length);
        const extra = Math.min(measurement.fontSize * 2, spare / padded.length);
        for (const index of padded) widths[index] += extra;
        fixedWidth += extra * padded.length;
    }
    for (const index of automatic) widths[index] = Math.max(20, (tableWidth - fixedWidth) / automatic.length);
    const total = widths.reduce((sum, width) => sum + width, 0);
    if (total > 0 && Math.abs(total - tableWidth) > 0.5) {
        for (let index = 0; index < widths.length; index++) widths[index] *= tableWidth / total;
    }
    return widths;
}
