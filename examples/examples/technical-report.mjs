import {
    createContainer,
    createHeading,
    createParagraph,
    createList,
    createCodeBlock,
    createBold,
    createItalic,
    createText,
    ParagraphNode,
    TableNode,
    createNotice,
    createStandardPipeline,
    writePdfOutput
} from "./util.mjs";

export function createTechnicalReport() {
    const root = createContainer({ id: "tech-report" });

    root.appendChild(
        createHeading(1, "DeFi Protocol Performance Analysis", { id: "intro" })
    );

    root.appendChild(
        createParagraph(
            "This report presents a comprehensive analysis of yield optimization strategies across various DeFi protocols. The analysis covers performance metrics, risk assessments, and strategic recommendations."
        )
    );

    root.appendChild(
        createHeading(2, "Executive Summary", { id: "exec-summary" })
    );

    const summaryParagraph = new ParagraphNode([]);
    summaryParagraph.appendChild(createText("Our analysis of "));
    summaryParagraph.appendChild(createBold("15 major DeFi protocols"));
    summaryParagraph.appendChild(createText(" over the past quarter reveals "));
    summaryParagraph.appendChild(createItalic("significant opportunities"));
    summaryParagraph.appendChild(
        createText(
            " for yield optimization through strategic liquidity positioning."
        )
    );
    root.appendChild(summaryParagraph);

    root.appendChild(createHeading(2, "Key Findings", { id: "findings" }));

    const findingsTable = new TableNode({
        columns: [
            { width: "25%", align: "left" },
            { width: "15%", align: "center" },
            { width: "15%", align: "center" },
            { width: "15%", align: "center" },
            { width: "30%", align: "left" }
        ],
        borderStyle: { width: 0.5, color: "#666666" }
    });

    findingsTable.addHeaderRow([
        "Protocol",
        "APY",
        "TVL (M)",
        "Risk Score",
        "Notes"
    ]);
    findingsTable.addRow([
        "Meteora DLMM",
        "24.5%",
        "$142.3",
        "Medium",
        "High IL in volatile pairs"
    ]);
    findingsTable.addRow([
        "Raydium CLMM",
        "18.2%",
        "$89.7",
        "Low-Med",
        "Stable performance"
    ]);
    findingsTable.addRow([
        "Orca Whirlpools",
        "21.8%",
        "$156.4",
        "Medium",
        "Strong SOL pairs"
    ]);
    findingsTable.addRow([
        "Kamino Finance",
        "15.4%",
        "$234.1",
        "Low",
        "Automated strategies"
    ]);
    findingsTable.addRow([
        "MarginFi",
        "12.8%",
        "$312.6",
        "Low",
        "Lending focus"
    ]);
    root.appendChild(findingsTable);

    root.appendChild(createHeading(2, "Methodology", { id: "methodology" }));
    root.appendChild(
        createParagraph("Our analysis employed the following methodology:")
    );

    const methodList = createList("ordered");
    methodList.addItem(
        "Data collection from on-chain sources via RPC nodes and indexers"
    );
    methodList.addItem(
        "Statistical analysis of historical yield and volatility patterns"
    );
    methodList.addItem(
        "Risk modeling using Monte Carlo simulations (n=10,000)"
    );
    methodList.addItem("Backtesting of optimal positioning strategies");
    methodList.addItem("Peer review and validation of findings");
    root.appendChild(methodList);

    root.appendChild(createHeading(2, "Implementation Example", { id: "impl" }));
    root.appendChild(
        createParagraph(
            "The following code demonstrates how to query pool state using our SDK:"
        )
    );

    root.appendChild(
        createCodeBlock(
            `import { DlmmPoolClient } from "@solomon-labs/dlmm";
import { PublicKey } from "@solomon-labs/publickey";

async function analyzePool(poolAddress: string): Promise<PoolAnalysis> {
    const client = new DlmmPoolClient({
        rpcUrl: "https://api.mainnet-beta.solana.com"
    });

    const pool = await client.getPool(new PublicKey(poolAddress));
    const binData = await client.getBinArrays(pool);

    return {
        totalLiquidity: pool.totalLiquidity,
        currentPrice: pool.getCurrentPrice(),
        activeBinId: pool.activeBinId,
        feeRate: pool.feeRate,
        bins: binData.map(b => ({
            id: b.binId,
            liquidity: b.liquidity,
            price: b.price
        }))
    };
}`,
            { language: "typescript", lineNumbers: true, startLine: 1 }
        )
    );

    root.appendChild(
        createHeading(2, "Risk Assessment Matrix", { id: "risk" })
    );

    const riskTable = new TableNode({
        stripedRows: true,
        columns: [
            { width: "20%", align: "left" },
            { width: "20%", align: "center" },
            { width: "20%", align: "center" },
            { width: "40%", align: "left" }
        ]
    });

    riskTable.addHeaderRow([
        "Risk Factor",
        "Probability",
        "Impact",
        "Mitigation Strategy"
    ]);
    riskTable.addRow([
        "Smart Contract Bug",
        "Low",
        "Critical",
        "Audit reports, insurance coverage"
    ]);
    riskTable.addRow([
        "Impermanent Loss",
        "High",
        "Medium",
        "Concentrated liquidity, hedging"
    ]);
    riskTable.addRow([
        "Oracle Manipulation",
        "Low",
        "High",
        "Multiple oracle sources, TWAP"
    ]);
    riskTable.addRow([
        "Regulatory Action",
        "Medium",
        "High",
        "Geo-restrictions, compliance"
    ]);
    riskTable.addRow([
        "Market Volatility",
        "High",
        "Medium",
        "Position sizing, stop-losses"
    ]);
    root.appendChild(riskTable);

    root.appendChild(
        createHeading(2, "Recommendations", { id: "recommendations" })
    );

    root.appendChild(
        createNotice(
            "Based on our analysis, we recommend a diversified approach across multiple protocols with emphasis on risk-adjusted returns rather than raw APY figures.",
            { level: "important", title: "Strategic Recommendation" }
        )
    );

    const recommendations = createList("unordered");
    recommendations.addItem(
        "Allocate 40% to stable pair pools for consistent base yield"
    );
    recommendations.addItem(
        "Maintain 30% in concentrated liquidity positions for higher returns"
    );
    recommendations.addItem(
        "Reserve 20% for opportunistic plays during volatility"
    );
    recommendations.addItem(
        "Keep 10% in stablecoin reserves for rebalancing"
    );
    root.appendChild(recommendations);

    root.appendChild(createHeading(2, "Conclusion", { id: "conclusion" }));
    root.appendChild(
        createParagraph(
            "The DeFi ecosystem continues to evolve rapidly, presenting both opportunities and risks for yield optimization strategies. By maintaining a disciplined approach to risk management and continuously monitoring protocol developments, investors can achieve sustainable returns while minimizing downside exposure."
        )
    );

    return { id: "tech-report", root };
}

export function renderTechnicalReport(outputDir = "output") {
    const pageVar = { type: "variable", name: "page" };
    const totalVar = { type: "variable", name: "totalPages" };

    const pipeline = createStandardPipeline({
        compositionConfig: {
            coverPage: {
                elements: [
                    { type: "spacer", height: 150 },
                    {
                        type: "text",
                        content: "SOLOMON LABS",
                        style: {
                            fontSize: 14,
                            align: "center",
                            color: "#666666"
                        }
                    },
                    { type: "spacer", height: 40 },
                    {
                        type: "text",
                        content: "DeFi Protocol Performance Analysis",
                        style: {
                            fontSize: 28,
                            bold: true,
                            align: "center"
                        }
                    },
                    { type: "spacer", height: 20 },
                    {
                        type: "text",
                        content: "Q4 2025 Report",
                        style: { fontSize: 16, align: "center" }
                    },
                    { type: "spacer", height: 60 },
                    {
                        type: "text",
                        content: "Yield Optimization Strategies & Risk Assessment",
                        style: { fontSize: 12, align: "center", italic: true }
                    },
                    { type: "spacer", height: 200 },
                    {
                        type: "text",
                        content: "CONFIDENTIAL",
                        style: {
                            fontSize: 10,
                            align: "center",
                            color: "#999999"
                        }
                    },
                    {
                        type: "text",
                        content: "January 2026",
                        style: { fontSize: 10, align: "center" }
                    }
                ],
                countsInPageNumbers: false
            },
            toc: {
                title: "Table of Contents",
                titleStyle: { fontSize: 16, bold: true },
                levels: [1, 2],
                showPageNumbers: true,
                entryStyles: [
                    {
                        level: 1,
                        textStyle: { bold: true },
                        indent: 0,
                        leaderStyle: "dots"
                    },
                    {
                        level: 2,
                        textStyle: {},
                        indent: 24,
                        leaderStyle: "dots"
                    }
                ]
            },
            defaultHeaders: [
                {
                    location: "header",
                    pages: "not-first",
                    columns: {
                        left: {
                            content: "DeFi Performance Analysis",
                            style: { fontSize: 9 }
                        },
                        right: {
                            content: "Solomon Labs - Q4 2025",
                            style: { fontSize: 9 }
                        }
                    },
                    border: { width: 0.5 }
                }
            ],
            defaultFooters: [
                {
                    location: "footer",
                    pages: "not-first",
                    columns: {
                        left: {
                            content: "CONFIDENTIAL",
                            style: { fontSize: 8, color: "#999999" }
                        },
                        center: {
                            content: [pageVar, " of ", totalVar],
                            style: { fontSize: 9 }
                        },
                        right: {
                            content: {
                                type: "variable",
                                name: "date",
                                format: "YYYY-MM-DD"
                            },
                            style: { fontSize: 8 }
                        }
                    }
                }
            ]
        }
    });

    const result = pipeline.processSingle(createTechnicalReport());
    writePdfOutput("technical-report.pdf", result, outputDir);
    return result;
}
