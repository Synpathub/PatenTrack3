"use client";

import { useEffect, useState } from "react";

interface TimelineEntry {
  id: string;
  entryDate: string; // ISO 8601 timestamp from database
  assignmentCount: number;
  types: string[] | null;
  createdAt: string;
  updatedAt: string;
}

// Color mapping based on conveyance types
const conveyanceColors: Record<string, { bg: string; text: string; label: string }> = {
  assignment: { bg: "bg-red-100", text: "text-red-800", label: "Assignment" },
  namechg: { bg: "bg-blue-100", text: "text-blue-800", label: "Name Change" },
  security: { bg: "bg-orange-100", text: "text-orange-800", label: "Security Interest" },
  release: { bg: "bg-green-100", text: "text-green-800", label: "Release" },
  license: { bg: "bg-yellow-100", text: "text-yellow-800", label: "License" },
  merger: { bg: "bg-purple-100", text: "text-purple-800", label: "Merger" },
  employee: { bg: "bg-gray-100", text: "text-gray-800", label: "Employee Assignment" },
  govern: { bg: "bg-indigo-100", text: "text-indigo-800", label: "Government Interest" },
  correct: { bg: "bg-cyan-100", text: "text-cyan-800", label: "Correction" },
  missing: { bg: "bg-slate-100", text: "text-slate-800", label: "Missing Link" },
};

function TypeBadge({ type }: { type: string }) {
  const colorInfo = conveyanceColors[type] || {
    bg: "bg-gray-100",
    text: "text-gray-800",
    label: type,
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorInfo.bg} ${colorInfo.text}`}
    >
      {colorInfo.label}
    </span>
  );
}

function TimelineEntryCard({ entry }: { entry: TimelineEntry }) {
  const date = new Date(entry.entryDate);
  const formattedDate = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="relative border-l-2 border-gray-200 pl-6 pb-8 last:pb-0">
      {/* Timeline dot */}
      <div className="absolute left-0 -translate-x-1/2 w-3 h-3 bg-blue-500 rounded-full border-2 border-white" />

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">{formattedDate}</div>
            <div className="mt-1 text-sm text-gray-600">
              {entry.assignmentCount} {entry.assignmentCount === 1 ? "transaction" : "transactions"}
            </div>
          </div>
        </div>

        {entry.types && entry.types.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {entry.types.map((type, idx) => (
              <TypeBadge key={`${type}-${idx}`} type={type} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TimelinePage() {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTimeline() {
      try {
        const res = await fetch("/api/dashboard/timeline");
        if (!res.ok) {
          throw new Error("Failed to fetch timeline");
        }
        const data = await res.json();
        setEntries(data.data || []);
      } catch (e) {
        console.error("Failed to load timeline:", e);
        setError("Failed to load timeline. Please try again later.");
      } finally {
        setLoading(false);
      }
    }
    fetchTimeline();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-gray-500">Loading timeline...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="text-sm text-red-800">{error}</div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <div className="text-sm text-gray-500">
          No timeline entries found. Timeline entries are generated as patent assignment data is processed.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Transaction Timeline</h1>
        <p className="mt-1 text-sm text-gray-600">
          Chronological view of all patent transactions in your portfolio
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="space-y-0">
          {entries.map((entry) => (
            <TimelineEntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      </div>

      <div className="text-right text-xs text-gray-400">
        Showing {entries.length} timeline {entries.length === 1 ? "entry" : "entries"}
      </div>
    </div>
  );
}
