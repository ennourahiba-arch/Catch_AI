import { motion } from "framer-motion";

/** The hand-drawn coral ring: the student's "red pen" catch. */
export default function Ring({ className = "", color = "#FF806D", delay = 0 }: { className?: string; color?: string; delay?: number }) {
  return (
    <svg viewBox="0 0 60 52" className={`pointer-events-none absolute ${className}`} aria-hidden="true">
      <motion.path
        d="M10 22 C 12 8, 40 2, 51 14 C 60 25, 50 44, 30 46 C 12 47, 3 36, 8 22 C 10 16, 16 12, 22 10"
        fill="none"
        stroke={color}
        strokeWidth="3.2"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.55, ease: "easeOut", delay }}
      />
    </svg>
  );
}
