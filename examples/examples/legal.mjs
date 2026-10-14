import {
    createContainer,
    createHeading,
    createParagraph,
    createHorizontalRule,
    createArticle,
    createDefinition,
    createNotice,
    createSignatureBlock,
    TableNode,
    createStandardPipeline,
    createLegalKeepTogetherRule,
    createArticlePageBreakRule,
    createLegalDocumentConfig,
    writePdfOutput
} from "./util.mjs";

export function createLegalExample() {
    const root = createContainer({ id: "legal-doc" });

    root.appendChild(createHeading(1, "Definitions", { numbering: "1" }));
    root.appendChild(
        createParagraph(
            "The following terms shall have the meanings set forth below:"
        )
    );

    root.appendChild(
        createDefinition(
            "Agreement",
            "means this Software License Agreement, including all exhibits and schedules attached hereto."
        )
    );
    root.appendChild(
        createDefinition(
            "Confidential Information",
            "means any non-public information disclosed by either party to the other, whether orally or in writing, that is designated as confidential or that reasonably should be understood to be confidential."
        )
    );
    root.appendChild(
        createDefinition(
            "Effective Date",
            "means the date on which this Agreement is executed by both parties."
        )
    );
    root.appendChild(
        createDefinition(
            "Licensed Software",
            "means the software product(s) identified in Schedule A, including all updates, upgrades, and patches provided by Licensor."
        )
    );

    root.appendChild(createHorizontalRule());

    const article1 = createArticle("I", "Grant of License");
    const section1_1 = article1.addSection("1.1", "License Grant");
    section1_1.addParagraph(
        "Subject to the terms and conditions of this Agreement, Licensor hereby grants to Licensee a non-exclusive, non-transferable license to use the Licensed Software solely for Licensee's internal business purposes."
    );

    const section1_2 = article1.addSection("1.2", "License Restrictions");
    section1_2.addParagraph("Licensee shall not, directly or indirectly:");
    section1_2.addClause(
        "(a)",
        "modify, translate, adapt, or create derivative works based upon the Licensed Software;"
    );
    section1_2.addClause(
        "(b)",
        "reverse engineer, disassemble, decompile, or otherwise attempt to derive the source code of the Licensed Software;"
    );
    section1_2.addClause(
        "(c)",
        "sublicense, sell, resell, transfer, assign, or otherwise dispose of the Licensed Software;"
    );
    section1_2.addClause(
        "(d)",
        "use the Licensed Software for any purpose other than as expressly permitted hereunder."
    );
    root.appendChild(article1);

    const article2 = createArticle("II", "Payment Terms");
    const section2_1 = article2.addSection("2.1", "License Fees");
    section2_1.addParagraph(
        "Licensee shall pay to Licensor the license fees set forth in Schedule B. All fees are due within thirty (30) days of invoice date."
    );

    const section2_2 = article2.addSection("2.2", "Payment Schedule");
    const paymentTable = new TableNode({
        columns: [
            { width: "40%", align: "left" },
            { width: "30%", align: "right" },
            { width: "30%", align: "center" }
        ]
    });
    paymentTable.addHeaderRow(["Milestone", "Amount", "Due Date"]);
    paymentTable.addRow(["Initial License Fee", "$50,000", "Upon Execution"]);
    paymentTable.addRow(["Year 1 Maintenance", "$10,000", "Anniversary Date"]);
    paymentTable.addRow(["Year 2 Maintenance", "$10,500", "Anniversary +1yr"]);
    paymentTable.addRow(["Year 3 Maintenance", "$11,025", "Anniversary +2yr"]);
    section2_2.appendChild(paymentTable);
    root.appendChild(article2);

    const article3 = createArticle("III", "Warranties and Disclaimers");
    const section3_1 = article3.addSection("3.1", "Limited Warranty");
    section3_1.addParagraph(
        "Licensor warrants that the Licensed Software will perform substantially in accordance with its documentation for a period of ninety (90) days from the Effective Date."
    );
    root.appendChild(
        createNotice(
            'DISCLAIMER: EXCEPT FOR THE EXPRESS WARRANTIES SET FORTH IN THIS ARTICLE III, THE LICENSED SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.',
            { level: "warning", title: "WARRANTY DISCLAIMER" }
        )
    );
    root.appendChild(article3);

    root.appendChild(createHeading(1, "Execution"));
    root.appendChild(
        createParagraph(
            "IN WITNESS WHEREOF, the parties have executed this Agreement as of the date last written below."
        )
    );

    root.appendChild(
        createSignatureBlock({
            directive: "signature-block",
            variant: "panel",
            title: "LICENSOR COMPANY INC.",
            partyLabel: "LICENSOR COMPANY INC.",
            bodyText: "By its duly authorized representative:",
            fields: ["By", "Name", "Title", "Date"],
            values: {
                By: "___________________________",
                Name: "",
                Title: "Authorized Representative",
                Date: ""
            }
        })
    );

    root.appendChild(
        createSignatureBlock({
            directive: "signature-block",
            variant: "panel",
            title: "LICENSEE COMPANY LLC",
            partyLabel: "LICENSEE COMPANY LLC",
            bodyText: "By its duly authorized representative:",
            fields: ["By", "Name", "Title", "Date"],
            values: {
                By: "___________________________",
                Name: "",
                Title: "Authorized Representative",
                Date: ""
            }
        })
    );

    return {
        id: "legal-example",
        root,
        variables: {
            companyName: "SOLOMON LABS, INC.",
            documentTitle: "SOFTWARE LICENSE AGREEMENT",
            jurisdiction: "Delaware",
            effectiveDate: "January 15, 2026"
        }
    };
}

export function renderLegalExample(outputDir = "output") {
    const legalExample = createLegalExample();
    const legalDocumentConfig = createLegalDocumentConfig({
        companyName: legalExample.variables.companyName,
        documentTitle: legalExample.variables.documentTitle,
        jurisdiction: legalExample.variables.jurisdiction,
        effectiveDate: legalExample.variables.effectiveDate
    });

    const pipeline = createStandardPipeline({
        formattingRules: [
            createLegalKeepTogetherRule(),
            createArticlePageBreakRule()
        ],
        headingStyles: {
            1: { fontSize: 14, bold: true, textTransform: "uppercase" },
            2: { fontSize: 12, bold: true }
        },
        compositionConfig: legalDocumentConfig,
        rendererConfig: {
            variables: legalExample.variables,
            signatureBlockStyle: {
                borderColor: "#666666",
                borderWidth: 0.75,
                backgroundColor: "#fcfcfc",
                padding: 12,
                margin: { top: 8, right: 0, bottom: 10, left: 0 }
            },
            directiveStyles: {
                "signature-block": {
                    headerBackgroundColor: "#f2f2f2",
                    titleBackgroundColor: "#f7f7f7",
                    titleColor: "#222222",
                    fieldLabelWidth: 84,
                    signatureRowHeight: 20,
                    rowGap: 4,
                    bodyGap: 8,
                    headerGap: 8,
                    postGap: 10
                }
            }
        }
    });

    const result = pipeline.processSingle({
        ...legalExample,
        variables: legalExample.variables
    });
    writePdfOutput("legal-example.pdf", result, outputDir);
    return result;
}
