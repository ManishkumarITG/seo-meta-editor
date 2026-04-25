import {
  BlockStack,
  Card,
  EmptyState,
  ResourceItem,
  ResourceList,
  Text,
} from "@shopify/polaris";

export function RecentEdits({ edits, onSelect }) {
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h3" variant="headingMd">
          Recent edits
        </Text>
        {edits.length === 0 ? (
          <EmptyState heading="No edits yet" image="">
            <p>Edits you make will appear here.</p>
          </EmptyState>
        ) : (
          <ResourceList
            resourceName={{ singular: "edit", plural: "edits" }}
            items={edits}
            renderItem={(item) => {
              const editedAt = new Date(item.editedAt);
              return (
                <ResourceItem
                  id={String(item.id)}
                  onClick={() => onSelect(item)}
                  accessibilityLabel={`Open ${item.productTitle}`}
                >
                  <BlockStack gap="050">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {item.productTitle}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {editedAt.toLocaleString()}
                    </Text>
                  </BlockStack>
                </ResourceItem>
              );
            }}
          />
        )}
      </BlockStack>
    </Card>
  );
}
