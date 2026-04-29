import { useEffect, useState } from "react";
import {
  BlockStack,
  Box,
  Button,
  Card,
  InlineError,
  InlineStack,
  Modal,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import {
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  counterLabel,
  counterTone,
} from "../utils/seoValidation";

function fieldErrorsFromUserErrors(errors) {
  const map = {};
  for (const err of errors) {
    const path = err.field ?? [];
    if (path.includes("title") && path.includes("seo")) {
      map.title = err.message;
    } else if (path.includes("description") && path.includes("seo")) {
      map.description = err.message;
    }
  }
  return map;
}

export function SeoEditor({ product, saving, userErrors, onSave, adminUrl }) {
  const [title, setTitle] = useState(product.seo.title ?? "");
  const [description, setDescription] = useState(
    product.seo.description ?? "",
  );
  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);

  useEffect(() => {
    setTitle(product.seo.title ?? "");
    setDescription(product.seo.description ?? "");
  }, [product.id, product.seo.title, product.seo.description]);

  const fieldErrors = fieldErrorsFromUserErrors(userErrors);
  const titleLen = title.length;
  const descLen = description.length;
  const titleOver = titleLen > SEO_TITLE_MAX;
  const descOver = descLen > SEO_DESCRIPTION_MAX;

  const handleSaveClick = () => {
    if (title.trim() === "" && description.trim() === "") {
      setConfirmEmptyOpen(true);
      return;
    }
    onSave({ title, description });
  };

  const confirmEmptySave = () => {
    setConfirmEmptyOpen(false);
    onSave({ title: "", description: "" });
  };

  return (
    <>
      <Card>
        <BlockStack gap="500">
          <InlineStack gap="400" blockAlign="center">
            {product.featuredImage ? (
              <Thumbnail
                source={product.featuredImage.url}
                alt={product.featuredImage.altText ?? product.title}
                size="large"
              />
            ) : (
              <Thumbnail source="" alt={product.title} size="large" />
            )}
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                {product.title}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Handle: {product.handle}
              </Text>
            </BlockStack>
          </InlineStack>

          <BlockStack gap="200">
            <TextField
              label="SEO title"
              value={title}
              onChange={setTitle}
              autoComplete="off"
              placeholder="Falls back to product title"
              error={fieldErrors.title}
              maxLength={undefined}
              helpText={
                <Text
                  as="span"
                  variant="bodySm"
                  tone={counterTone(titleLen, SEO_TITLE_MAX)}
                >
                  {counterLabel(titleLen, SEO_TITLE_MAX)}
                  {titleOver ? " — over recommended length" : ""}
                </Text>
              }
            />
          </BlockStack>

          <BlockStack gap="200">
            <TextField
              label="SEO description"
              value={description}
              onChange={setDescription}
              autoComplete="off"
              multiline={4}
              placeholder="Falls back to product description"
              error={fieldErrors.description}
              helpText={
                <Text
                  as="span"
                  variant="bodySm"
                  tone={counterTone(descLen, SEO_DESCRIPTION_MAX)}
                >
                  {counterLabel(descLen, SEO_DESCRIPTION_MAX)}
                  {descOver ? " — over recommended length" : ""}
                </Text>
              }
            />
          </BlockStack>

          {userErrors.length > 0 &&
            fieldErrors.title === undefined &&
            fieldErrors.description === undefined && (
              <Box>
                <InlineError
                  message={userErrors.map((e) => e.message).join("; ")}
                  fieldID="seo-form-errors"
                />
              </Box>
            )}

          <InlineStack gap="200">
            <Button variant="primary" loading={saving} onClick={handleSaveClick}>
              Save changes
            </Button>
            <Button
              url={
                adminUrl ??
                `shopify:admin/products/${product.id.replace(
                  "gid://shopify/Product/",
                  "",
                )}`
              }
              target="_blank"
              variant="plain"
            >
              View in Shopify admin
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>

      <Modal
        open={confirmEmptyOpen}
        onClose={() => setConfirmEmptyOpen(false)}
        title="Clear SEO fields?"
        primaryAction={{
          content: "Save empty",
          destructive: true,
          onAction: confirmEmptySave,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setConfirmEmptyOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            Both SEO title and description are empty. Shopify will fall back to
            the product title and body. Save anyway?
          </Text>
        </Modal.Section>
      </Modal>
    </>
  );
}
