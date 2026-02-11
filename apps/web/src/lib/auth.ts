import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { authConfig } from "./auth.config";
import {
  verifyPassword,
  findUserByEmail,
  findOrCreateOAuthUser,
} from "./auth-helpers";
import { loginRateLimit, getClientIp } from "./rate-limit";

declare module "next-auth" {
  interface User {
    role: "member" | "admin" | "super_admin";
    orgId: string;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: "member" | "admin" | "super_admin";
      orgId: string;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role: "member" | "admin" | "super_admin";
    orgId: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = credentials?.email as string;
        const password = credentials?.password as string;
        if (!email || !password) return null;
        const ip = getClientIp(request);
        const { success } = await loginRateLimit.limit(ip);
        if (!success) {
          throw new Error("Too many login attempts. Please wait a moment.");
        }
        const user = await findUserByEmail(email);
        if (!user || !user.passwordHash) return null;
        const valid = await verifyPassword(user.passwordHash, password);
        if (!valid) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as "member" | "admin" | "super_admin",
          orgId: user.organizationId,
        };
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    MicrosoftEntraID({
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider === "credentials") return true;
      if (account && profile?.email) {
        const provider = account.provider as "google" | "microsoft";
        const dbUser = await findOrCreateOAuthUser({
          provider,
          providerAccountId: account.providerAccountId,
          email: profile.email,
          name: (profile.name as string) ?? "",
        });
        if (!dbUser) return "/login?error=NoAccount";
        user.id = dbUser.id;
        user.role = dbUser.role as "member" | "admin" | "super_admin";
        user.orgId = dbUser.organizationId;
      }
      return true;
    },
  },
});
