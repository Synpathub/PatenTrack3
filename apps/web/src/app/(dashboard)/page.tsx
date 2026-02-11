"use client";

import { useEffect, useState } from "react";

interface SummaryMetrics {
  totalAssets: number;
  totalEntities: number;
  totalCompanies: number;
  totalTransactions: number;
  completeChains: number;
  brokenChains: number;
  encumbrances: number;
  computedAt: string;
}

interface Patent {
  id: string;
  grantNumber: string | null;
  applicationNumber: string;
  documentType: string;
  title: string;
  filingDate: string;
  grantDate: string | null;
  expirationDate: string | null;
  claimsCount: number;
  maintenanceFeeStatus: string;
  assetId: string;
}

interface DashboardItem {
  id: string;
  assetId: string;
  type: number;
  tab: string;
  color: string;
  treeJson: string;
  isBroken: boolean;
  brokenReason: string | null;
  computedAt: string;
}

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
    gray: "bg-gray-50 text-gray-700 border-gray-200",
  };
  return (
    <div className={`rounded-lg border p-4 ${colors[color] || colors.gray}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="mt-1 text-sm opacity-75">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    complete: "bg-green-100 text-green-800",
    broken: "bg-red-100 text-red-800",
    encumbered: "bg-orange-100 text-orange-800",
    other: "bg-gray-100 text-gray-800",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || styles.other}`}>
      {status}
    </span>
  );
}

function FeeBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    paid: "bg-green-100 text-green-800",
    due: "bg-yellow-100 text-yellow-800",
    expired: "bg-red-100 text-red-800",
    unknown: "bg-gray-100 text-gray-800",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || styles.unknown}`}>
      {status}
    </span>
  );
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<SummaryMetrics | null>(null);
  const [patents, setPatents] = useState<Patent[]>([]);
  const [dashItems, setDashItems] = useState<DashboardItem[]>([]);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [summaryRes, patentsRes, dashRes] = await Promise.all([
          fetch("/api/dashboard/summary"),
          fetch("/api/patents"),
          fetch("/api/dashboard"),
        ]);
        const summaryData = await summaryRes.json();
        const patentsData = await patentsRes.json();
        const dashData = await dashRes.json();

        setMetrics(summaryData.data);
        setPatents(patentsData.data || []);
        setDashItems(dashData.data || []);
      } catch (e) {
        console.error("Failed to load dashboard:", e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-gray-500">Loading dashboard...</div>
      </div>
    );
  }

  const tabs = ["all", "complete", "broken", "encumbered", "other"];
  const filteredItems = activeTab === "all" ? dashItems : dashItems.filter((i) => i.tab === activeTab);

  // Map asset IDs to dashboard items for status lookup
  const assetStatusMap = new Map(dashItems.map((d) => [d.assetId, d]));

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      {metrics && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Total Patents" value={metrics.totalAssets} color="blue" />
          <KpiCard label="Entities" value={metrics.totalEntities} color="gray" />
          <KpiCard label="Transactions" value={metrics.totalTransactions} color="gray" />
          <KpiCard label="Complete Chains" value={metrics.completeChains} color="green" />
          <KpiCard label="Broken Chains" value={metrics.brokenChains} color="red" />
          <KpiCard label="Encumbrances" value={metrics.encumbrances} color="orange" />
        </div>
      )}

      {/* Tab Filter */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab !== "all" && (
              <span className="ml-1.5 text-xs opacity-60">
                {dashItems.filter((i) => tab === "all" || i.tab === tab).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Patent Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Patent</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Title</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Fees</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Filed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {patents
              .filter((p) => {
                if (activeTab === "all") return true;
                const dashItem = assetStatusMap.get(p.assetId);
                return dashItem?.tab === activeTab;
              })
              .map((patent) => {
                const dashItem = assetStatusMap.get(patent.assetId);
                return (
                  <tr key={patent.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                      {patent.grantNumber || patent.applicationNumber}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <div className="max-w-md truncate">{patent.title}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                      {patent.documentType}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={dashItem?.tab || "unknown"} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <FeeBadge status={patent.maintenanceFeeStatus} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {patent.filingDate ? new Date(patent.filingDate).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        {patents.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-400">
            No patents found in your portfolio.
          </div>
        )}
      </div>

      {/* Computed timestamp */}
      {metrics?.computedAt && (
        <div className="text-right text-xs text-gray-400">
          Last computed: {new Date(metrics.computedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}
