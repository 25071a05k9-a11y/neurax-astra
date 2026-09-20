import React from "react";
import katex from "katex";
import { ScanLine, Eye } from "lucide-react";

interface MarkdownRendererProps {
  content: string;
  renderBlocks?: any[];
  onImageClick?: (src: string) => void;
}

function renderLatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex.trim(), {
      displayMode,
      throwOnError: false,
      output: "htmlAndMathml",
    });
  } catch (e) {
    return `<span class="katex-error">${tex}</span>`;
  }
}

// Format inline elements: math, images, code, bold, italic, links
function formatInlineText(
  text: string,
  onImageClick?: (src: string) => void,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];

  // Regex to match math $$...$$, $...$, images ![alt](url), code `...`, bold **...**, italic *...*
  const tokenRegex =
    /(\$\$[\s\S]+?\$\$|\$([^$\n]+?)\$|!\[(.*?)\]\((.*?)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];

    if (token.startsWith("$$") && token.endsWith("$$")) {
      // Block math inline
      const math = token.slice(2, -2);
      const html = renderLatex(math, true);
      nodes.push(
        <span
          key={match.index}
          className="latex-block"
          dangerouslySetInnerHTML={{ __html: html }}
        />,
      );
    } else if (
      token.startsWith("$") &&
      token.endsWith("$") &&
      token.length > 2
    ) {
      // Inline math
      const math = token.slice(1, -1);
      const html = renderLatex(math, false);
      nodes.push(
        <span
          key={match.index}
          className="latex-inline"
          dangerouslySetInnerHTML={{ __html: html }}
        />,
      );
    } else if (
      token.startsWith("![") &&
      match[3] !== undefined &&
      match[4] !== undefined
    ) {
      // Image
      const alt = match[3];
      const src = match[4];
      nodes.push(
        <div key={match.index} className="agent-rendered-image-wrap">
          <div className="agent-rendered-image-header">
            <span className="image-chip">
              <ScanLine size={13} /> {alt || "Surface Defect Visual"}
            </span>
            {onImageClick && (
              <button
                type="button"
                className="image-zoom-btn"
                onClick={() => onImageClick(src)}
                title="Inspect full image"
              >
                <Eye size={12} /> Inspect
              </button>
            )}
          </div>
          <img
            src={src}
            alt={alt}
            className="agent-rendered-image"
            onClick={() => onImageClick && onImageClick(src)}
          />
        </div>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code key={match.index} className="inline-code">
          {match[5]}
        </code>,
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={match.index}>{match[6]}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={match.index}>{match[7]}</em>);
    } else {
      nodes.push(token);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

export function MarkdownRenderer({
  content,
  renderBlocks = [],
  onImageClick,
}: MarkdownRendererProps) {
  if (!content && (!renderBlocks || renderBlocks.length === 0)) {
    return null;
  }

  // Pre-process content: defensively unwrap raw JSON or unescape literal \n
  let cleanContent = String(content || "").trim();
  if (cleanContent.startsWith("{") && cleanContent.includes('"answer"')) {
    try {
      const sanitized = cleanContent.replace(
        /\\(?!["\\/bfnrtu]|u[0-9a-fA-F]{4})/g,
        "\\\\",
      );
      const parsed = JSON.parse(sanitized);
      if (parsed.answer) cleanContent = String(parsed.answer).trim();
    } catch {
      const match = cleanContent.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
      if (match) {
        cleanContent = match[1]
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      }
    }
  }
  if (cleanContent.includes("\\n")) {
    cleanContent = cleanContent.replace(/\\n/g, "\n");
  }

  const lines = cleanContent.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let inMathBlock = false;
  let mathBlockLines: string[] = [];
  let inTable = false;
  let tableLines: string[] = [];

  const flushTable = (key: number) => {
    if (!tableLines.length) return;
    const headerLine = tableLines[0];
    const dataLines = tableLines.slice(2); // Skip separator |---|---|
    const headers = headerLine
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);

    elements.push(
      <div key={`table-${key}`} className="agent-table-wrapper">
        <table className="agent-table">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>{formatInlineText(h, onImageClick)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataLines.map((row, rIdx) => {
              const cells = row
                .split("|")
                .map((c) => c.trim())
                .filter(Boolean);
              return (
                <tr key={rIdx}>
                  {cells.map((c, cIdx) => (
                    <td key={cIdx}>{formatInlineText(c, onImageClick)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>,
    );
    tableLines = [];
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Math Block: $$ ... $$
    if (
      trimmed.startsWith("$$") &&
      trimmed.endsWith("$$") &&
      trimmed.length > 2
    ) {
      if (inTable) flushTable(i);
      const math = trimmed.slice(2, -2);
      elements.push(
        <div
          key={`math-one-${i}`}
          className="latex-display-math"
          dangerouslySetInnerHTML={{ __html: renderLatex(math, true) }}
        />,
      );
      continue;
    }

    if (trimmed === "$$") {
      if (inTable) flushTable(i);
      if (!inMathBlock) {
        inMathBlock = true;
        mathBlockLines = [];
      } else {
        inMathBlock = false;
        elements.push(
          <div
            key={`math-multi-${i}`}
            className="latex-display-math"
            dangerouslySetInnerHTML={{
              __html: renderLatex(mathBlockLines.join("\n"), true),
            }}
          />,
        );
      }
      continue;
    }

    if (inMathBlock) {
      mathBlockLines.push(line);
      continue;
    }

    // 2. Code Block: ``` ... ```
    if (trimmed.startsWith("```")) {
      if (inTable) flushTable(i);
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLines = [];
      } else {
        inCodeBlock = false;
        elements.push(
          <pre key={`code-${i}`} className="agent-code-block">
            <code>{codeBlockLines.join("\n")}</code>
          </pre>,
        );
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // 3. Table Line: | ... |
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      inTable = true;
      tableLines.push(trimmed);
      continue;
    } else if (inTable) {
      flushTable(i);
    }

    // 4. Horizontal Rule
    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      elements.push(<hr key={`hr-${i}`} className="agent-divider" />);
      continue;
    }

    // 5. Headings. Accept all Markdown levels and tolerate model output that
    // omits the optional space (for example, "####1. Finding").
    const headingMatch = trimmed.match(/^(#{1,6})\s*(\S.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingContent = formatInlineText(headingMatch[2], onImageClick);
      if (level === 1) {
        elements.push(
          <h2 key={`h1-${i}`} className="agent-h1">
            {headingContent}
          </h2>,
        );
      } else if (level === 2) {
        elements.push(
          <h3 key={`h2-${i}`} className="agent-h2">
            {headingContent}
          </h3>,
        );
      } else {
        elements.push(
          <h4 key={`h3-${i}`} className="agent-h3">
            {headingContent}
          </h4>,
        );
      }
      continue;
    }

    if (/^\[!WARNING\]$/i.test(trimmed)) {
      elements.push(
        <div key={`warning-${i}`} className="agent-callout warning">
          <strong>Warning</strong>
        </div>,
      );
      continue;
    }

    // 6. Blockquote
    if (trimmed.startsWith("> ")) {
      elements.push(
        <blockquote key={`quote-${i}`} className="agent-quote">
          {formatInlineText(trimmed.slice(2), onImageClick)}
        </blockquote>,
      );
      continue;
    }

    // 7. Bullet Lists
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      elements.push(
        <div key={`li-${i}`} className="agent-list-item">
          <span className="agent-bullet">•</span>
          <div>{formatInlineText(trimmed.slice(2), onImageClick)}</div>
        </div>,
      );
      continue;
    }

    // 8. Numbered Lists
    const numMatch = trimmed.match(/^(\d+)\\?\.\s*(.*)$/);
    if (numMatch) {
      elements.push(
        <div key={`num-${i}`} className="agent-list-item">
          <span className="agent-num-bullet">{numMatch[1]}.</span>
          <div>{formatInlineText(numMatch[2], onImageClick)}</div>
        </div>,
      );
      continue;
    }

    // 9. Empty line
    if (!trimmed) {
      elements.push(<div key={`sp-${i}`} className="agent-spacer" />);
      continue;
    }

    // 10. Standard Paragraph
    elements.push(
      <p key={`p-${i}`} className="agent-paragraph">
        {formatInlineText(line, onImageClick)}
      </p>,
    );
  }

  if (inTable) {
    flushTable(lines.length);
  }

  return (
    <div className="agent-rendered-content">
      {/* Optional structured render blocks (metrics, callouts) */}
      {Array.isArray(renderBlocks) && renderBlocks.length > 0 && (
        <div className="agent-render-blocks">
          {renderBlocks.map((b, idx) => {
            if (
              (b.type === "metric_row" || b.type === "metrics") &&
              Array.isArray(b.items)
            ) {
              return (
                <div key={idx} className="agent-metric-row">
                  {b.items.map((it: any, iIdx: number) => (
                    <div key={iIdx} className="agent-mini-metric">
                      <small>{it.label}</small>
                      <strong>{it.value}</strong>
                      {it.kind && (
                        <span className="agent-block-kind">
                          {String(it.kind).toUpperCase()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              );
            }
            if (b.type === "callout") {
              return (
                <div key={idx} className={`agent-callout ${b.tone || "fact"}`}>
                  <strong>{b.title}</strong>
                  <p>{b.text}</p>
                </div>
              );
            }
            if (b.type === "text") {
              return (
                <p key={idx} className="agent-paragraph">
                  {formatInlineText(String(b.text || ""), onImageClick)}
                </p>
              );
            }
            if (["evidence", "recommendation", "warning"].includes(b.type)) {
              return (
                <div key={idx} className={`agent-callout ${b.type}`}>
                  <strong>{b.title || b.type}</strong>
                  <p>{b.text}</p>
                  {b.kind && <small>{String(b.kind).toUpperCase()}</small>}
                </div>
              );
            }
            if (
              b.type === "table" &&
              Array.isArray(b.columns) &&
              Array.isArray(b.rows)
            ) {
              return (
                <div key={idx} className="agent-table-wrapper">
                  <table className="agent-table">
                    <thead>
                      <tr>
                        {b.columns.map((column: any, i: number) => (
                          <th key={i}>{String(column)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {b.rows.map((row: any[], r: number) => (
                        <tr key={r}>
                          {row.map((cell: any, c: number) => (
                            <td key={c}>{String(cell ?? "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }
            if (
              (b.type === "image" || b.type === "annotated-image") &&
              /^\/api\/artifacts\/ART-[A-Z0-9]+$/i.test(String(b.url || ""))
            ) {
              return (
                <div key={idx} className="agent-rendered-image-wrap">
                  <div className="agent-rendered-image-header">
                    <span className="image-chip">
                      <ScanLine size={13} />
                      {b.sample_id || b.label || "Detector artifact"}
                    </span>
                    {onImageClick && (
                      <button
                        type="button"
                        className="image-zoom-btn"
                        onClick={() => onImageClick(b.url)}
                      >
                        <Eye size={12} />
                        Inspect
                      </button>
                    )}
                  </div>
                  <img
                    src={b.url}
                    alt={`${b.defect_label || "Detector"} annotated evidence`}
                    className="agent-rendered-image"
                    onClick={() => onImageClick?.(b.url)}
                  />
                  <div className="agent-image-evidence">
                    <strong>{b.defect_label || "Inspected sample"}</strong>
                    {b.coverage != null && <span>{b.coverage}% coverage</span>}
                    {b.bounding_boxes?.length > 0 && (
                      <span>
                        {b.bounding_boxes.length} real detector region
                        {b.bounding_boxes.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </div>
              );
            }
            if (b.type === "simulation_result") {
              return (
                <div key={idx} className="agent-callout simulation">
                  <strong>{b.title || "Simulation result"}</strong>
                  <pre>{JSON.stringify(b.data || {}, null, 2)}</pre>
                </div>
              );
            }
            return null;
          })}
        </div>
      )}

      {/* Main Markdown + LaTeX Body */}
      {elements}
    </div>
  );
}
