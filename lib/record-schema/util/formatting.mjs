/**
 * Presentation-layer formatting and field-resolution utilities.
 *
 * Extracted from CoverPageGenerator — these are pure functions with no
 * generator/rendering state and are used across multiple generator classes.
 *
 * @module util/formatting
 */

import { isDateTime } from "../../util/general.mjs";

/**
 * Format an ISO date string as "DD Month YYYY".
 *
 * @param {string} iso_date
 * @returns {string}
 */
function formatDateLong(iso_date) {
    const m = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(iso_date);
    if (!m) {
        return iso_date;
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December"
    ];
    const month_name =
        month >= 1 && month <= 12 ? months[month - 1] : String(month);
    return `${day} ${month_name} ${year}`;
}

/**
 * Normalize a status/phase string to a display label.
 * Known phases become uppercase; everything else gets title-cased.
 *
 * @param {string} phase
 * @returns {string}
 */
function formatStatusLabel(phase) {
    const lower = phase.trim().toLowerCase();
    if (lower === "draft") {
        return "DRAFT";
    }
    if (lower === "final") {
        return "FINAL";
    }
    if (lower === "signed") {
        return "SIGNED";
    }
    return phase
        .trim()
        .replace(/[_-]+/g, " ")
        .replace(/\b([a-z])/g, (_, c) => String(c).toUpperCase());
}

/**
 * Strip the time portion from ISO datetime strings so formatDateLong
 * receives a plain YYYY-MM-DD value it can parse.
 * @param {string} raw
 * @returns {string}
 */
function normalizeToDateString(raw) {
    if (isDateTime(raw)) {
        return raw.slice(0, 10);
    }
    return raw;
}

export { formatDateLong, formatStatusLabel, normalizeToDateString };
