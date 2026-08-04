import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { CalendarCheck, Chrome, LogOut, Route, Users, X } from "lucide-react";

export function Button({ children, variant = "primary", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "yellow" | "red" | "blue" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Empty({ icon, title, body }: { icon?: ReactNode; title: string; body: string }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{body}</p></div>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
      {children}
    </section>
  </div>;
}

export function Shell({ children }: { children: ReactNode }) {
  const links = [
    { to: "/", label: "Today", icon: CalendarCheck },
    { to: "/prospects", label: "Prospects", icon: Users },
    { to: "/workflow", label: "Workflow", icon: Route },
    { to: "/extension", label: "Extension", icon: Chrome },
  ];
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">T</div><div><strong>Trucea</strong><span>Outreach</span></div></div>
      <nav>{links.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === "/"}><Icon size={19} /><span>{label}</span></NavLink>)}</nav>
      <a className="logout" href="/api/logout"><LogOut size={18} />Sign out</a>
    </aside>
    <main className="main-content">{children}</main>
    <nav className="mobile-nav">{links.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === "/"}><Icon size={19} /><span>{label}</span></NavLink>)}</nav>
  </div>;
}

export function PageHeader({ eyebrow, title, body, action }: { eyebrow?: string; title: string; body?: string; action?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{body && <p>{body}</p>}</div>{action}</header>;
}
