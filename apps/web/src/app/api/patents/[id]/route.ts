import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";

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
    const orgAssetResult = await db
      .select()
      .from(schema.orgAssets)
      .where(
        and(
          eq(schema.orgAssets.orgId, orgId),
          eq(schema.orgAssets.patentId, id)
        )
      )
      .limit(1);

    if (orgAssetResult.length === 0) {
      return NextResponse.json({ error: "Patent not found" }, { status: 404 });
    }

    const orgAsset = orgAssetResult[0];

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
    const documentNumber = patent.grantNumber || patent.applicationNumber;

    // Get assignments for this patent via assignmentDocuments join
    const assignmentResults = await db
      .select({
        assignmentId: schema.assignments.id,
        rfId: schema.assignments.rfId,
        conveyanceText: schema.assignments.conveyanceText,
        recordDate: schema.assignments.recordDate,
        executionDate: schema.assignments.executionDate,
      })
      .from(schema.assignmentDocuments)
      .innerJoin(
        schema.assignments,
        eq(schema.assignmentDocuments.assignmentId, schema.assignments.id)
      )
      .where(eq(schema.assignmentDocuments.documentNumber, documentNumber || ""))
      .orderBy(asc(schema.assignments.recordDate));

    // Get assignors and assignees for each assignment
    const assignments = await Promise.all(
      assignmentResults.map(async (a) => {
        const [assignors, assignees] = await Promise.all([
          db
            .select({ name: schema.assignmentAssignors.name })
            .from(schema.assignmentAssignors)
            .where(eq(schema.assignmentAssignors.assignmentId, a.assignmentId)),
          db
            .select({ name: schema.assignmentAssignees.name })
            .from(schema.assignmentAssignees)
            .where(eq(schema.assignmentAssignees.assignmentId, a.assignmentId)),
        ]);

        return {
          id: a.assignmentId,
          rfId: a.rfId,
          conveyanceText: a.conveyanceText,
          recordDate: a.recordDate,
          executionDate: a.executionDate,
          assignors: assignors.map((s) => s.name),
          assignees: assignees.map((s) => s.name),
        };
      })
    );

    // Get dashboard item for tree_json using assetId
    const dashboardItems = await db
      .select()
      .from(schema.dashboardItems)
      .where(eq(schema.dashboardItems.assetId, orgAsset.id))
      .limit(1);

    const treeJson = dashboardItems[0]?.treeJson ?? null;

    return NextResponse.json({
      patent: {
        id: patent.id,
        patentNumber: patent.grantNumber || patent.applicationNumber,
        title: patent.title,
        abstract: patent.abstract,
        filingDate: patent.filingDate,
        issueDate: patent.grantDate,
        expirationDate: patent.expirationDate,
        status: patent.maintenanceFeeStatus,
      },
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
