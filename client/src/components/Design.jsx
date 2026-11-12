/** Decorative icons and summaries only; no workflow or permission logic. */
export function Icon({ name = 'calendar', size = 20 }) {
  const paths = {
    calendarAdd: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18M12 13v5M9.5 15.5h5" /></>,
    print: <><path d="M7 8V3h10v5M7 17H4V9h16v8h-3" /><path d="M7 14h10v7H7zM17 11h.01" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    filter: <><path d="M4 7h16M7 12h10M10 17h4" /><circle cx="8" cy="7" r="2" fill="white" /><circle cx="15" cy="12" r="2" fill="white" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2" /></>,
    bed: <><path d="M3 18v3M21 18v3M3 11V5M21 18H3v-7h15a3 3 0 0 1 3 3z" /><path d="M7 11V7h5v4" /></>,
    door: <><path d="M4 21h16M6 21V4l12-1v18M14 12h.01" /></>,
    sparkle: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 3v4M18 5h4" /></>,
    people: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-3-5" /></>,
    locker: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 10h8M15 14v3M12 3v18" /></>,
    wallet: <><path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h16v12H5a3 3 0 0 1-3-3V6M21 13h-6v4h6" /></>,
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.calendar}</svg>;
}

export function Metric({ icon, label, value, detail, tone = 'teal' }) {
  return <div className={`stat metric ${tone}`}>
    <div className="metric-top"><span className="l">{label}</span><span className="metric-icon"><Icon name={icon} /></span></div>
    <div className="v">{value}</div>
    {detail && <div className="metric-detail">{detail}</div>}
  </div>;
}

export function EmptyState({ icon, title, detail }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={24} /></span><strong>{title}</strong>{detail && <span>{detail}</span>}</div>;
}

/** Shared visual label; the parent keeps its route and permission checks. */
export function ReservationActionLabel() {
  return <><span className="reservation-action-icon"><Icon name="calendarAdd" size={19} /></span><span>New Reservation</span><span className="reservation-action-arrow"><Icon name="arrow" size={16} /></span></>;
}
