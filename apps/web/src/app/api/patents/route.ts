import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  const orgId = session.user.orgId;

  // Get patents for this org via org_assets join
  const patents = await db
    .select({
      id: schema.patents.id,
      grantNumber: schema.patents.grantNumber,
      applicationNumber: schema.patents.applicationNumber,
      documentType: schema.patents.documentType,
      title: schema.patents.title,
      filingDate: schema.patents.filingDate,
      grantDate: schema.patents.grantDate,
      expirationDate: schema.patents.expirationDate,
      claimsCount: schema.patents.claimsCount,
      maintenanceFeeStatus: schema.patents.maintenanceFeeStatus,
      assetId: schema.orgAssets.id,
    })
    .from(schema.orgAssets)
    .innerJoin(schema.patents, eq(schema.orgAssets.patentId, schema.patents.id))
    .where(eq(schema.orgAssets.orgId, orgId));

  return NextResponse.json({ data: patents });
}
