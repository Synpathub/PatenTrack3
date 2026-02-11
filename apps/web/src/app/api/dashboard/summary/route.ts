import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const orgId = session.user.orgId;

  const [metrics] = await db
    .select()
    .from(schema.summaryMetrics)
    .where(eq(schema.summaryMetrics.orgId, orgId))
    .orderBy(desc(schema.summaryMetrics.computedAt))
    .limit(1);

  if (!metrics) {
    return NextResponse.json({
      data: {
        totalAssets: 0,
        totalEntities: 0,
        totalTransactions: 0,
        completeChains: 0,
        brokenChains: 0,
        encumbrances: 0,
      },
    });
  }

  return NextResponse.json({
    data: {
      totalAssets: metrics.totalAssets,
      totalEntities: metrics.totalEntities,
      totalCompanies: metrics.totalCompanies,
      totalTransactions: metrics.totalTransactions,
      totalEmployees: metrics.totalEmployees,
      totalParties: metrics.totalParties,
      completeChains: metrics.completeChains,
      brokenChains: metrics.brokenChains,
      encumbrances: metrics.encumbrances,
      computedAt: metrics.computedAt,
    },
  });
}
