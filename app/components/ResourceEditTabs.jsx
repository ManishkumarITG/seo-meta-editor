import { useCallback } from "react";
import { useNavigate } from "@remix-run/react";
import { Tabs } from "@shopify/polaris";

// Generic single-vs-bulk tab strip used at the top of each editor page.
// `tabs` is an array of { id, content, url }; `activeTab` is the id of the
// tab to highlight.
export function ResourceEditTabs({ tabs, activeTab }) {
  const navigate = useNavigate();
  const selected = tabs.findIndex((t) => t.id === activeTab);

  const handleSelect = useCallback(
    (index) => {
      const target = tabs[index];
      if (target) navigate(target.url);
    },
    [tabs, navigate],
  );

  return (
    <Tabs
      tabs={tabs.map((t) => ({ id: t.id, content: t.content }))}
      selected={selected === -1 ? 0 : selected}
      onSelect={handleSelect}
    />
  );
}

export const PRODUCT_EDIT_TABS = [
  { id: "single", content: "Single product", url: "/app" },
  { id: "bulk", content: "Bulk update", url: "/app/bulk" },
];

export const COLLECTION_EDIT_TABS = [
  { id: "single", content: "Single collection", url: "/app/collections" },
  { id: "bulk", content: "Bulk update", url: "/app/collections/bulk" },
];
