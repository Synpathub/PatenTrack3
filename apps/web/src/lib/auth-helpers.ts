import { randomBytes, createHash, randomUUID } from "crypto";
import { db, schema } from "./db";
import { eq, and, isNull } from "drizzle-orm";

const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  const argon2 = await import("@node-rs/argon2");
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  try {
    const argon2 = await import("@node-rs/argon2");
    return await argon2.verify(storedHash, password);
  } catch {
    return false;
  }
}

export async function createRefreshToken(
  userId: string,
  familyId?: string,
): Promise<{ rawToken: string; familyId: string }> {
  const rawToken = randomBytes(48).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const family = familyId ?? randomUUID();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await db.insert(schema.refreshTokens).values({
    userId,
    tokenHash,
    familyId: family,
    expiresAt,
  });

  return { rawToken, familyId: family };
}

export async function rotateRefreshToken(rawToken: string) {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const [existing] = await db
    .select()
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, tokenHash))
    .limit(1);

  if (!existing) return null;

  if (existing.revokedAt) {
    await db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.refreshTokens.familyId, existing.familyId),
          isNull(schema.refreshTokens.revokedAt),
        ),
      );
    return null;
  }

  if (new Date() > existing.expiresAt) {
    await db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.refreshTokens.id, existing.id));
    return null;
  }

  await db
    .update(schema.refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(schema.refreshTokens.id, existing.id));

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, existing.userId))
    .limit(1);

  if (!user) return null;

  const { rawToken: newRawToken } = await createRefreshToken(
    user.id,
    existing.familyId,
  );

  return { user, newToken: newRawToken };
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await db
    .update(schema.refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.refreshTokens.userId, userId),
        isNull(schema.refreshTokens.revokedAt),
      ),
    );
}

export async function findUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .limit(1);
  return user ?? null;
}

export async function findUserById(id: string) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return user ?? null;
}

export async function findOrCreateOAuthUser(profile: {
  provider: "google" | "microsoft";
  providerAccountId: string;
  email: string;
  name: string;
}) {
  const [existing] = await db
    .select()
    .from(schema.oauthAccounts)
    .where(
      and(
        eq(schema.oauthAccounts.provider, profile.provider),
        eq(schema.oauthAccounts.providerAccountId, profile.providerAccountId),
      ),
    )
    .limit(1);

  if (existing) {
    const user = await findUserById(existing.userId);
    return user;
  }

  const existingUser = await findUserByEmail(profile.email);
  if (existingUser) {
    await db.insert(schema.oauthAccounts).values({
      userId: existingUser.id,
      provider: profile.provider,
      providerAccountId: profile.providerAccountId,
    });
    return existingUser;
  }

  return null;
}
