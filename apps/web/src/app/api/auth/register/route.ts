import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { hashPassword, findUserByEmail } from "@/lib/auth-helpers";
import { isNotNull } from "drizzle-orm";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, name, organizationId, role } = body;

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: { code: "MISSING_FIELDS", message: "Email, password, and name are required" } },
        { status: 400 },
      );
    }

    if (password.length < 12) {
      return NextResponse.json(
        { error: { code: "WEAK_PASSWORD", message: "Password must be at least 12 characters" } },
        { status: 400 },
      );
    }

    // Bootstrap: check for users with credentials (not just any users from seed data)
    const usersWithCredentials = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(isNotNull(schema.users.passwordHash))
      .limit(1);
    const isBootstrap = usersWithCredentials.length === 0;

    if (!isBootstrap) {
      const session = await auth();
      if (!session?.user) {
        return NextResponse.json(
          { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
          { status: 401 },
        );
      }
      if (session.user.role !== "admin" && session.user.role !== "super_admin") {
        return NextResponse.json(
          { error: { code: "FORBIDDEN", message: "Only admins can create users" } },
          { status: 403 },
        );
      }
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: { code: "DUPLICATE_EMAIL", message: "Email already registered" } },
        { status: 409 },
      );
    }

    const passwordHash = await hashPassword(password);

    let userOrgId = organizationId;
    let userRole = role ?? "member";

    if (isBootstrap) {
      userRole = "super_admin";
      if (!userOrgId) {
        // Use existing org if one exists, otherwise create one
        const [existingOrg] = await db
          .select({ id: schema.organizations.id })
          .from(schema.organizations)
          .limit(1);
        if (existingOrg) {
          userOrgId = existingOrg.id;
        } else {
          const [org] = await db
            .insert(schema.organizations)
            .values({
              name: "PatenTrack",
              slug: "patentrack",
            })
            .returning();
          userOrgId = org.id;
        }
      }
    } else {
      const session = await auth();
      if (!userOrgId) {
        userOrgId = session!.user.orgId;
      }
    }

    const [user] = await db
      .insert(schema.users)
      .values({
        email: email.toLowerCase(),
        passwordHash,
        hashAlgorithm: "argon2id",
        name,
        organizationId: userOrgId,
        role: userRole,
      })
      .returning({ id: schema.users.id, email: schema.users.email });

    return NextResponse.json(
      { data: { id: user.id, email: user.email } },
      { status: 201 },
    );
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500 },
    );
  }
}
