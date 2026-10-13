import AgentFace from "./AgentFace";

/** The council as one mark: three of its faces, overlapping (Socrates in front). */
export default function CouncilMark({ size = 44, className = "" }: { size?: number; className?: string }) {
  const small = Math.round(size * 0.78);
  return (
    <span className={`relative inline-block shrink-0 ${className}`} style={{ width: Math.round(size * 2.3), height: size }} aria-hidden>
      <span className="absolute bottom-0 left-0 opacity-80">
        <AgentFace seed="taleb" size={small} className="ring-2 ring-ink" />
      </span>
      <span className="absolute bottom-0 right-0 opacity-80">
        <AgentFace seed="optimist" size={small} className="ring-2 ring-ink" />
      </span>
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2">
        <AgentFace seed="socrates" size={size} className="ring-2 ring-ink" />
      </span>
    </span>
  );
}
