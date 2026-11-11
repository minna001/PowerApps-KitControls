import type { ReactNode } from "react";
import type { UserContext } from "../data/types";
import {
  HomeRegular,
  DocumentMultipleRegular,
  ClipboardTaskRegular,
  TaskListLtrRegular,
  CalendarLtrRegular,
  CheckmarkCircleRegular,
} from "@fluentui/react-icons";

interface NavItem {
  label: string;
  href?: string;
  icon: ReactNode;
  match?: (route: string) => boolean;
}

const NAV: { heading: string; adminOnly?: boolean; items: NavItem[] }[] = [
  {
    heading: "Work",
    items: [
      { label: "Home", href: "#/home", icon: <HomeRegular />, match: (r) => r === "/home" },
      { label: "My submissions", href: "#/mine", icon: <DocumentMultipleRegular />, match: (r) => r === "/mine" || r === "/new" || r === "/reuse" || r.startsWith("/onboarding") },
      { label: "My approvals", href: "#/approvals", icon: <CheckmarkCircleRegular />, match: (r) => r === "/approvals" },
    ],
  },
  { heading: "Committee", items: [{ label: "Calendar and slots", href: "#/calendar", icon: <CalendarLtrRegular />, match: (r) => r === "/calendar" }] },
  {
    heading: "Administration",
    adminOnly: true,
    items: [
      { label: "Admin queue", href: "#/queue", icon: <ClipboardTaskRegular />, match: (r) => r === "/queue" },
      { label: "Portfolio", href: "#/portfolio", icon: <TaskListLtrRegular />, match: (r) => r === "/portfolio" || r.startsWith("/submission") },
    ],
  },
];

export function Shell({ route, isSample, user, children }: { route: string; isSample: boolean; user: UserContext; children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="nav" aria-label="Primary">
        <div className="nav-brand">
          <div className="nav-brand-name">NBPRA</div>
          <div className="nav-brand-sub">New Business and Product Risk Approval</div>
        </div>
        {NAV.filter((g) => !g.adminOnly || user.isAdmin).map((g) => (
          <div key={g.heading}>
            <div className="nav-heading">{g.heading}</div>
            {g.items.map((it) => {
              const active = it.match?.(route) ?? false;
              return it.href ? (
                <a key={it.label} href={it.href} className={"nav-item" + (active ? " active" : "")} aria-current={active ? "page" : undefined}>
                  {it.icon}
                  {it.label}
                </a>
              ) : (
                <span key={it.label} className="nav-item disabled" title="Not built yet">
                  {it.icon}
                  {it.label}
                </span>
              );
            })}
          </div>
        ))}
      </aside>
      <div className="main">
        {isSample && (
          <div className="banner" role="status">
            Sample data. These records are invented and are not stored in Dataverse.
          </div>
        )}
        <header className="topbar">
          <span className="topbar-user">
            Signed in as {user.fullName}
            {user.isAdmin ? " · NBPRA administrator" : ""}
          </span>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
