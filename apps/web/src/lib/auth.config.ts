import type { NextAuthConfig } from "next-auth";

// This file is imported by middleware (Edge runtime)
// It must NOT import anything that uses Node.js native modules (like argon2)

export const authConfig: NextAuthConfig = {
  session: {
    strategy: "jwt",
    maxAge: 15 * 60,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = (user as any).role;
        token.orgId = (user as any).orgId;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub!;
      (session.user as any).role = token.role;
      (session.user as any).orgId = token.orgId;
      return session;
    },
  },
  providers: [],
  trustHost: true,
};
