/** @typedef {{ symbols: number[]; widths: number[]; moduleCount: number }} Code128Encoding */

// Each symbol alternates bar and space widths, beginning with a bar.
const SYMBOL_WIDTHS = [
    '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
    '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
    '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
    '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
    '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
    '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
    '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
    '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
    '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
    '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
    '114131','311141','411131','211412','211214','211232','2331112'
];

/**
 * Encode a printable ASCII identifier using Code 128 set B.
 * @param {string} value
 * @returns {Code128Encoding}
 */
export function encodeCode128B(value) {
    if (!value || !/^[\x20-\x7e]+$/.test(value)) {
        throw new RangeError('Code 128-B requires nonempty printable ASCII text');
    }
    const symbols = [104];
    let checksum = 104;
    for (let index = 0; index < value.length; index++) {
        const symbol = value.charCodeAt(index) - 32;
        symbols.push(symbol);
        checksum += symbol * (index + 1);
    }
    symbols.push(checksum % 103, 106);
    const widths = symbols.flatMap(symbol => Array.from(SYMBOL_WIDTHS[symbol], Number));
    return { symbols, widths, moduleCount: widths.reduce((sum, width) => sum + width, 0) };
}
