const GLYPHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10.5h18" />
      <path d="M16.5 15h.01" />
    </>
  ),
  map: (
    <>
      <path d="m9 4 6 2 5-2v14l-5 2-6-2-5 2V6z" />
      <path d="M9 4v14" />
      <path d="M15 6v14" />
    </>
  ),
  sunrise: (
    <>
      <path d="M12 3v3" />
      <path d="m6.3 8.3 1.6 1.6" />
      <path d="m17.7 8.3-1.6 1.6" />
      <path d="M3 17h18" />
      <path d="M6.5 21h11" />
      <path d="M8 17a4 4 0 0 1 8 0" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2" />
      <path d="M12 19.5v2" />
      <path d="m5.1 5.1 1.4 1.4" />
      <path d="m17.5 17.5 1.4 1.4" />
      <path d="M2.5 12h2" />
      <path d="M19.5 12h2" />
      <path d="m5.1 18.9 1.4-1.4" />
      <path d="m17.5 6.5 1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  building: (
    <>
      <path d="M4 21V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v15" />
      <path d="M16 10h2a2 2 0 0 1 2 2v9" />
      <path d="M2.5 21h19" />
      <path d="M8 8h2" />
      <path d="M8 12h2" />
      <path d="M8 16h2" />
    </>
  ),
  transit: (
    <>
      <rect x="4" y="4" width="16" height="12" rx="2" />
      <path d="M4 10.5h16" />
      <path d="M7.5 20v-2" />
      <path d="M16.5 20v-2" />
      <path d="M8 13.5h.01" />
      <path d="M16 13.5h.01" />
    </>
  ),
  dining: (
    <>
      <path d="M6 3v7a2.5 2.5 0 0 0 5 0V3" />
      <path d="M8.5 12.5V21" />
      <path d="M17.5 3c-1.6 1.2-2.5 3.2-2.5 5.5s.9 4 2.5 4V21" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11.5v4.5" />
      <path d="M12 8h.01" />
    </>
  ),
  document: (
    <>
      <path d="M14 3H7.5A2 2 0 0 0 5.5 5v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13.5h6" />
      <path d="M9 17h4" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M3 12.5h18" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16" />
      <path d="M7.5 20v-5.5" />
      <path d="M12 20V7" />
      <path d="M16.5 20v-8.5" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="9" r="5" />
      <path d="m8.6 13.4-1.3 7 4.7-2.4 4.7 2.4-1.3-7" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v15H7.5A2.5 2.5 0 0 0 5 19.5z" />
      <path d="M5 19.5A2.5 2.5 0 0 1 7.5 17H19v5H7.5A2.5 2.5 0 0 1 5 19.5z" />
    </>
  ),
  tool: (
    <>
      <path d="M15.5 3.2a5 5 0 0 0-6.2 6.4l-5.7 5.7a2 2 0 1 0 2.8 2.8l5.7-5.7a5 5 0 0 0 6.4-6.2l-2.9 2.9-2.3-.6-.6-2.3z" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.4 2.7 17.6A1.9 1.9 0 0 0 4.4 20.5h15.2a1.9 1.9 0 0 0 1.7-2.9L13.7 4.4a1.9 1.9 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 16.8h.01" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 18.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.2 6.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1H22a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </>
  ),
};

export function Icon({ name, size = 20, className, strokeWidth = 1.75 }) {
  const glyph = GLYPHS[name];
  if (!glyph) return null;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph}
    </svg>
  );
}

export default Icon;
