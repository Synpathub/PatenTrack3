import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const orgId = session.user.orgId;
  const { searchParams } = new URL(request.url);
  const tab = searchParams.get("tab"); // complete, broken, encumbered, other

  let query = db
    .select({
      id: schema.dashboardItems.id,
      assetId: schema.dashboardItems.assetId,
      type: schema.dashboardItems.type,
      tab: schema.dashboardItems.tab,
      color: schema.dashboardItems.color,
      treeJson: schema.dashboardItems.treeJson,
      isBroken: schema.dashboardItems.isBroken,
      brokenReason: schema.dashboardItems.brokenReason,
      computedAt: schema.dashboardItems.computedAt,
    })
    .from(schema.dashboardItems)
    .where(
      tab
        ? and(
            eq(schema.dashboardItems.orgId, orgId),
            eq(schema.dashboardItems.tab, tab as any),
          )
        : eq(schema.dashboardItems.orgId, orgId),
    );

  const items = await query;

  return NextResponse.json({ data: items });
}
