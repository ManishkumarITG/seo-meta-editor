import { Outlet } from "@remix-run/react";

// Layout shell for /app/collections and its children. Without this, the
// single-collection editor would be treated as the parent of the bulk
// pages and would render in their place.
export default function CollectionsLayout() {
  return <Outlet />;
}
