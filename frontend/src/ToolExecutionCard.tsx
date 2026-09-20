import React, { useState } from 'react';
import { 
  Wrench, 
  ChevronDown, 
  ChevronRight, 
  CheckCircle2, 
  AlertCircle, 
  Code2, 
  Table, 
  ScanLine, 
  FileSpreadsheet, 
  Layers, 
  Activity,
  SlidersHorizontal
} from 'lucide-react';

export interface ExecutedTool {
  tool: string;
  arguments?: any;
  output?: any;
  status?: string;
  duration_ms?: number;
}

interface ToolExecutionCardProps {
  tools: ExecutedTool[];
  onImageClick?: (src: string) => void;
}

function getToolIcon(name: string) {
  if (name.includes('csv')) return <FileSpreadsheet size={14} className="tool-icon-csv" />;
  if (name.includes('detect') || name.includes('inspect')) return <ScanLine size={14} className="tool-icon-vision" />;
  if (name.includes('bottleneck')) return <Layers size={14} className="tool-icon-bottleneck" />;
  if (name.includes('anomaly') || name.includes('health')) return <Activity size={14} className="tool-icon-health" />;
  if (name.includes('simulate')) return <SlidersHorizontal size={14} className="tool-icon-sim" />;
  return <Wrench size={14} className="tool-icon-default" />;
}

export function ToolExecutionCard({ tools, onImageClick }: ToolExecutionCardProps) {
  const [expanded, setExpanded] = useState(true);

  if (!Array.isArray(tools) || tools.length === 0) {
    return null;
  }

  return (
    <div className="tool-execution-card">
      <button 
        type="button" 
        className="tool-execution-summary-btn"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="tool-summary-left">
          <span className="tool-indicator-badge">
            <Wrench size={12} /> {tools.length} {tools.length === 1 ? 'Tool Used' : 'Tools Executed'}
          </span>
          <div className="tool-chips-preview">
            {tools.map((t, idx) => (
              <span key={idx} className="tool-mini-chip">
                {getToolIcon(t.tool)}
                <code>{t.tool}</code>
              </span>
            ))}
          </div>
        </div>
        <div className="tool-summary-right">
          <span className="tool-status-tag">Completed</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {expanded && (
        <div className="tool-execution-details">
          {tools.map((t, idx) => {
            const output = t.output || {};
            const isError = Boolean(output.error || output.status === 'error' || t.status === 'failed');
            const isRunning = t.status === 'running';
            const annotatedImage = output.annotated_image || output.annotated_image_data_uri || '';
            const hasAnnotatedImg = Boolean(annotatedImage);
            const hasCsvRows = Array.isArray(output.rows) && output.rows.length > 0;

            return (
              <div key={idx} className="tool-item-row active">
                <div className="tool-item-header">
                  <div className="tool-name-wrap">
                    {getToolIcon(t.tool)}
                    <strong>{t.tool}</strong>
                    {isRunning ? (
                      <span className="status-badge"><Activity className="spin" size={11} /> Running</span>
                    ) : isError ? (
                      <span className="status-badge error"><AlertCircle size={11} /> Failed</span>
                    ) : (
                      <span className="status-badge success"><CheckCircle2 size={11} /> Success</span>
                    )}
                  </div>
                  <ChevronDown size={13} />
                </div>

                <div className="tool-item-body">
                    {/* Tool Arguments */}
                    <div className="tool-section">
                      <small className="tool-section-label">INPUT ARGUMENTS</small>
                      <pre className="tool-json-preview">
                        <code>{JSON.stringify(t.arguments || {}, null, 2)}</code>
                      </pre>
                    </div>

                    {/* Tool Visual Output (for image detector) */}
                    {hasAnnotatedImg && (
                      <div className="tool-section">
                        <small className="tool-section-label">DETECTOR BOUNDING BOX OUTPUT</small>
                        <div className="tool-annotated-image-box">
                          <img 
                            src={annotatedImage} 
                            alt={`Detected ${output.defect_type || 'defect'}`}
                            className="tool-preview-thumb"
                            onClick={() => onImageClick && onImageClick(annotatedImage)}
                          />
                          <div className="tool-detection-meta">
                            <div className="meta-pill">
                              <span className="dot amber" />
                              <strong>{output.defect_type?.toUpperCase() || 'DEFECT'}</strong>
                              {typeof output.classifier?.confidence === 'number' && <span>{output.classifier.confidence}% model probability</span>}
                            </div>
                            {output.overall_box && (
                              <div className="meta-coords">
                                <span>Box: [{output.overall_box.ymin}, {output.overall_box.xmin}, {output.overall_box.ymax}, {output.overall_box.xmax}]</span>
                                <span>Coverage: {output.coverage_percent ?? 0}%</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Tool CSV Table Output */}
                    {hasCsvRows && (
                      <div className="tool-section">
                        <small className="tool-section-label">
                          RETRIEVED CSV ROWS ({output.rows.length} rows, {output.total_rows || output.rows.length} total)
                        </small>
                        <div className="tool-table-wrap">
                          <table className="tool-mini-table">
                            <thead>
                              <tr>
                                {Object.keys(output.rows[0]).slice(0, 7).map(col => (
                                  <th key={col}>{col}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {output.rows.slice(0, 6).map((r: any, rIdx: number) => (
                                <tr key={rIdx}>
                                  {Object.keys(output.rows[0]).slice(0, 7).map(col => (
                                    <td key={col}>{String(r[col] ?? '')}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Summary / Result Text */}
                    {output.summary && (
                      <div className="tool-section">
                        <small className="tool-section-label">TOOL RESULT SUMMARY</small>
                        <p className="tool-summary-text">{output.summary}</p>
                      </div>
                    )}

                    {/* Raw output toggle */}
                    <details className="tool-raw-toggle">
                      <summary><Code2 size={12} /> View Raw Output Payload</summary>
                      <pre className="tool-json-preview">
                        <code>{JSON.stringify(output, null, 2)}</code>
                      </pre>
                    </details>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
