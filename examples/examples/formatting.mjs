import {
    createContainer,
    createHeading,
    createParagraph,
    createList,
    createBlockquote,
    createCodeBlock,
    createLink,
    createBold,
    createItalic,
    createUnderline,
    createInlineCode,
    createText,
    ParagraphNode,
    createStandardPipeline,
    createDatedHeader,
    createCenteredPageFooter,
    writePdfOutput
} from "./util.mjs";

/**
 * @returns {{ id: string; root: import("../../lib/ast/nodes/BaseNode.mjs").ContainerNode }}
 */
export function createFormattingExample() {
    const root = createContainer({ id: "formatting-doc" });

    root.appendChild(createHeading(1, "Rich Text Formatting"));

    const formattedParagraph = new ParagraphNode([]);
    formattedParagraph.appendChild(createText("This paragraph contains "));
    formattedParagraph.appendChild(createBold("bold text"));
    formattedParagraph.appendChild(createText(", "));
    formattedParagraph.appendChild(createItalic("italic text"));
    formattedParagraph.appendChild(createText(", and "));
    formattedParagraph.appendChild(createUnderline("underlined text"));
    formattedParagraph.appendChild(createText(". You can also combine them: "));
    formattedParagraph.appendChild(
        createBold([createItalic("bold and italic together")])
    );
    formattedParagraph.appendChild(createText("."));
    root.appendChild(formattedParagraph);

    root.appendChild(createHeading(2, "Code Formatting"));

    const codeParagraph = new ParagraphNode([]);
    codeParagraph.appendChild(createText("Inline code example: use "));
    codeParagraph.appendChild(createInlineCode("const x = 42;"));
    codeParagraph.appendChild(createText(" to declare a constant."));
    root.appendChild(codeParagraph);

    root.appendChild(
        createCodeBlock(
            `// TypeScript example
interface TokenConfig {
    readonly mint: string;
    readonly decimals: number;
    readonly symbol: string;
}

export function createToken(config: TokenConfig): Token {
    return new Token({
        mint: new PublicKey(config.mint),
        decimals: config.decimals,
        symbol: config.symbol
    });
}`,
            { language: "typescript", lineNumbers: true }
        )
    );

    root.appendChild(createHeading(2, "List Formatting"));
    root.appendChild(createParagraph("Unordered list example:"));

    const unorderedList = createList("unordered");
    unorderedList.addItem("First item in the list");
    unorderedList.addItem("Second item with more detail");
    unorderedList.addItem("Third item concluding the list");
    root.appendChild(unorderedList);

    root.appendChild(createParagraph("Ordered list example:"));

    const orderedList = createList("ordered", { numberStyle: "decimal" });
    orderedList.addItem("Configure your development environment");
    orderedList.addItem("Install the required dependencies");
    orderedList.addItem("Run the initialization script");
    orderedList.addItem("Verify the installation");
    root.appendChild(orderedList);

    root.appendChild(createHeading(2, "Blockquote"));
    root.appendChild(
        createBlockquote(
            "The best way to predict the future is to invent it. Programming is not about typing, it's about thinking.",
            { attribution: "Alan Kay" }
        )
    );

    root.appendChild(createHeading(2, "Hyperlinks"));

    const linkParagraph = new ParagraphNode([]);
    linkParagraph.appendChild(createText("Visit "));
    linkParagraph.appendChild(
        createLink("https://example.com", "our documentation", {
            target: "_blank"
        })
    );
    linkParagraph.appendChild(createText(" for more information."));
    root.appendChild(linkParagraph);

    return { id: "formatting-example", root };
}

export function renderFormattingExample(outputDir = "output") {
    const pipeline = createStandardPipeline({
        compositionConfig: {
            defaultHeaders: createDatedHeader("Rich Text Formatting Guide"),
            defaultFooters: createCenteredPageFooter("Page {page}")
        },
        rendererConfig: {
            baseFontSize: 11,
            lineHeight: 1.5
        }
    });

    const result = pipeline.processSingle(createFormattingExample());
    writePdfOutput("formatting-example.pdf", result, outputDir);
    return result;
}
