"use client";

import { useRef, useEffect, useMemo } from "react";
import * as d3 from "d3";

/* ── Types ── */
interface AssignmentNode {
  rfId: string;
  conveyanceType: string;
  isEmployerAssignment?: boolean;
  assignors: string[];
  assignees: string[];
  recordDate: string;
}

interface TreeNode {
  name: string;
  type: string;
  date?: string;
  from?: string;
  children?: TreeNode[];
}

/* ── Color map by conveyance type ── */
const COLORS: Record<string, string> = {
  assignment: "#ef4444",
  "name-change": "#3b82f6",
  "security-interest": "#f97316",
  release: "#22c55e",
  license: "#eab308",
  merger: "#8b5cf6",
  "court-order": "#ec4899",
  default: "#6b7280",
};

function getColor(type: string): string {
  const normalized = type.toLowerCase().replace(/[\s_]+/g, "-");
  return COLORS[normalized] ?? COLORS.default;
}

/* ── Convert flat assignment array to D3 hierarchy ── */
function buildHierarchy(
  assignments: AssignmentNode[],
  patentLabel: string
): TreeNode {
  if (!assignments || assignments.length === 0) {
    return { name: patentLabel, type: "patent" };
  }

  const sorted = [...assignments].sort(
    (a, b) =>
      new Date(a.recordDate).getTime() - new Date(b.recordDate).getTime()
  );

  const root: TreeNode = {
    name: patentLabel,
    type: "patent",
    children: [],
  };

  // Map entity names to their most recent tree node
  const entityNodes = new Map<string, TreeNode>();

  for (const assignment of sorted) {
    const assignorKey = assignment.assignors.sort().join(" & ");

    // Find parent node — either an existing entity or attach to root
    let parent: TreeNode;
    if (entityNodes.has(assignorKey)) {
      parent = entityNodes.get(assignorKey)!;
    } else {
      parent = {
        name: assignorKey,
        type: "entity",
        children: [],
      };
      entityNodes.set(assignorKey, parent);
      root.children!.push(parent);
    }

    // Create child node for assignee(s)
    const assigneeKey = assignment.assignees.sort().join(" & ");
    const child: TreeNode = {
      name: assigneeKey,
      type: assignment.conveyanceType,
      date: assignment.recordDate,
      from: assignorKey,
      children: [],
    };

    if (!parent.children) parent.children = [];
    parent.children.push(child);

    // Register assignee so later assignments can chain from it
    entityNodes.set(assigneeKey, child);
  }

  // If root has exactly one child, promote it to root for cleaner display
  if (root.children && root.children.length === 1) {
    return root.children[0];
  }

  return root;
}

/* ── Legend ── */
function Legend() {
  const items = Object.entries(COLORS).filter(([k]) => k !== "default");
  return (
    <div className="flex flex-wrap gap-3 text-xs text-gray-600 mb-3">
      {items.map(([type, color]) => (
        <span key={type} className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: color }}
          />
          {type.replace(/-/g, " ")}
        </span>
      ))}
    </div>
  );
}

/* ── Main component ── */
interface OwnershipTreeProps {
  treeJson: AssignmentNode[];
  patentNumber: string;
}

export function OwnershipTree({ treeJson, patentNumber }: OwnershipTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const hierarchy = useMemo(
    () => buildHierarchy(treeJson, patentNumber),
    [treeJson, patentNumber]
  );

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const root = d3.hierarchy(hierarchy);
    const nodeCount = root.descendants().length;
    const depthCount = root.height + 1;

    // Dynamic sizing based on tree dimensions
    const nodeSpacingX = 220;
    const nodeSpacingY = 80;
    const marginTop = 30;
    const marginBottom = 30;
    const marginLeft = 60;
    const marginRight = 120;

    const innerWidth = depthCount * nodeSpacingX;
    const innerHeight = Math.max(nodeCount * nodeSpacingY, 180);
    const width = innerWidth + marginLeft + marginRight;
    const height = innerHeight + marginTop + marginBottom;

    svg
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`);

    const g = svg
      .append("g")
      .attr("transform", `translate(${marginLeft},${marginTop})`);

    // Horizontal tree layout (swap x ↔ y)
    const treeLayout = d3
      .tree<TreeNode>()
      .size([innerHeight, innerWidth])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.3));

    treeLayout(root);

    // Draw curved links
    const linkGen = d3
      .linkHorizontal<d3.HierarchyPointLink<TreeNode>, d3.HierarchyPointNode<TreeNode>>()
      .source((d) => ({ ...d.source, x: d.source.x!, y: d.source.y! }) as any)
      .target((d) => ({ ...d.target, x: d.target.x!, y: d.target.y! }) as any)
      .x((d: any) => d.y)
      .y((d: any) => d.x);

    g.selectAll(".link")
      .data(root.links())
      .enter()
      .append("path")
      .attr("fill", "none")
      .attr("stroke", (d) => getColor(d.target.data.type))
      .attr("stroke-width", 2.5)
      .attr("stroke-opacity", 0.5)
      .attr("d", linkGen as any);

    // Draw nodes
    const nodes = g
      .selectAll<SVGGElement, d3.HierarchyPointNode<TreeNode>>(".node")
      .data(root.descendants())
      .enter()
      .append("g")
      .attr("transform", (d) => `translate(${d.y},${d.x})`);

    // Node circles
    nodes
      .append("circle")
      .attr("r", 9)
      .attr("fill", (d) => getColor(d.data.type))
      .attr("stroke", "#fff")
      .attr("stroke-width", 2.5)
      .style("filter", "drop-shadow(0 1px 2px rgba(0,0,0,0.15))");

    // Entity name labels (above node)
    nodes
      .append("text")
      .attr("dy", "-16")
      .attr("text-anchor", "middle")
      .attr("font-size", "11px")
      .attr("font-weight", "600")
      .attr("fill", "#1f2937")
      .text((d) => {
        const name = d.data.name;
        return name.length > 30 ? name.slice(0, 28) + "…" : name;
      });

    // Date labels (below node)
    nodes
      .filter((d) => !!d.data.date)
      .append("text")
      .attr("dy", "24")
      .attr("text-anchor", "middle")
      .attr("font-size", "9px")
      .attr("fill", "#6b7280")
      .text((d) => {
        if (!d.data.date) return "";
        return new Date(d.data.date).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      });

    // Conveyance type label (below date)
    nodes
      .filter(
        (d) => d.data.type !== "patent" && d.data.type !== "entity"
      )
      .append("text")
      .attr("dy", (d) => (d.data.date ? "36" : "24"))
      .attr("text-anchor", "middle")
      .attr("font-size", "8px")
      .attr("font-weight", "500")
      .attr("fill", (d) => getColor(d.data.type))
      .text((d) =>
        d.data.type.replace(/-/g, " ").toUpperCase()
      );
  }, [hierarchy]);

  return (
    <div>
      <Legend />
      <div
        ref={containerRef}
        className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-2"
      >
        <svg ref={svgRef} style={{ minHeight: "250px", display: "block" }} />
      </div>
    </div>
  );
}
