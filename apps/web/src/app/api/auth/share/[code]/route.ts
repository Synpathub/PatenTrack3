import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { db, schema } from "@/lib/db";
import { eq, and, gt, or, isNull, sql } from "drizzle-orm";
import { shareRateLimit, getClientIp } from "@/lib/rate-limit";

const SHARE_JWT_SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET!,
);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;

  const ip = getClientIp(request);
  const { success } = await shareRateLimit.limit(ip);
  if (!success) {
    return NextResponse.json(
      { error: { code: "RATE_LIMIT", message: "Too many requests" } },
      { status: 429 },
    );
  }

  const [shareLink] = await db
    .select()
    .from(schema.shareLinks)
    .where(
      and(
        eq(schema.shareLinks.code, code),
        eq(schema.shareLinks.isActive, true),
        or(
          isNull(schema.shareLinks.expiresAt),
          gt(schema.shareLinks.expiresAt, new Date()),
        ),
      ),
    )
    .limit(1);

  if (!shareLink) {
    return NextResponse.json(
      { error: { code: "INVALID_LINK", message: "Share link not found or expired" } },
      { status: 404 },
    );
  }

  if (shareLink.maxUses !== null && shareLink.useCount >= shareLink.maxUses) {
    return NextResponse.json(
      { error: { code: "MAX_USES", message: "Share link has reached maximum uses" } },
      { status: 403 },
    );
  }

  await db.insert(schema.shareAccessLog).values({
    shareLinkId: shareLink.id,
    ipAddress: ip,
    userAgent: request.headers.get("user-agent") ?? "",
  });

  await db
    .update(schema.shareLinks)
    .set({ useCount: sql`${schema.shareLinks.useCount} + 1` })
    .where(eq(schema.shareLinks.id, shareLink.id));

  const shareToken = await new SignJWT({
    type: "share",
    shareId: shareLink.id,
    orgId: shareLink.orgId,
    scope: "read_only",
    permissions: shareLink.permissions,
    assetIds: shareLink.assetIds,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(
      shareLink.expiresAt
        ? Math.floor(shareLink.expiresAt.getTime() / 1000)
        : "24h",
    )
    .sign(SHARE_JWT_SECRET);

  return NextResponse.json({
    data: {
      token: shareToken,
      organizationId: shareLink.orgId,
      permissions: shareLink.permissions,
    },
  });
}
