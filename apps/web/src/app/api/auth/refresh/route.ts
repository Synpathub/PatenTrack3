import { NextResponse } from "next/server";
import { rotateRefreshToken } from "@/lib/auth-helpers";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { refreshToken } = body;

    if (!refreshToken) {
      return NextResponse.json(
        { error: { code: "MISSING_TOKEN", message: "Refresh token required" } },
        { status: 400 },
      );
    }

    const result = await rotateRefreshToken(refreshToken);

    if (!result) {
      return NextResponse.json(
        { error: { code: "INVALID_TOKEN", message: "Invalid or expired refresh token" } },
        { status: 401 },
      );
    }

    return NextResponse.json({
      data: {
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
          orgId: result.user.organizationId,
        },
        refreshToken: result.newToken,
      },
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500 },
    );
  }
}
