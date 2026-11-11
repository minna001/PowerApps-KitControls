import type { ReactNode } from "react";
import {
  HomeRegular,
  DocumentMultipleRegular,
  ClipboardTaskRegular,
  TaskListLtrRegular,
  CalendarLtrRegular,
  MailRegular,
  AlertRegular,
  CheckmarkCircleRegular,
} from "@fluentui/react-icons";

interface NavItem {
  label: string;
  href?: string;
  icon: ReactNode;
  match?: (route: string) => boolean;
}

const NAV: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Work",
    items: [
      { label: "Home", icon: <HomeRegular /> },
      { label: "My submissions", icon: <DocumentMultipleRegular /> },
      { label: "My approvals", icon: <CheckmarkCircleRegular /> },
      { label: "Admin queue", href: "#/queue", icon: <ClipboardTaskRegular />, match: (r) => r === "/queue" },
      {
        label: "Portfolio",
        href: "#/portfolio",
        icon: <TaskListLtrRegular />,
        match: (r) => r.startsWith("/portfolio") || r.startsWith("/submission"),
      },
    ],
  },
  { heading: "Committee", items: [{ label: "Calendar and slots", icon: <CalendarLtrRegular /> }] },
  { heading: "Records", items: [{ label: "Notifications", icon: <MailRegular /> }] },
];

export function Shell({ route, isSample, userName, children }: { route: string; isSample: boolean; userName: string; children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="nav" aria-label="Primary">
        <div className="nav-brand">
          <div className="nav-brand-name">NBPRA</div>
          <div className="nav-brand-sub">New Business and Product Risk Approval</div>
        </div>
        {NAV.map((g) => (
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
          <span className="topbar-user">{userName ? `Signed in as ${userName}` : ""}</span>
          <button className="btn" aria-label="Notifications">
            <AlertRegular /> 0
          </button>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
