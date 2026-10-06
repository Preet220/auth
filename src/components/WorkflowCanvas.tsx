import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import {
  ZoomIn, ZoomOut, Maximize2, Undo2, Redo2, MousePointer2,
  Plus, Minus, Map as MapIcon,
} from 'lucide-react';
import type { Workflow, WorkflowNode, WorkflowEdge } from '@shared/types/workflow';

interface Props {
  workflow: Workflow;
  onChange: (wf: Workflow) => void;
  renderNodeContent?: (node: WorkflowNode) => ReactNode;
  nodeStatus?: (nodeId: string) => 'completed' | 'current' | 'pending' | 'none';
  readOnly?: boolean;
  onNodeClick?: (node: WorkflowNode) => void;
  selectedNodeId?: string | null;
  className?: string;
}

const NODE_W = 180;
const NODE_H = 80;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;

export function WorkflowCanvas({
  workflow,
  onChange,
  renderNodeContent,
  nodeStatus,
  readOnly = false,
  onNodeClick,
  selectedNodeId,
  className = '',
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragNode, setDragNode] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [showMinimap, setShowMinimap] = useState(true);
  const [history, setHistory] = useState<Workflow[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [spacePressed, setSpacePressed] = useState(false);

  // History management
  const pushHistory = useCallback((wf: Workflow) => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIndex + 1);
      const next = [...trimmed, wf];
      if (next.length > 50) next.shift();
      return next;
    });
    setHistoryIndex((prev) => Math.min(prev + 1, 49));
  }, [historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const prevWf = history[historyIndex - 1];
    if (prevWf) {
      setHistoryIndex(historyIndex - 1);
      onChange(prevWf);
    }
  }, [history, historyIndex, onChange]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const nextWf = history[historyIndex + 1];
    if (nextWf) {
      setHistoryIndex(historyIndex + 1);
      onChange(nextWf);
    }
  }, [history, historyIndex, onChange]);

  // Initialize history with the first workflow
  useEffect(() => {
    if (history.length === 0) {
      setHistory([workflow]);
      setHistoryIndex(0);
    }
  }, [workflow, history.length]);

  const commitChange = useCallback((wf: Workflow) => {
    pushHistory(wf);
    onChange(wf);
  }, [pushHistory, onChange]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.code === 'Space') {
        setSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [undo, redo]);

  // Coordinate conversion: screen → canvas
  const screenToCanvas = useCallback((sx: number, sy: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (sx - rect.left - pan.x) / zoom,
      y: (sy - rect.top - pan.y) / zoom,
    };
  }, [zoom, pan]);

  // Pan handlers
  const handlePanStart = (e: React.MouseEvent) => {
    if (readOnly || spacePressed || e.button === 1 || (e.button === 0 && spacePressed)) {
      setIsPanning(true);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (isPanning) {
      setPan((prev) => ({ x: prev.x + e.movementX, y: prev.y + e.movementY }));
    }

    if (dragNode) {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      const newX = canvasPos.x - dragNode.offsetX;
      const newY = canvasPos.y - dragNode.offsetY;
      const updatedNodes = workflow.nodes.map((n) =>
        n.id === dragNode.id ? { ...n, x: newX, y: newY } : n,
      );
      onChange({ ...workflow, nodes: updatedNodes });
    }

    if (connecting) {
      const cp = screenToCanvas(e.clientX, e.clientY);
      setMousePos(cp);
    }
  };

  const handleMouseUp = () => {
    if (dragNode) {
      pushHistory(workflow);
      setDragNode(null);
    }
    setIsPanning(false);
  };

  // Node drag
  const handleNodeMouseDown = (e: React.MouseEvent, node: WorkflowNode) => {
    if (readOnly) return;
    e.stopPropagation();
    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    setDragNode({
      id: node.id,
      offsetX: canvasPos.x - node.x,
      offsetY: canvasPos.y - node.y,
    });
  };

  // Connection drawing
  const handleNodeOutputMouseDown = (e: React.MouseEvent, nodeId: string) => {
    if (readOnly) return;
    e.stopPropagation();
    setConnecting(nodeId);
  };

  const handleNodeInputMouseUp = (e: React.MouseEvent, targetId: string) => {
    if (readOnly || !connecting) return;
    e.stopPropagation();
    if (connecting === targetId) {
      setConnecting(null);
      return;
    }
    const exists = workflow.edges.some(
      (ed) => ed.source === connecting && ed.target === targetId,
    );
    if (!exists) {
      const newEdge: WorkflowEdge = {
        id: crypto.randomUUID(),
        source: connecting,
        target: targetId,
      };
      commitChange({ ...workflow, edges: [...workflow.edges, newEdge] });
    }
    setConnecting(null);
  };

  // Delete node and its edges
  const handleDeleteNode = (nodeId: string) => {
    if (readOnly) return;
    const filteredNodes = workflow.nodes.filter((n) => n.id !== nodeId);
    const filteredEdges = workflow.edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId,
    );
    commitChange({ nodes: filteredNodes, edges: filteredEdges });
  };

  // Delete edge
  const handleDeleteEdge = (edgeId: string) => {
    if (readOnly) return;
    commitChange({ ...workflow, edges: workflow.edges.filter((e) => e.id !== edgeId) });
  };

  // Zoom
  const handleZoom = (delta: number, cx?: number, cy?: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const center = cx != null && cy != null
      ? { x: cx - rect.left, y: cy - rect.top }
      : { x: rect.width / 2, y: rect.height / 2 };
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta));
    const ratio = newZoom / zoom;
    setPan((prev) => ({
      x: center.x - (center.x - prev.x) * ratio,
      y: center.y - (center.y - prev.y) * ratio,
    }));
    setZoom(newZoom);
  };

  const fitToView = () => {
    if (workflow.nodes.length === 0) return;
    const xs = workflow.nodes.map((n) => n.x);
    const ys = workflow.nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs) + NODE_W;
    const maxY = Math.max(...ys) + NODE_H;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const w = maxX - minX;
    const h = maxY - minY;
    const padding = 60;
    const z = Math.min(
      (rect.width - padding * 2) / w,
      (rect.height - padding * 2) / h,
      1.5,
    );
    setZoom(Math.max(MIN_ZOOM, z));
    setPan({
      x: padding - minX * z + (rect.width - w * z) / 2 - padding,
      y: padding - minY * z + (rect.height - h * z) / 2 - padding,
    });
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    handleZoom(delta, e.clientX, e.clientY);
  };

  // Edge path calculation
  const edgePath = (source: WorkflowNode, target: WorkflowNode): string => {
    const sx = source.x + NODE_W / 2;
    const sy = source.y + NODE_H;
    const tx = target.x + NODE_W / 2;
    const ty = target.y;
    const midY = (sy + ty) / 2;
    return `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;
  };

  // Render edge label midpoint
  const edgeLabelPos = (source: WorkflowNode, target: WorkflowNode) => {
    const sx = source.x + NODE_W / 2;
    const sy = source.y + NODE_H;
    const tx = target.x + NODE_W / 2;
    const ty = target.y;
    return { x: (sx + tx) / 2, y: (sy + ty) / 2 };
  };

  const statusColors: Record<string, string> = {
    completed: '#10b981',
    current: '#3b82f6',
    pending: '#94a3b8',
    none: '#cbd5e1',
  };

  // Minimap dimensions
  const allNodes = workflow.nodes;
  const miniScale = 0.1;
  const miniW = 180;
  const miniH = 120;

  return (
    <div className={`relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] ${className}`}>
      {/* Toolbar */}
      <div className="absolute left-3 top-3 z-30 flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 shadow-sm">
        <button
          onClick={undo}
          disabled={historyIndex <= 0}
          className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-30"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          onClick={redo}
          disabled={historyIndex >= history.length - 1}
          className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-30"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="h-4 w-4" />
        </button>
        <div className="mx-1 h-5 w-px bg-[var(--border)]" />
        <button
          onClick={() => handleZoom(-0.1)}
          className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="px-1 text-xs font-medium text-[var(--text-muted)] tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => handleZoom(0.1)}
          className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <div className="mx-1 h-5 w-px bg-[var(--border)]" />
        <button
          onClick={fitToView}
          className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          title="Fit to view"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <button
          onClick={() => setShowMinimap((v) => !v)}
          className={`rounded p-1.5 hover:bg-[var(--surface-hover)] ${showMinimap ? 'text-primary-600' : 'text-[var(--text-muted)]'}`}
          title="Toggle minimap"
        >
          <MapIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Cursor indicator */}
      {spacePressed && !readOnly && (
        <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-muted)] shadow-sm">
          <MousePointer2 className="h-3.5 w-3.5" /> Pan mode (Space)
        </div>
      )}

      {/* Canvas */}
      <div
        ref={containerRef}
        className={`relative h-full w-full ${spacePressed || readOnly ? 'cursor-grab' : 'cursor-default'} ${isPanning ? 'cursor-grabbing' : ''}`}
        onMouseDown={handlePanStart}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{ minHeight: 500 }}
      >
        <svg
          ref={svgRef}
          className="absolute inset-0 h-full w-full"
          style={{
            background: 'radial-gradient(circle, var(--border) 1px, transparent 1px)',
            backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
            </marker>
            <marker
              id="arrowhead-active"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
            </marker>
          </defs>

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Edges */}
            {workflow.edges.map((edge) => {
              const source = workflow.nodes.find((n) => n.id === edge.source);
              const target = workflow.nodes.find((n) => n.id === edge.target);
              if (!source || !target) return null;
              const path = edgePath(source, target);
              const lp = edgeLabelPos(source, target);
              const isActive = nodeStatus && (nodeStatus(source.id) === 'completed' || nodeStatus(source.id) === 'current');
              return (
                <g key={edge.id} className="group">
                  <path
                    d={path}
                    fill="none"
                    stroke={isActive ? '#3b82f6' : '#64748b'}
                    strokeWidth={2}
                    strokeDasharray={isActive ? 'none' : '4 2'}
                    markerEnd={`url(#${isActive ? 'arrowhead-active' : 'arrowhead'})`}
                    className="cursor-pointer transition-all"
                    onClick={() => !readOnly && handleDeleteEdge(edge.id)}
                  />
                  {edge.label && (
                    <g>
                      <rect
                        x={lp.x - edge.label.length * 4 - 6}
                        y={lp.y - 10}
                        width={edge.label.length * 8 + 12}
                        height={20}
                        rx={10}
                        fill="var(--surface)"
                        stroke="var(--border)"
                      />
                      <text
                        x={lp.x}
                        y={lp.y + 4}
                        textAnchor="middle"
                        className="fill-[var(--text-muted)] text-[10px]"
                      >
                        {edge.label}
                      </text>
                    </g>
                  )}
                  {!readOnly && (
                    <circle
                      cx={lp.x}
                      cy={lp.y}
                      r={8}
                      fill="var(--surface)"
                      stroke="var(--border)"
                      className="cursor-pointer opacity-0 group-hover:opacity-100"
                      onClick={() => handleDeleteEdge(edge.id)}
                    />
                  )}
                </g>
              );
            })}

            {/* Temp connecting line */}
            {connecting && (() => {
              const source = workflow.nodes.find((n) => n.id === connecting);
              if (!source) return null;
              const sx = source.x + NODE_W / 2;
              const sy = source.y + NODE_H;
              return (
                <line
                  x1={sx}
                  y1={sy}
                  x2={mousePos.x}
                  y2={mousePos.y}
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                  markerEnd="url(#arrowhead-active)"
                />
              );
            })()}

            {/* Nodes */}
            {workflow.nodes.map((node) => {
              const status = nodeStatus ? nodeStatus(node.id) : 'none';
              const isSelected = selectedNodeId === node.id;
              const strokeColor = status !== 'none' ? statusColors[status] : isSelected ? '#3b82f6' : 'var(--border)';
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  className={readOnly ? 'cursor-pointer' : 'cursor-move'}
                  onMouseDown={(e) => handleNodeMouseDown(e, node)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNodeClick?.(node);
                  }}
                >
                  {/* Selection / status glow */}
                  {(isSelected || status === 'current') && (
                    <rect
                      x={-4}
                      y={-4}
                      width={NODE_W + 8}
                      height={NODE_H + 8}
                      rx={14}
                      fill="none"
                      stroke={status === 'current' ? '#3b82f6' : '#3b82f6'}
                      strokeWidth={2}
                      opacity={0.3}
                    />
                  )}
                  {/* Node body */}
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={10}
                    fill="var(--surface)"
                    stroke={strokeColor}
                    strokeWidth={isSelected || status !== 'none' ? 2.5 : 1.5}
                    className="transition-all"
                  />
                  {/* Status indicator bar */}
                  {status !== 'none' && (
                    <rect
                      width={4}
                      height={NODE_H}
                      rx={2}
                      fill={statusColors[status]}
                    />
                  )}
                  {/* Node content */}
                  {renderNodeContent ? (
                    <foreignObject x={12} y={8} width={NODE_W - 24} height={NODE_H - 16}>
                      <div className="h-full w-full">{renderNodeContent(node)}</div>
                    </foreignObject>
                  ) : (
                    <>
                      <text
                        x={NODE_W / 2}
                        y={NODE_H / 2 - 4}
                        textAnchor="middle"
                        className="fill-[var(--text)] text-xs font-semibold"
                      >
                        {node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label}
                      </text>
                      <text
                        x={NODE_W / 2}
                        y={NODE_H / 2 + 14}
                        textAnchor="middle"
                        className="fill-[var(--text-muted)] text-[10px] capitalize"
                      >
                        {node.type.replace(/_/g, ' ')}
                      </text>
                    </>
                  )}
                  {/* Output port (bottom) */}
                  {!readOnly && (
                    <>
                      <circle
                        cx={NODE_W / 2}
                        cy={NODE_H}
                        r={12}
                        fill="transparent"
                        className="cursor-crosshair"
                        onMouseDown={(e) => handleNodeOutputMouseDown(e, node.id)}
                      />
                      <circle
                        cx={NODE_W / 2}
                        cy={NODE_H}
                        r={8}
                        fill="var(--surface)"
                        stroke="#3b82f6"
                        strokeWidth={2.5}
                        className="cursor-crosshair transition-all hover:r-10 hover:fill-blue-50"
                        onMouseDown={(e) => handleNodeOutputMouseDown(e, node.id)}
                      />
                    </>
                  )}
                  {/* Input port (top) */}
                  {!readOnly && (
                    <>
                      <circle
                        cx={NODE_W / 2}
                        cy={0}
                        r={12}
                        fill="transparent"
                        className="cursor-crosshair"
                        onMouseUp={(e) => handleNodeInputMouseUp(e, node.id)}
                      />
                      <circle
                        cx={NODE_W / 2}
                        cy={0}
                        r={8}
                        fill="var(--surface)"
                        stroke="#10b981"
                        strokeWidth={2.5}
                        className="cursor-crosshair transition-all hover:r-10 hover:fill-green-50"
                        onMouseUp={(e) => handleNodeInputMouseUp(e, node.id)}
                      />
                    </>
                  )}
                  {/* Delete button */}
                  {!readOnly && (
                    <g
                      className="cursor-pointer opacity-0 hover:opacity-100"
                      onMouseEnter={(e) => {
                        (e.currentTarget as SVGGElement).style.opacity = '1';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as SVGGElement).style.opacity = '0';
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteNode(node.id);
                      }}
                    >
                      <circle
                        cx={NODE_W - 12}
                        cy={12}
                        r={9}
                        fill="var(--surface)"
                        stroke="#ef4444"
                        strokeWidth={1.5}
                      />
                      <text
                        x={NODE_W - 12}
                        y={16}
                        textAnchor="middle"
                        className="fill-red-500 text-xs font-bold"
                      >
                        ×
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Empty state */}
        {workflow.nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-[var(--text-subtle)]">
              {readOnly ? 'No workflow to display' : 'Drag node types from the palette to start building'}
            </p>
          </div>
        )}
      </div>

      {/* Minimap */}
      {showMinimap && workflow.nodes.length > 0 && (
        <div className="absolute bottom-3 right-3 z-30 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg" style={{ width: miniW, height: miniH }}>
          <svg width={miniW} height={miniH} className="bg-[var(--surface-hover)]">
            {allNodes.map((n) => (
              <rect
                key={n.id}
                x={n.x * miniScale + 5}
                y={n.y * miniScale + 5}
                width={NODE_W * miniScale}
                height={NODE_H * miniScale}
                rx={2}
                fill={nodeStatus ? statusColors[nodeStatus(n.id)] ?? '#94a3b8' : '#94a3b8'}
                opacity={0.7}
              />
            ))}
            {/* Viewport indicator */}
            <rect
              x={(-pan.x / zoom) * miniScale + 5}
              y={(-pan.y / zoom) * miniScale + 5}
              width={(containerRef.current?.clientWidth ?? 0) * miniScale / zoom}
              height={(containerRef.current?.clientHeight ?? 0) * miniScale / zoom}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={1}
            />
          </svg>
        </div>
      )}
    </div>
  );
}
