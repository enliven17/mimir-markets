/**
 * The Mimir Terminal mark (brand/logo/mimir-terminal.svg): a pixel prompt
 * chevron, the M from the display face, and a blinking red cursor where the
 * M. mark has its period. Inline so it costs no request.
 */
export default function TerminalMark({ className = "", blink = true }: { className?: string; blink?: boolean }) {
  return (
    <svg viewBox="0 0 1120 640" className={className} role="img" aria-label="Mimir Terminal">
      <path
        fill="#ff2b2b"
        d="M0 96H96V160H0ZM48 160H144V224H48ZM96 224H192V288H96ZM144 288H240V352H144ZM96 352H192V416H96ZM48 416H144V480H48ZM0 480H96V544H0Z"
      />
      <path
        fill="#f3ead6"
        transform="translate(288 0)"
        d="M0 640V0H160V96H192V160H224V256H256V352H288V480H320V352H352V256H384V160H416V96H448V0H608V640H512V160H480V224H448V352H416V480H384V576H352V640H256V576H224V480H192V352H160V224H128V160H96V640Z"
      />
      <path fill="#ff2b2b" d="M960 544H1120V640H960Z" className={blink ? "animate-blink motion-reduce:animate-none" : undefined} />
    </svg>
  );
}
