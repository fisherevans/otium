import { useState } from "react";
import { ChevronRight } from "lucide-react";

// HowItWorks (#138): an inline, expandable explainer for new users. No forced
// walkthrough - it sits quietly in empty states (and can be dropped anywhere) and
// unfolds the model + how a session is built only if someone's curious. Otium ships
// no default sections/topics, so this is the "how do I even start" answer.
export function HowItWorks({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`hiw ${open ? "open" : ""}`}>
      <button className="hiw-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ChevronRight size={16} strokeWidth={2} className="hiw-chev" aria-hidden />
        How Otium works
      </button>
      {open && (
        <div className="hiw-body">
          <p>
            Otium is built from feeds you choose - RSS or Atom feeds, YouTube channels, podcasts. You organize them into a
            simple hierarchy that's entirely yours to name:
          </p>
          <div className="hiw-tree">
            <div className="hiw-tier">
              <b>Section</b> <span>a reading context - "Morning", "News", "Weekend"</span>
            </div>
            <div className="hiw-tier hiw-i1">
              <b>Topic</b> <span>a theme inside it - "Local News", "Comedy"</span>
            </div>
            <div className="hiw-tier hiw-i2">
              <b>Source</b> <span>one feed you follow - a site, a channel</span>
            </div>
            <div className="hiw-tier hiw-i3">
              <b>Article</b> <span>the things you actually read (from the source)</span>
            </div>
          </div>
          <p className="hiw-sub">Every section, topic, and source is named and arranged by you. A source lives in one topic; a topic in one section.</p>
          <p className="hiw-h">How a session is built</p>
          <ol className="hiw-steps">
            <li>You say how long you have - 10, 20, 30 minutes.</li>
            <li>You pick a section or two (or everything you follow).</li>
            <li>
              Otium assembles a finite session from those sources, balanced by <i>representation</i> so a source that posts
              hourly doesn't drown out one that posts monthly.
            </li>
            <li>When your time's up, you're done. Missing things is okay - old items quietly expire.</li>
          </ol>
        </div>
      )}
    </div>
  );
}
