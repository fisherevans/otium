// Standalone entry for the layout lab, built as a single self-contained page so
// it can be handed to someone as a file rather than a dev server. No auth, no
// API, no router - the lab runs entirely off fixtures, so nothing here needs a
// backend. The card, its components and its CSS are the real ones.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// global.css FIRST, deliberately. LabPage imports lab.css, and ES imports
// evaluate depth-first in order - so importing LabPage first put lab.css BEFORE
// global.css in the bundle, and every shipped rule of equal specificity won on
// order. That is why the card kept ignoring the lab's own knobs.
import "@/styles/global.css";
import { LabPage } from "@/lab/LabPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LabPage />
  </StrictMode>,
);
