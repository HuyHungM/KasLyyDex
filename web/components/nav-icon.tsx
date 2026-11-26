export function NavIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: "M3 10 12 3l9 7v10h-6v-6H9v6H3z",
    rank: "M7 4h10v5a5 5 0 0 1-10 0z M7 6H4a3 3 0 0 0 3 5 M17 6h3a3 3 0 0 1-3 5 M12 14v6m-4 0h8",
    bookmark: "M6 4h12v16l-6-4-6 4z",
    search: "M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0z m-2 6 5 5",
    sun: "M16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0z M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19",
    moon: "M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z",
    book: "M12 5v15M3 4h4a5 5 0 0 1 5 3 5 5 0 0 1 5-3h4v14h-4a6 6 0 0 0-5 2 6 6 0 0 0-5-2H3z",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  };
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name] ?? paths.book} />
    </svg>
  );
}
