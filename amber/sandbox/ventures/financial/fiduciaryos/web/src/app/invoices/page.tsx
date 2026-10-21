"use client";

import { useState, useCallback } from "react";
import Nav from "@/components/nav";

interface InvoiceItem {
  description: string;
  qty: number;
  rate: number;
  amount: number;
}

interface InvoiceData {
  invoiceNumber: string;
  date: string;
  dueDate: string;
  clientName: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  notes: string;
}

function fmt$(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function loadSavedInvoices(): InvoiceData[] {
  if (typeof window === "undefined") return [];
  try {
    const s = localStorage.getItem("fidos_invoices");
    return s ? (JSON.parse(s) as InvoiceData[]) : [];
  } catch {
    return [];
  }
}

function saveInvoice(invoice: InvoiceData) {
  if (typeof window === "undefined") return;
  const existing = loadSavedInvoices();
  const updated = [invoice, ...existing].slice(0, 5);
  localStorage.setItem("fidos_invoices", JSON.stringify(updated));
}

export default function InvoicesPage() {
  const [clientName, setClientName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [items, setItems] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [error, setError] = useState("");

  const inputStyle = {
    background: "var(--surface-1)",
    border: "0.5px solid var(--separator)",
    color: "var(--label)",
    padding: "10px 14px",
    borderRadius: 10,
    width: "100%",
    fontSize: 14,
    fontFamily: "var(--font)",
    outline: "none",
  };

  const generate = useCallback(async () => {
    if (!clientName.trim() || !projectDescription.trim()) {
      setError("Client name and project description are required.");
      return;
    }
    setError("");
    setIsGenerating(true);
    setInvoiceData(null);

    try {
      const res = await fetch("/api/invoices/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: projectDescription,
          clientName,
          items,
        }),
      });

      if (!res.body) throw new Error("No stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
      }

      // Extract JSON from the streamed SSE-style response
      let jsonStr = raw;
      // Strip SSE event wrapper if present
      const dataLines = raw
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6));

      if (dataLines.length > 0) {
        // Accumulate text_delta events
        let accumulated = "";
        for (const line of dataLines) {
          try {
            const parsed = JSON.parse(line) as {
              type?: string;
              delta?: { type?: string; text?: string };
              index?: number;
            };
            if (
              parsed.type === "content_block_delta" &&
              parsed.delta?.type === "text_delta"
            ) {
              accumulated += parsed.delta.text ?? "";
            }
          } catch {
            // not JSON, skip
          }
        }
        if (accumulated) jsonStr = accumulated;
      }

      // Find JSON object in string
      const start = jsonStr.indexOf("{");
      const end = jsonStr.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        const invoice = JSON.parse(
          jsonStr.slice(start, end + 1),
        ) as InvoiceData;
        setInvoiceData(invoice);
        saveInvoice(invoice);
      } else {
        setError("Could not parse invoice. Try again.");
      }
    } catch {
      setError("Generation failed. Check your connection.");
    } finally {
      setIsGenerating(false);
    }
  }, [clientName, projectDescription, items]);

  return (
    <>
      <Nav />
      <main
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "68px 24px 40px",
          background: "var(--bg)",
          minHeight: "100dvh",
        }}
      >
        <div className="fade-up" style={{ marginBottom: 28 }}>
          <h1 className="t-large-title" style={{ color: "var(--label)" }}>
            Invoices
          </h1>
          <p
            className="t-subhead"
            style={{ color: "var(--label-3)", marginTop: 4 }}
          >
            Describe your project and generate a professional invoice instantly
          </p>
        </div>

        {/* Form */}
        <div
          className="glass fade-up delay-1"
          style={{ padding: "20px 20px", marginBottom: 16 }}
        >
          <p
            className="t-caption1"
            style={{
              color: "var(--label-3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 16,
            }}
          >
            Invoice Details
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <p
                className="t-footnote"
                style={{ color: "var(--label-2)", marginBottom: 6 }}
              >
                Client Name
              </p>
              <input
                style={inputStyle}
                placeholder="Acme Corp"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>

            <div>
              <p
                className="t-footnote"
                style={{ color: "var(--label-2)", marginBottom: 6 }}
              >
                Project Description
              </p>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
                placeholder="Brand identity redesign including logo, color system, and style guide..."
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
              />
            </div>

            <div>
              <p
                className="t-footnote"
                style={{ color: "var(--label-2)", marginBottom: 6 }}
              >
                Line Items{" "}
                <span style={{ color: "var(--label-3)" }}>
                  (optional, one per line: description qty rate)
                </span>
              </p>
              <textarea
                style={{
                  ...inputStyle,
                  minHeight: 80,
                  resize: "vertical",
                  fontFamily: "monospace",
                  fontSize: 13,
                }}
                placeholder={
                  "Logo Design 1 2500\nBrand Guidelines 1 1500\nRevisions 3 200"
                }
                value={items}
                onChange={(e) => setItems(e.target.value)}
              />
            </div>

            {error && (
              <p className="t-footnote" style={{ color: "var(--red)" }}>
                {error}
              </p>
            )}

            <button
              onClick={generate}
              disabled={isGenerating}
              style={{
                background: isGenerating ? "var(--surface-2)" : "var(--green)",
                color: isGenerating ? "var(--label-3)" : "#000",
                fontWeight: 600,
                padding: "10px 20px",
                borderRadius: 10,
                cursor: isGenerating ? "not-allowed" : "pointer",
                border: "none",
                fontSize: 14,
                fontFamily: "var(--font)",
                alignSelf: "flex-start",
                transition: "background 0.15s",
              }}
            >
              {isGenerating ? "Generating..." : "Generate Invoice"}
            </button>
          </div>
        </div>

        {/* Invoice Preview */}
        {isGenerating && (
          <div className="glass fade-up" style={{ padding: "20px 20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[0.6, 0.4, 0.8, 0.5].map((w, i) => (
                <div
                  key={i}
                  className="animate-pulse"
                  style={{
                    height: 16,
                    background: "var(--surface-2)",
                    borderRadius: 6,
                    width: `${w * 100}%`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {invoiceData && (
          <div
            className="glass fade-up"
            style={{ padding: "28px 28px", marginTop: 16 }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 24,
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div>
                <p
                  className="t-title2"
                  style={{ color: "var(--label)", fontWeight: 700 }}
                >
                  Invoice
                </p>
                <p
                  className="t-footnote"
                  style={{ color: "var(--label-3)", marginTop: 2 }}
                >
                  {invoiceData.invoiceNumber}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p className="t-footnote" style={{ color: "var(--label-3)" }}>
                  Issued {invoiceData.date}
                </p>
                <p className="t-footnote" style={{ color: "var(--label-3)" }}>
                  Due {invoiceData.dueDate}
                </p>
              </div>
            </div>

            <p
              className="t-subhead"
              style={{ color: "var(--label-2)", marginBottom: 20 }}
            >
              Bill to:{" "}
              <span style={{ color: "var(--label)", fontWeight: 600 }}>
                {invoiceData.clientName}
              </span>
            </p>

            {/* Line items table */}
            <div
              style={{
                borderRadius: 8,
                overflow: "hidden",
                border: "0.5px solid var(--separator)",
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 60px 80px 80px",
                  gap: 0,
                  background: "var(--surface-2)",
                  padding: "8px 14px",
                }}
              >
                {["Description", "Qty", "Rate", "Amount"].map((h) => (
                  <p
                    key={h}
                    className="t-caption2"
                    style={{
                      color: "var(--label-3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {h}
                  </p>
                ))}
              </div>

              {invoiceData.items.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 60px 80px 80px",
                    padding: "10px 14px",
                    borderTop: "0.5px solid var(--separator)",
                  }}
                >
                  <p className="t-subhead" style={{ color: "var(--label)" }}>
                    {item.description}
                  </p>
                  <p className="t-subhead" style={{ color: "var(--label-2)" }}>
                    {item.qty}
                  </p>
                  <p className="t-subhead" style={{ color: "var(--label-2)" }}>
                    {fmt$(item.rate)}
                  </p>
                  <p
                    className="t-subhead"
                    style={{ color: "var(--label)", fontWeight: 500 }}
                  >
                    {fmt$(item.amount)}
                  </p>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                alignItems: "flex-end",
                marginBottom: 20,
              }}
            >
              <div style={{ display: "flex", gap: 40 }}>
                <p className="t-subhead" style={{ color: "var(--label-2)" }}>
                  Subtotal
                </p>
                <p
                  className="t-subhead"
                  style={{
                    color: "var(--label)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmt$(invoiceData.subtotal)}
                </p>
              </div>
              <div style={{ display: "flex", gap: 40 }}>
                <p className="t-subhead" style={{ color: "var(--label-2)" }}>
                  Tax
                </p>
                <p
                  className="t-subhead"
                  style={{
                    color: "var(--label)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmt$(invoiceData.tax)}
                </p>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 40,
                  paddingTop: 8,
                  borderTop: "0.5px solid var(--separator)",
                  marginTop: 4,
                }}
              >
                <p className="t-headline" style={{ color: "var(--label)" }}>
                  Total
                </p>
                <p
                  className="t-headline"
                  style={{
                    color: "var(--green)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmt$(invoiceData.total)}
                </p>
              </div>
            </div>

            {invoiceData.notes && (
              <div
                style={{
                  background: "var(--surface-1)",
                  borderRadius: 8,
                  padding: "12px 14px",
                  borderLeft: "2px solid var(--separator)",
                }}
              >
                <p
                  className="t-caption1"
                  style={{ color: "var(--label-3)", marginBottom: 4 }}
                >
                  Notes
                </p>
                <p className="t-footnote" style={{ color: "var(--label-2)" }}>
                  {invoiceData.notes}
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
