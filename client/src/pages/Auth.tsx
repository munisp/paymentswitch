import { FormEvent, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  Building2,
  KeyRound,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";

export default function Auth() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usernameOrEmail, setUsernameOrEmail] = useState("");

  const login = trpc.auth.localLogin.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      toast.success("Signed in successfully");
      navigate("/dashboard");
    },
    onError: error => toast.error(error.message),
  });

  const signup = trpc.auth.localSignup.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      toast.success("Account created successfully");
      navigate("/onboarding/portal");
    },
    onError: error => toast.error(error.message),
  });

  const isPending = login.isPending || signup.isPending;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "login") {
      login.mutate({ usernameOrEmail, password });
    } else {
      signup.mutate({ name, username, email, password });
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-4 py-10">
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1fr_460px] lg:items-center">
        <section className="hidden lg:block">
          <div className="mb-6 flex items-center gap-3 text-cyan-300">
            <Building2 className="h-8 w-8" />
            <span className="text-lg font-semibold tracking-wide">
              Payment Switch
            </span>
          </div>
          <h1 className="max-w-xl text-5xl font-semibold leading-tight">
            Secure access for every participant.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
            Use a local account for development and self-hosted environments, or
            continue through the enterprise Keycloak identity provider.
          </p>
          <div className="mt-8 grid max-w-xl gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <ShieldCheck className="mb-3 h-6 w-6 text-cyan-300" />
              <h2 className="font-medium">Fail-closed access</h2>
              <p className="mt-2 text-sm text-slate-400">
                Invalid credentials and unavailable identity providers never
                create a session.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <KeyRound className="mb-3 h-6 w-6 text-cyan-300" />
              <h2 className="font-medium">Keycloak-ready</h2>
              <p className="mt-2 text-sm text-slate-400">
                Enterprise SSO remains the production identity path with signed
                OIDC tokens.
              </p>
            </div>
          </div>
        </section>

        <Card className="border-slate-800 bg-white text-slate-950 shadow-2xl">
          <CardHeader>
            <CardTitle>
              {mode === "login" ? "Sign in" : "Create your account"}
            </CardTitle>
            <CardDescription>
              {mode === "login"
                ? "Use your local credentials or enterprise SSO."
                : "Create a local account for this environment."}
            </CardDescription>
            <div className="grid grid-cols-2 gap-2 pt-3">
              <Button
                type="button"
                variant={mode === "login" ? "default" : "outline"}
                onClick={() => setMode("login")}
              >
                Sign in
              </Button>
              <Button
                type="button"
                variant={mode === "signup" ? "default" : "outline"}
                onClick={() => setMode("signup")}
              >
                Sign up
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              {mode === "signup" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="name">Full name</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      autoComplete="name"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      autoComplete="username"
                      pattern="[A-Za-z0-9._-]+"
                      minLength={3}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>
                </>
              )}
              {mode === "login" && (
                <div className="space-y-2">
                  <Label htmlFor="usernameOrEmail">Username or email</Label>
                  <Input
                    id="usernameOrEmail"
                    value={usernameOrEmail}
                    onChange={e => setUsernameOrEmail(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  minLength={12}
                  required
                />
                <p className="text-xs text-slate-500">
                  At least 12 characters.
                </p>
              </div>
              <Button className="w-full" type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === "login" ? "Sign in" : "Create account"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </form>
            <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
              <div className="h-px flex-1 bg-slate-200" />
              OR
              <div className="h-px flex-1 bg-slate-200" />
            </div>
            <Button
              className="w-full"
              variant="outline"
              type="button"
              onClick={() => {
                window.location.href = getLoginUrl();
              }}
            >
              <KeyRound className="mr-2 h-4 w-4" />
              Continue with Keycloak SSO
            </Button>
            <p className="mt-5 text-center text-xs leading-5 text-slate-500">
              Local credential authentication is intended for development and
              explicitly enabled self-hosted deployments. Production can require
              Keycloak by leaving local auth disabled.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
