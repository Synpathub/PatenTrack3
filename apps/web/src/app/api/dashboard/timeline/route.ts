import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, desc } from "drizzle-orm";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const orgId = session.user.orgId;

  try {
    const entries = await db
      .select({
        id: schema.timelineEntries.id,
        entryDate: schema.timelineEntries.entryDate,
        assignmentCount: schema.timelineEntries.assignmentCount,
        types: schema.timelineEntries.types,
        createdAt: schema.timelineEntries.createdAt,
        updatedAt: schema.timelineEntries.updatedAt,
      })
      .from(schema.timelineEntries)
      .where(eq(schema.timelineEntries.orgId, orgId))
      .orderBy(desc(schema.timelineEntries.entryDate));

    return NextResponse.json({ data: entries });
  } catch (error) {
    console.error("Timeline fetch error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to fetch timeline entries" } },
      { status: 500 }
    );
  }
}
