import {
    createContainer,
    createHeading,
    createParagraph,
    createTableFromData,
    createTableFromObjects,
    TableNode,
    createStandardPipeline,
    createCenteredPageFooter,
    writePdfOutput
} from "./util.mjs";

/**
 * @returns {{ id: string; root: import("../../lib/ast/nodes/BaseNode.mjs").ContainerNode }}
 */
export function createTablesExample() {
    const root = createContainer({ id: "tables-doc" });

    root.appendChild(createHeading(1, "Tables Feature Demonstration"));
    root.appendChild(
        createParagraph(
            "This document demonstrates various table rendering capabilities."
        )
    );

    root.appendChild(createHeading(2, "Basic Data Table"));

    const basicTable = createTableFromData(
        [
            ["Product", "Q1 Sales", "Q2 Sales", "Q3 Sales", "Q4 Sales"],
            ["Widget A", "12,450", "14,200", "15,800", "18,300"],
            ["Widget B", "8,900", "9,100", "11,200", "12,400"],
            ["Widget C", "22,100", "24,500", "26,800", "28,900"],
            ["Widget D", "5,600", "6,200", "7,100", "8,500"]
        ],
        { headers: true }
    );
    basicTable.caption = "Quarterly Sales by Product";
    root.appendChild(basicTable);

    root.appendChild(
        createParagraph(
            "The table above shows quarterly sales figures with automatic column sizing."
        )
    );

    root.appendChild(createHeading(2, "Table with Column Definitions"));

    const financialTable = new TableNode({
        columns: [
            { width: "30%", align: "left" },
            { width: "17.5%", align: "right" },
            { width: "17.5%", align: "right" },
            { width: "17.5%", align: "right" },
            { width: "17.5%", align: "right" }
        ],
        borderStyle: { width: 1, color: "#333333" },
        stripedRows: true
    });

    financialTable.addHeaderRow([
        "Category",
        "Budget",
        "Actual",
        "Variance",
        "Var %"
    ]);
    financialTable.addRow([
        "Revenue",
        "$1,250,000",
        "$1,342,500",
        "$92,500",
        "7.4%"
    ]);
    financialTable.addRow([
        "Cost of Goods",
        "$625,000",
        "$598,750",
        "-$26,250",
        "-4.2%"
    ]);
    financialTable.addRow([
        "Gross Profit",
        "$625,000",
        "$743,750",
        "$118,750",
        "19.0%"
    ]);
    financialTable.addRow([
        "Operating Expenses",
        "$312,500",
        "$298,400",
        "-$14,100",
        "-4.5%"
    ]);
    financialTable.addRow([
        {
            content: "Net Income",
            style: { text: { bold: true }, box: { backgroundColor: "#e8e8e8" } }
        },
        { content: "$312,500", style: { text: { bold: true } } },
        { content: "$445,350", style: { text: { bold: true } } },
        { content: "$132,850", style: { text: { bold: true } } },
        { content: "42.5%", style: { text: { bold: true } } }
    ]);

    root.appendChild(financialTable);

    root.appendChild(createHeading(2, "Table from Objects Array"));

    const teamTable = createTableFromObjects(
        [
            {
                name: "Alice Chen",
                role: "Lead Developer",
                department: "Engineering",
                tenure: "5 years"
            },
            {
                name: "Bob Martinez",
                role: "Product Manager",
                department: "Product",
                tenure: "3 years"
            },
            {
                name: "Carol Williams",
                role: "UX Designer",
                department: "Design",
                tenure: "2 years"
            },
            {
                name: "David Kim",
                role: "Data Scientist",
                department: "Analytics",
                tenure: "4 years"
            },
            {
                name: "Eva Johnson",
                role: "DevOps Engineer",
                department: "Engineering",
                tenure: "1 year"
            }
        ],
        {
            columns: ["name", "role", "department", "tenure"],
            headers: {
                name: "Team Member",
                role: "Position",
                department: "Department",
                tenure: "Tenure"
            }
        }
    );
    root.appendChild(teamTable);

    return { id: "tables-example", root };
}

export function renderTablesExample(outputDir = "output") {
    const pipeline = createStandardPipeline({
        compositionConfig: {
            defaultFooters: createCenteredPageFooter("Page {page} of {total}")
        }
    });

    const result = pipeline.processSingle(createTablesExample());
    writePdfOutput("tables-example.pdf", result, outputDir);
    return result;
}
