"use client";

import { useState, useRef, useCallback } from "react";
import Nav from "@/components/nav";

interface ColumnInfo {
  name: string;
  type: string;
  nullCount: number;
  examples: string[];
}

interface DataAnalysis {
  rowCount: number;
  columnCount: number;
  columns: ColumnInfo[];
  insights: string[];
  anomalies: string[];
  summary: string;
}

const TYPE_COLORS: Record<string, string> = {
  number: "var(--blue)",
  string: "var(--green)",
  date: "#bf5af2",
  boolean: "#ff9f0a",
  mixed: "var(--red)",
};

export default function DataPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [isTruncated, setIsTruncated] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<DataAnalysis | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv")) {
      setError("Only CSV files are supported.");
      return;
    }
    setFileName(file.name);
    setFileSize(file.size);
    setError("");
    setAnalysis(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      const truncated = text.slice(0, 10000);
      setIsTruncated(text.length > 10000);

      setIsAnalyzing(true);
      try {
        const res = await fetch("/api/data/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csvText: truncated, fileName: file.name }),
        });
        const data = (await res.json()) as DataAnalysis;
        setAnalysis(data);
      } catch {
        setError("Analysis failed. Try again.");
      } finally {
        setIsAnalyzing(false);
      }
    };
    reader.readAsText(file);
  }, []);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

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
            Data
          </h1>
          <p
            className="t-subhead"
            style={{ color: "var(--label-3)", marginTop: 4 }}
          >
            Upload a CSV to get instant AI-powered insights and anomaly
            detection
          </p>
        </div>

        {/* Drop Zone */}
        <div
          className="fade-up delay-1"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `1.5px dashed ${isDragging ? "var(--blue)" : "var(--separator)"}`,
            borderRadius: 16,
            padding: "40px 24px",
            textAlign: "center",
            cursor: "pointer",
            background: isDragging
              ? "rgba(10,132,255,0.06)"
              : "var(--surface-1)",
            transition: "border-color 0.15s, background 0.15s",
            marginBottom: 16,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={handleFileInput}
          />

          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "var(--surface-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 14px",
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--label-3)"
              strokeWidth="1.5"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>

          {fileName ? (
            <>
              <p className="t-headline" style={{ color: "var(--label)" }}>
                {fileName}
              </p>
              <p
                className="t-footnote"
                style={{ color: "var(--label-3)", marginTop: 4 }}
              >
                {formatBytes(fileSize)}
                {isTruncated && " · First 10KB analyzed"}
              </p>
            </>
          ) : (
            <>
              <p className="t-headline" style={{ color: "var(--label)" }}>
                Drop a CSV file here
              </p>
              <p
                className="t-footnote"
                style={{ color: "var(--label-3)", marginTop: 4 }}
              >
                or click to browse. CSV only. Large files analyzed up to 10KB.
              </p>
            </>
          )}
        </div>

        {isTruncated && (
          <div
            className="fade-up"
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(255,149,0,0.08)",
              border: "0.5px solid rgba(255,149,0,0.3)",
              marginBottom: 14,
            }}
          >
            <p className="t-footnote" style={{ color: "#ff9f0a" }}>
              File exceeds 10KB. Analysis is based on the first 10,000
              characters. Results may not reflect the full dataset.
            </p>
          </div>
        )}

        {error && (
          <p
            className="t-footnote"
            style={{ color: "var(--red)", marginBottom: 12 }}
          >
            {error}
          </p>
        )}

        {/* Loading */}
        {isAnalyzing && (
          <div className="glass fade-up" style={{ padding: "24px 20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[0.4, 0.7, 0.5, 0.9, 0.3].map((w, i) => (
                <div
                  key={i}
                  className="animate-pulse"
                  style={{
                    height: 14,
                    background: "var(--surface-2)",
                    borderRadius: 6,
                    width: `${w * 100}%`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {analysis && (
          <>
            {/* Stats bar */}
            <div
              className="glass fade-up"
              style={{
                padding: "18px 20px",
                marginBottom: 12,
                display: "flex",
                gap: 32,
                flexWrap: "wrap",
              }}
            >
              {[
                { label: "Rows", val: analysis.rowCount.toLocaleString() },
                {
                  label: "Columns",
                  val: analysis.columnCount.toLocaleString(),
                },
                { label: "File", val: fileName },
              ].map((s) => (
                <div key={s.label}>
                  <p className="t-caption2" style={{ color: "var(--label-3)" }}>
                    {s.label}
                  </p>
                  <p
                    className="t-title3"
                    style={{
                      color: "var(--label)",
                      fontVariantNumeric: "tabular-nums",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 200,
                    }}
                  >
                    {s.val}
                  </p>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div
              className="glass fade-up delay-1"
              style={{
                padding: "16px 20px",
                marginBottom: 12,
                borderLeft: "2px solid var(--blue)",
              }}
            >
              <p
                className="t-subhead"
                style={{ color: "var(--label-2)", lineHeight: 1.6 }}
              >
                {analysis.summary}
              </p>
            </div>

            {/* Columns table */}
            <div
              className="glass fade-up delay-1"
              style={{ padding: "20px 20px", marginBottom: 12 }}
            >
              <p
                className="t-caption1"
                style={{
                  color: "var(--label-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 14,
                }}
              >
                Columns ({analysis.columnCount})
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 80px 60px 1fr",
                  gap: 8,
                  padding: "6px 0",
                  borderBottom: "0.5px solid var(--separator)",
                  marginBottom: 4,
                }}
              >
                {["Name", "Type", "Nulls", "Examples"].map((h) => (
                  <p
                    key={h}
                    className="t-caption2"
                    style={{ color: "var(--label-3)" }}
                  >
                    {h}
                  </p>
                ))}
              </div>

              {analysis.columns.map((col, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 80px 60px 1fr",
                    gap: 8,
                    padding: "9px 0",
                    borderBottom:
                      i < analysis.columns.length - 1
                        ? "0.5px solid var(--separator)"
                        : "none",
                    alignItems: "center",
                  }}
                >
                  <p
                    className="t-subhead"
                    style={{ color: "var(--label)", fontWeight: 500 }}
                  >
                    {col.name}
                  </p>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: TYPE_COLORS[col.type] ?? "var(--label-3)",
                      background: `${TYPE_COLORS[col.type] ?? "var(--surface-2)"}18`,
                      padding: "2px 8px",
                      borderRadius: 20,
                      border: `1px solid ${TYPE_COLORS[col.type] ?? "var(--separator)"}40`,
                      display: "inline-block",
                    }}
                  >
                    {col.type}
                  </span>
                  <p
                    className="t-subhead"
                    style={{
                      color: col.nullCount > 0 ? "#ff9f0a" : "var(--label-3)",
                    }}
                  >
                    {col.nullCount}
                  </p>
                  <p
                    className="t-footnote"
                    style={{
                      color: "var(--label-3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {col.examples.slice(0, 3).join(", ")}
                  </p>
                </div>
              ))}
            </div>

            {/* Insights */}
            {analysis.insights.length > 0 && (
              <div
                className="glass fade-up delay-2"
                style={{ padding: "20px 20px", marginBottom: 12 }}
              >
                <p
                  className="t-caption1"
                  style={{
                    color: "var(--label-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 14,
                  }}
                >
                  Insights
                </p>
                {analysis.insights.map((insight, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "10px 0",
                      borderBottom:
                        i < analysis.insights.length - 1
                          ? "0.5px solid var(--separator)"
                          : "none",
                    }}
                  >
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "var(--blue)",
                        marginTop: 6,
                        flexShrink: 0,
                      }}
                    />
                    <p
                      className="t-subhead"
                      style={{ color: "var(--label-2)" }}
                    >
                      {insight}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Anomalies */}
            {analysis.anomalies.length > 0 && (
              <div
                className="glass fade-up delay-3"
                style={{ padding: "20px 20px" }}
              >
                <p
                  className="t-caption1"
                  style={{
                    color: "var(--red)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 14,
                  }}
                >
                  Anomalies
                </p>
                {analysis.anomalies.map((anomaly, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "10px 0",
                      borderBottom:
                        i < analysis.anomalies.length - 1
                          ? "0.5px solid var(--separator)"
                          : "none",
                    }}
                  >
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "var(--red)",
                        marginTop: 6,
                        flexShrink: 0,
                      }}
                    />
                    <p
                      className="t-subhead"
                      style={{ color: "var(--label-2)" }}
                    >
                      {anomaly}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
