import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { revokeAllRefreshTokens } from "@/lib/auth-helpers";

export async function POST() {
  const session = await auth();

  if (session?.user?.id) {
    await revokeAllRefreshTokens(session.user.id);
  }

  return NextResponse.json({ data: { success: true } });
}
