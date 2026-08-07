import { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { dark } from "@clerk/themes";
import { Shell } from "./components";
import Dashboard from "./pages/Dashboard";
import Prospects from "./pages/Prospects";
import ProspectDetail from "./pages/ProspectDetail";
import Workflow from "./pages/Workflow";
import ExtensionSettings from "./pages/ExtensionSettings";
import Kpis from "./pages/Kpis";

// REQUIRED — copy verbatim. Resolves the key from window.location.hostname so the
// same build serves multiple Clerk custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim. Empty in dev (Clerk hits dev FAPI directly), auto-set
// in prod. Do NOT gate on import.meta.env.PROD / NODE_ENV.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

// Clerk passes full paths to routerPush/routerReplace; React Router's navigate
// prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  baseTheme: dark,
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#4f8d63",
    colorForeground: "#f0f4ef",
    colorMutedForeground: "#9eb8a4",
    colorDanger: "#e05c50",
    colorBackground: "#1a2e22",
    colorInput: "#213229",
    colorInputForeground: "#f0f4ef",
    colorNeutral: "#3d5447",
    fontFamily: '"DM Sans", system-ui, sans-serif',
    borderRadius: "10px",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "w-[440px] max-w-full overflow-hidden rounded-2xl",
    card: "!shadow-none !border-0 !rounded-none",
    footer: "!shadow-none !border-0 !rounded-none",
    headerTitle: { color: "#f0f4ef", fontFamily: '"Manrope", sans-serif', letterSpacing: "-0.03em" },
    headerSubtitle: { color: "#9eb8a4" },
    socialButtonsBlockButtonText: { color: "#f0f4ef" },
    formFieldLabel: { color: "#9eb8a4", fontSize: "12px", fontWeight: "700" },
    footerActionLink: { color: "#c9f36b" },
    footerActionText: { color: "#9eb8a4" },
    dividerText: { color: "#9eb8a4" },
    identityPreviewEditButton: { color: "#c9f36b" },
    formFieldSuccessText: { color: "#c9f36b" },
    alertText: { color: "#f0f4ef" },
    logoBox: { justifyContent: "center" },
    logoImage: { height: "52px" },
    socialButtonsBlockButton: { borderColor: "#3d5447", backgroundColor: "#213229" },
    formButtonPrimary: { backgroundColor: "#215c42", color: "#ffffff" },
    formFieldInput: { backgroundColor: "#213229", borderColor: "#3d5447", color: "#f0f4ef" },
    footerAction: { backgroundColor: "#1a2e22" },
    dividerLine: { backgroundColor: "#3d5447" },
    alert: { backgroundColor: "#2a1a1a", borderColor: "#5c3030" },
    otpCodeFieldInput: { backgroundColor: "#213229", borderColor: "#3d5447", color: "#f0f4ef" },
    formFieldRow: {},
    main: {},
  },
};

function SignInPage() {
  return (
    <div className="login-page" style={{ display: "grid", placeItems: "center", minHeight: "100vh", background: "#0f1c15" }}>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} appearance={clerkAppearance} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="login-page" style={{ display: "grid", placeItems: "center", minHeight: "100vh", background: "#0f1c15" }}>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} appearance={clerkAppearance} />
    </div>
  );
}

function AppRoutes() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <div className="splash"><div className="brand-mark large">T</div><p>Preparing your outreach queue…</p></div>;
  }

  if (!isSignedIn) {
    return (
      <Routes>
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        <Route path="*" element={<Navigate to="/sign-in" replace />} />
      </Routes>
    );
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/prospects" element={<Prospects />} />
        <Route path="/prospects/:id" element={<ProspectDetail />} />
        <Route path="/workflow" element={<Workflow />} />
        <Route path="/extension" element={<ExtensionSettings />} />
        <Route path="/kpis" element={<Kpis />} />
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

// Wraps ClerkProvider so useNavigate is available (BrowserRouter is in main.tsx)
function ClerkProviderWithRouter() {
  const navigate = useNavigate();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to access your workspace",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Start tracking your outreach",
          },
        },
      }}
      routerPush={(to) => navigate(stripBase(to))}
      routerReplace={(to) => navigate(stripBase(to), { replace: true })}
    >
      <AppRoutes />
    </ClerkProvider>
  );
}

export default ClerkProviderWithRouter;
