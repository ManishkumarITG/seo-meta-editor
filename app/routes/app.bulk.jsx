import { Outlet } from "@remix-run/react";

// Layout shell for /app/bulk and its children (/app/bulk and /app/bulk/:jobId).
// Authentication runs in each leaf's loader; this file only exists so Remix
// flat-routes treats the index and detail pages as siblings of one another
// instead of nesting the detail page inside the bulk-upload UI.
export default function BulkLayout() {
  return <Outlet />;
}
