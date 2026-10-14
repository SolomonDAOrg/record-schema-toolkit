/**
 * Two-pass PDF generation examples entrypoint.
 * Split into logical modules under ./examples with shared helpers in util.mjs.
 */

export * from "./examples/index.mjs";

import { main } from "./examples/index.mjs";

try {
    main();
} catch (err) {
    console.error(err);
}
