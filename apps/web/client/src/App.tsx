import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { api } from "./api";
import { Button, Shell } from "./components";
import Dashboard from "./pages/Dashboard";
import Prospects from "./pages/Prospects";
import ProspectDetail from "./pages/ProspectDetail";
import Workflow from "./pages/Workflow";
import ExtensionSettings from "./pages/ExtensionSettings";
import type { User } from "./types";

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => { api<User>("/api/auth/user").then(setUser).catch(() => setUser(null)); }, []);
  if (user === undefined) return <div className="splash"><div className="brand-mark large">T</div><p>Preparing your outreach queue…</p></div>;
  if (!user) return <main className="login-page"><section className="login-card">
    <div className="brand-mark large">T</div><div className="eyebrow">Private workspace</div>
    <h1>Follow up thoughtfully.<br />Never lose the thread.</h1>
    <p>Trucea Outreach keeps every LinkedIn conversation and next step in one calm, focused queue.</p>
    <a className="button button-primary login-button" href="/api/login"><LockKeyhole size={18} />Continue with Replit <ArrowRight size={18} /></a>
    <small>Only the account configured for this workspace can sign in.</small>
  </section><aside className="login-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="login-quote">“A relationship is easier to build when the next step is obvious.”</div></aside></main>;
  return <Shell><Routes>
    <Route path="/" element={<Dashboard />} />
    <Route path="/prospects" element={<Prospects />} />
    <Route path="/prospects/:id" element={<ProspectDetail />} />
    <Route path="/workflow" element={<Workflow />} />
    <Route path="/extension" element={<ExtensionSettings />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Shell>;
}
