import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const orgId = (session.user as Record<string, unknown>).orgId as string | undefined;

  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  try {
    // Verify patent belongs to user's org via org_assets
    const orgAsset = await db
      .select()
      .from(schema.orgAssets)
      .where(
        and(
          eq(schema.orgAssets.orgId, orgId),
          eq(schema.orgAssets.patentId, id)
        )
      )
      .limit(1);

    if (orgAsset.length === 0) {
      return NextResponse.json({ error: "Patent not found" }, { status: 404 });
    }

    // Get patent
    const patents = await db
      .select()
      .from(schema.patents)
      .where(eq(schema.patents.id, id))
      .limit(1);

    if (patents.length === 0) {
      return NextResponse.json({ error: "Patent not found" }, { status: 404 });
    }

    const patent = patents[0];

    // Get assignments for this patent
    const assignments = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.patentId, id))
      .orderBy(schema.assignments.recordDate);

    // Get dashboard item for tree_json
    const dashboardItems = await db
      .select()
      .from(schema.dashboardItems)
      .where(eq(schema.dashboardItems.patentId, id))
      .limit(1);

    const treeJson = dashboardItems[0]?.treeJson ?? null;

    return NextResponse.json({
      patent,
      assignments,
      treeJson,
    });
  } catch (error) {
    console.error("Patent detail error:", error);
    return NextResponse.json(
      { error: "Failed to fetch patent" },
      { status: 500 }
    );
  }
}
