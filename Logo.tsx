export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 64 64" className="h-8 w-8 shrink-0" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#151631" />
        <text x="32" y="43" textAnchor="middle" fontFamily="Georgia, serif" fontStyle="italic" fontSize="30" fill="#fff">f′</text>
        <path d="M14 30c2-13 17-20 30-15s14 22 2 29-30 3-32-9" fill="none" stroke="#FF806D" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <span className="font-display text-xl font-extrabold tracking-tight">Catch the AI</span>
    </span>
  );
}
