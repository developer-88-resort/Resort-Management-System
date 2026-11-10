/** Presentation only. Authentication stays with the existing login form. */
export default function SignInLayout({ children }) {
  return (
    <main className="login">
      <div className="signin-shell">
        <section className="signin-resort" aria-label="88 Hotspring Resort">
          <div className="signin-brand"><span className="signin-monogram">88</span><div><strong>88 Hotspring Resort</strong><span>Integrated Resort Management System</span></div></div>
          <svg className="signin-landscape" viewBox="0 0 600 660" preserveAspectRatio="xMidYMax slice" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="signin-sky" x1="300" y1="0" x2="300" y2="660" gradientUnits="userSpaceOnUse"><stop stopColor="#e9efe5" /><stop offset="1" stopColor="#f5f1e5" /></linearGradient>
              <linearGradient id="signin-pool" x1="150" y1="370" x2="430" y2="610" gradientUnits="userSpaceOnUse"><stop stopColor="#82b9ae" /><stop offset="1" stopColor="#397f78" /></linearGradient>
            </defs>
            <path fill="url(#signin-sky)" d="M0 0h600v660H0z" />
            <circle cx="406" cy="210" r="57" fill="#debf7c" />
            <circle cx="406" cy="210" r="77" stroke="#debf7c" strokeOpacity=".2" />
            <path d="M-50 391c70-102 117-145 185-157 111-20 147 134 258 102 80-24 108-130 245-102v426H-50z" fill="#bcccb7" />
            <path d="M-40 425c92-80 152-109 221-78 111 50 190 5 264-61 56-50 124-45 199 0v374H-40z" fill="#8fae9c" />
            <path d="M-50 507c94-131 220-132 321-66 112 74 228-6 379-76v295H-50z" fill="#5c8c7e" />
            <path d="M-30 570c121-126 240-29 347-59 141-39 194-54 317-20v169H-30z" fill="#386c62" />
            <ellipse cx="310" cy="516" rx="213" ry="86" fill="#e7e4d2" />
            <ellipse cx="310" cy="509" rx="195" ry="70" fill="url(#signin-pool)" />
            <path d="M165 504c79-36 161 23 275-6M185 529c69-20 127 20 211 0M270 478c45 9 88 5 117-2" stroke="#d5eae0" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />
            <path d="M267 416c-16-22 12-30 0-52M304 410c-16-22 12-30 0-52M341 416c-16-22 12-30 0-52" stroke="#f5f4e7" strokeOpacity=".7" strokeWidth="3" strokeLinecap="round" />
            <path d="M0 599c130-4 181 71 340 36 89-20 155-26 260-7v32H0z" fill="#28584f" />
            <path d="M58 465c-9-60-7-101 10-142M68 386c-19-23-37-32-54-30M64 407c23-22 42-29 60-24M66 362c12-20 24-30 38-32" stroke="#427567" strokeWidth="7" strokeLinecap="round" />
          </svg>
        </section>
        <div className="signin-form-area">{children}<span className="signin-footer">88 Hotspring Resort &middot; IRMS</span></div>
      </div>
    </main>
  );
}
