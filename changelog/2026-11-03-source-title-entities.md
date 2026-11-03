# Source names decode HTML entities

YouTube's search and channel APIs return names HTML-escaped, and they were stored as-is, so
"Tbone &amp; Solo" showed raw in the Short bar and sheet headings (found during #208). Source
names now go through `store.CleanTitle` on create, import and rename, and a migration repairs
existing ones on boot. In production that was one source; item titles were already clean.
