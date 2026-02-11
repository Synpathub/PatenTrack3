"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { OwnershipTree } from "@/components/ownership-tree";

/* ── Types ── */
interface Patent {
  id: string;
  patentNumber: string;
  title: string | null;
  filingDate: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  status: string | null;
  abstract: string | null;
}

interface Assignment {
  id: string;
  rfId: string | null;
  conveyanceType: string;
  recordDate: string | null;
  assignors: unknown;
  assignees: unknown;
  correspondentName: string | null;
}

interface PatentDetail {
  patent: Patent;
  assignments: Assignment[];
  treeJson: unknown[] | null;
}

/* ── Helpers ── */
function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? "unknown").toLowerCase();
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    expired: "bg-red-100 text-red-800",
    pending: "bg-yellow-100 text-yellow-800",
    abandoned: "bg-gray-100 text-gray-600",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
        map[s] ?? "bg-gray-100 text-gray-600"
      }`}
    >
      {status ?? "Unknown"}
    </span>
  );
}

function extractNames(data: unknown): string[] {
  if (Array.isArray(data)) {
    return data.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "name" in item)
        return String((item as { name: string }).name);
      return String(item);
    });
  }
  if (typeof data === "string") return [data];
  return [];
}

const TYPE_COLORS: Record<string, string> = {
  assignment: "#ef4444",
  "name-change": "#3b82f6",
  "security-interest": "#f97316",
  release: "#22c55e",
  license: "#eab308",
  merger: "#8b5cf6",
};

function conveyanceColor(type: string | null): string {
  if (!type) return "#6b7280";
  const key = type.toLowerCase().replace(/[\s_]+/g, "-");
  return TYPE_COLORS[key] ?? "#6b7280";
}

/* ── Page ── */
export default function PatentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [data, setData] = useState<PatentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPatent() {
      try {
        const res = await fetch(`/api/patents/${id}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            (err as { error?: string }).error ?? `HTTP ${res.status}`
          );
        }
        setData(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchPatent();
  }, [id]);

  /* Loading */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
      </div>
    );
  }

  /* Error */
  if (error || !data) {
    return (
      <div className="py-12 text-center">
        <p className="text-red-600 font-medium">{error ?? "Patent not found"}</p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 text-sm text-blue-600 hover:underline"
        >
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  const { patent, assignments, treeJson } = data;

  return (
    <div className="space-y-6">
      {/* Back nav */}
      <button
        onClick={() => router.push("/")}
        className="text-sm text-blue-600 hover:underline"
      >
        ← Back to Dashboard
      </button>

      {/* ── Patent Header ── */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-gray-900 truncate">
              {patent.patentNumber}
            </h2>
            <p className="mt-1 text-gray-600">
              {patent.title ?? "Untitled Patent"}
            </p>
          </div>
          <StatusBadge status={patent.status} />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs font-medium uppercase text-gray-500">
              Filing Date
            </dt>
            <dd className="mt-1 text-sm text-gray-900">
              {formatDate(patent.filingDate)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-gray-500">
              Issue Date
            </dt>
            <dd className="mt-1 text-sm text-gray-900">
              {formatDate(patent.issueDate)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-gray-500">
              Expiration
            </dt>
            <dd className="mt-1 text-sm text-gray-900">
              {formatDate(patent.expirationDate)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-gray-500">
              Status
            </dt>
            <dd className="mt-1 text-sm text-gray-900">
              {patent.status ?? "Unknown"}
            </dd>
          </div>
        </dl>

        {patent.abstract && (
          <div className="mt-5">
            <dt className="text-xs font-medium uppercase text-gray-500">
              Abstract
            </dt>
            <dd className="mt-1 text-sm leading-relaxed text-gray-700">
              {patent.abstract}
            </dd>
          </div>
        )}
      </div>

      {/* ── Ownership Tree (hero feature) ── */}
      {treeJson && Array.isArray(treeJson) && treeJson.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">
            Ownership Chain
          </h3>
          <OwnershipTree
            treeJson={treeJson as any}
            patentNumber={patent.patentNumber}
          />
        </div>
      )}

      {/* ── Assignment History ── */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          Assignment History
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({assignments.length} record
            {assignments.length !== 1 ? "s" : ""})
          </span>
        </h3>

        {assignments.length === 0 ? (
          <p className="text-sm text-gray-500">
            No assignment records found for this patent.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase text-gray-500">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4">Assignor(s)</th>
                  <th className="pb-2 pr-4">Assignee(s)</th>
                  <th className="pb-2">Reel/Frame</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {assignments.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap py-2.5 pr-4 text-gray-900">
                      {formatDate(a.recordDate)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className="inline-block rounded px-2 py-0.5 text-xs font-medium text-white"
                        style={{
                          backgroundColor: conveyanceColor(a.conveyanceType),
                        }}
                      >
                        {a.conveyanceType ?? "Unknown"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-gray-700">
                      {extractNames(a.assignors).join(", ") || "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-700">
                      {extractNames(a.assignees).join(", ") || "—"}
                    </td>
                    <td className="whitespace-nowrap py-2.5 text-gray-500">
                      {a.rfId ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
