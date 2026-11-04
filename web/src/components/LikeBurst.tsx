import { useEffect } from "react";
import { Heart } from "lucide-react";
import "./like-burst.css";

// The double-tap acknowledgement (#196): a heart where the finger was, gone in a
// moment. Liking shows a filled heart; undoing a like shows an outline. Under
// reduced motion or e-ink it appears and leaves without the bloom.
export type Burst = { key: number; x: number; y: number; liked: boolean };

export function LikeBurst({ burst, onDone }: { burst: Burst | null; onDone: () => void }) {
  useEffect(() => {
    if (!burst) return;
    const t = window.setTimeout(onDone, 750);
    return () => window.clearTimeout(t);
  }, [burst, onDone]);
  if (!burst) return null;
  return (
    <div key={burst.key} className={`like-burst ${burst.liked ? "on" : "off"}`} style={{ left: burst.x, top: burst.y }}
      role="status" aria-live="polite">
      <Heart size={84} strokeWidth={1.5} fill={burst.liked ? "currentColor" : "none"} aria-hidden />
      <span className="like-burst-label">{burst.liked ? "Liked" : "Like removed"}</span>
    </div>
  );
}
