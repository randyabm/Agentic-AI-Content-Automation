import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/clients" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-indigo-950 via-primary to-teal-700">
      <form
        onSubmit={submit}
        className="bg-surface rounded-2xl p-10 w-[380px] flex flex-col gap-2 shadow-2xl"
      >
        <h1 className="text-[1.55rem] flex items-center gap-1.5 font-bold font-sans">
          <span className="bg-gradient-to-br from-primary to-indigo-400 text-white rounded-lg px-2 py-0.5 text-sm shadow-md">
            AI
          </span>
          Marketing Platform
        </h1>
        <p className="text-muted-foreground text-sm">Sign in to continue</p>
        <div className="flex flex-col gap-1.5 mt-2">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && (
          <div className="p-3 rounded-lg mb-4 bg-red-50 text-red-700 border-l-4 border-red-600 text-sm">
            {error}
          </div>
        )}
        <Button type="submit" disabled={busy} className="mt-2">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
