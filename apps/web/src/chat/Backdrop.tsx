// The animated background behind the frosted glass panels: slow drifting light, a faint
// grid and fine grain, so the glass has something to blur. Pure CSS (style.css), and it
// holds still for people who prefer reduced motion.
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <span className="aurora aurora-1" />
      <span className="aurora aurora-2" />
      <span className="aurora aurora-3" />
      <span className="aurora aurora-4" />
      <span className="backdrop-grid" />
      <span className="backdrop-grain" />
    </div>
  );
}
