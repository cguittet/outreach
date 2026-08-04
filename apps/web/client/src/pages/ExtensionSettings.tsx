import { useEffect, useState } from "react";
import { Check, Chrome, Clipboard, KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "../api";
import { Badge, Button, Empty, PageHeader } from "../components";

interface TokenRecord { id: string; name: string; createdAt: string; lastUsedAt?: string; revokedAt?: string }

export default function ExtensionSettings() {
  const [tokens, setTokens] = useState<TokenRecord[]>([]); const [newToken, setNewToken] = useState(""); const [copied, setCopied] = useState(false);
  const load = () => api<TokenRecord[]>("/api/extension-tokens").then(setTokens); useEffect(() => { void load(); }, []);
  const create = async () => { const result = await api<TokenRecord & { token: string }>("/api/extension-tokens", { method: "POST", body: JSON.stringify({ name: "Chrome extension" }) }); setNewToken(result.token); load(); };
  const revoke = async (id: string) => { await api(`/api/extension-tokens/${id}`, { method: "DELETE" }); load(); };
  return <div className="page narrow-page"><PageHeader eyebrow="Browser companion" title="Chrome extension" body="Add prospects and update conversations without losing your place on LinkedIn." />
    <section className="extension-hero"><div className="extension-icon"><Chrome size={32} /></div><div><h2>Install the Trucea companion</h2><p>Build the extension from this repository, load the generated folder in Chrome, then pair it here.</p></div><Badge tone="green"><ShieldCheck size={14} />No scraping</Badge></section>
    <section className="panel setup-steps"><div className="panel-heading"><div><span className="section-label">Setup</span><h2>Pair this dashboard</h2></div></div><ol><li><span>1</span><div><strong>Build and load the extension</strong><p>Run the extension build, then open <code>chrome://extensions</code> and choose “Load unpacked.”</p></div></li><li><span>2</span><div><strong>Create a pairing token</strong><p>Tokens are displayed once and stored only as a secure hash.</p></div></li><li><span>3</span><div><strong>Paste the dashboard URL and token</strong><p>The extension requests access only to this deployed origin.</p></div></li></ol>
      {!newToken ? <Button onClick={create}><Plus size={17} />Create pairing token</Button> : <div className="token-reveal"><div><KeyRound size={18} /><code>{newToken}</code></div><Button variant="secondary" onClick={() => { navigator.clipboard.writeText(newToken); setCopied(true); }}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? "Copied" : "Copy token"}</Button><p>Copy this now. It cannot be shown again.</p></div>}
    </section>
    <section className="panel"><div className="panel-heading"><div><span className="section-label">Security</span><h2>Paired extensions</h2></div></div>{tokens.length ? <div className="token-list">{tokens.map((token) => <div key={token.id}><div><strong>{token.name}</strong><span>Created {new Date(token.createdAt).toLocaleDateString()}{token.lastUsedAt ? ` · Used ${new Date(token.lastUsedAt).toLocaleDateString()}` : " · Never used"}</span></div>{token.revokedAt ? <Badge tone="neutral">Revoked</Badge> : <button className="icon-button danger" onClick={() => revoke(token.id)} aria-label="Revoke token"><Trash2 size={17} /></button>}</div>)}</div> : <Empty icon={<KeyRound />} title="No extensions paired" body="Create a token when you’re ready to connect Chrome." />}</section>
  </div>;
}
