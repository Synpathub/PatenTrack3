"use client";

import { signOut } from "next-auth/react";
import { useCallback, useState } from "react";

export function LogoutButton() {
  const [loading, setLoading] = useState(false);

  const handleLogout = useCallback(async () => {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Continue with signOut even if token revocation fails
    }
    await signOut({ callbackUrl: "/login" });
  }, []);

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50"
    >
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}
