import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  EmptyState,
  Layout,
  Page,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  GET_PRODUCT_BY_HANDLE,
  GET_PRODUCT_BY_ID,
} from "../graphql/getProduct";
import { UPDATE_PRODUCT_SEO } from "../graphql/updateProductSeo";
import {
  ProductInputError,
  parseProductInput,
  productGidFromId,
  productIdFromGid,
} from "../utils/parseProductUrl";
import { SeoEditor } from "../components/SeoEditor";
import { RecentEdits } from "../components/RecentEdits";

const RECENT_EDITS_LIMIT = 10;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const records = await prisma.editHistory.findMany({
    where: { shop: session.shop },
    orderBy: { editedAt: "desc" },
    take: RECENT_EDITS_LIMIT,
  });

  const recentEdits = records.map((record) => ({
    id: record.id,
    productId: record.productId,
    productTitle: record.productTitle,
    editedAt: record.editedAt.toISOString(),
  }));

  return { recentEdits };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "load") {
    const raw = String(formData.get("input") ?? "");
    let parsed;
    try {
      parsed = parseProductInput(raw);
    } catch (error) {
      const message =
        error instanceof ProductInputError
          ? error.message
          : "Invalid product input.";
      return { ok: false, intent: "load", message };
    }

    try {
      let product = null;

      if (parsed.type === "handle") {
        const response = await admin.graphql(GET_PRODUCT_BY_HANDLE, {
          variables: { handle: parsed.value },
        });
        const json = await response.json();
        product = json.data?.productByHandle ?? null;
      } else {
        const response = await admin.graphql(GET_PRODUCT_BY_ID, {
          variables: { id: productGidFromId(parsed.value) },
        });
        const json = await response.json();
        product = json.data?.product ?? null;
      }

      if (!product) {
        return {
          ok: false,
          intent: "load",
          message: "Product not found in this store.",
        };
      }

      return { ok: true, intent: "load", product };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load product.";
      return { ok: false, intent: "load", message };
    }
  }

  if (intent === "save") {
    const productId = String(formData.get("productId") ?? "");
    const productTitle = String(formData.get("productTitle") ?? "");
    const oldTitle = String(formData.get("oldTitle") ?? "");
    const oldDescription = String(formData.get("oldDescription") ?? "");
    const newTitle = String(formData.get("newTitle") ?? "");
    const newDescription = String(formData.get("newDescription") ?? "");

    try {
      const response = await admin.graphql(UPDATE_PRODUCT_SEO, {
        variables: {
          input: {
            id: productId,
            seo: { title: newTitle, description: newDescription },
          },
        },
      });
      const json = await response.json();

      const result = json.data?.productUpdate;
      const userErrors = result?.userErrors ?? [];
      const updatedSeo = result?.product?.seo ?? {
        title: newTitle,
        description: newDescription,
      };

      const refreshedProduct = {
        id: productId,
        title: productTitle,
        handle: String(formData.get("handle") ?? ""),
        featuredImage: null,
        seo: updatedSeo,
      };

      const featuredImageUrl = formData.get("featuredImageUrl");
      const featuredImageAlt = formData.get("featuredImageAlt");
      if (typeof featuredImageUrl === "string" && featuredImageUrl !== "") {
        refreshedProduct.featuredImage = {
          url: featuredImageUrl,
          altText:
            typeof featuredImageAlt === "string" && featuredImageAlt !== ""
              ? featuredImageAlt
              : null,
        };
      }

      if (userErrors.length > 0) {
        return {
          ok: false,
          intent: "save",
          userErrors,
          product: refreshedProduct,
        };
      }

      await prisma.editHistory.create({
        data: {
          shop: session.shop,
          productId,
          productTitle,
          oldTitle: oldTitle || null,
          newTitle: newTitle || null,
          oldDescription: oldDescription || null,
          newDescription: newDescription || null,
        },
      });

      return { ok: true, intent: "save", product: refreshedProduct };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save product SEO.";
      return {
        ok: false,
        intent: "save",
        message,
        userErrors: [],
        product: {
          id: productId,
          title: productTitle,
          handle: String(formData.get("handle") ?? ""),
          featuredImage: null,
          seo: { title: oldTitle, description: oldDescription },
        },
      };
    }
  }

  return {
    ok: false,
    intent: "load",
    message: "Unknown intent.",
  };
};

export default function Index() {
  const { recentEdits } = useLoaderData();
  const loadFetcher = useFetcher();
  const saveFetcher = useFetcher();
  const shopify = useAppBridge();

  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState(undefined);
  const [product, setProduct] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [userErrors, setUserErrors] = useState([]);

  const isLoading =
    loadFetcher.state !== "idle" && loadFetcher.formMethod === "POST";
  const isSaving =
    saveFetcher.state !== "idle" && saveFetcher.formMethod === "POST";

  const lastLoadInput = useMemo(() => urlInput.trim(), [urlInput]);

  useEffect(() => {
    const data = loadFetcher.data;
    if (!data || data.intent !== "load") return;

    if (data.ok) {
      setProduct(data.product);
      setLoadError(null);
      setUserErrors([]);
      setSaveError(null);
    } else {
      setProduct(null);
      setLoadError(data.message);
    }
  }, [loadFetcher.data]);

  useEffect(() => {
    const data = saveFetcher.data;
    if (!data || data.intent !== "save") return;

    if (data.ok) {
      setProduct(data.product);
      setUserErrors([]);
      setSaveError(null);
      shopify.toast.show("SEO updated");
    } else {
      setProduct(data.product);
      setUserErrors(data.userErrors);
      setSaveError(data.message ?? null);
    }
  }, [saveFetcher.data, shopify]);

  const submitLoad = (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      setUrlError("Enter a product URL, handle, or ID.");
      return;
    }
    try {
      parseProductInput(trimmed);
      setUrlError(undefined);
    } catch (error) {
      if (error instanceof ProductInputError) {
        setUrlError(error.message);
        return;
      }
      throw error;
    }
    const fd = new FormData();
    fd.set("intent", "load");
    fd.set("input", trimmed);
    loadFetcher.submit(fd, { method: "POST" });
  };

  const handleSave = ({ title, description }) => {
    if (!product) return;
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("productId", product.id);
    fd.set("productTitle", product.title);
    fd.set("handle", product.handle);
    fd.set("oldTitle", product.seo.title ?? "");
    fd.set("oldDescription", product.seo.description ?? "");
    fd.set("newTitle", title);
    fd.set("newDescription", description);
    if (product.featuredImage) {
      fd.set("featuredImageUrl", product.featuredImage.url);
      fd.set("featuredImageAlt", product.featuredImage.altText ?? "");
    }
    saveFetcher.submit(fd, { method: "POST" });
  };

  const reloadFromHistory = (edit) => {
    const id = productIdFromGid(edit.productId);
    setUrlInput(id);
    setUrlError(undefined);
    const fd = new FormData();
    fd.set("intent", "load");
    fd.set("input", id);
    loadFetcher.submit(fd, { method: "POST" });
  };

  return (
    <Page
      secondaryActions={[
        {
          content: "Bulk Edit",
          url: "/app/bulk",
          accessibilityLabel: "Open bulk SEO update page",
        },
      ]}
    >
      <TitleBar title="SEO Editor" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Load a product
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Paste a product URL, handle, or ID from your Shopify
                    storefront or admin.
                  </Text>
                  <TextField
                    label="Product URL or handle"
                    labelHidden
                    value={urlInput}
                    onChange={(value) => {
                      setUrlInput(value);
                      if (urlError) setUrlError(undefined);
                    }}
                    autoComplete="off"
                    placeholder="https://your-store.myshopify.com/products/cool-shirt"
                    error={urlError}
                    onBlur={() => {
                      if (!urlInput.trim()) return;
                      try {
                        parseProductInput(urlInput);
                        setUrlError(undefined);
                      } catch (error) {
                        if (error instanceof ProductInputError) {
                          setUrlError(error.message);
                        }
                      }
                    }}
                    connectedRight={
                      <Button
                        variant="primary"
                        loading={isLoading}
                        onClick={() => submitLoad(urlInput)}
                      >
                        Load product
                      </Button>
                    }
                  />
                </BlockStack>
              </Card>

              {loadError && (
                <Banner
                  tone="critical"
                  title="Could not load product"
                  action={{
                    content: "Retry",
                    onAction: () => submitLoad(lastLoadInput),
                  }}
                  onDismiss={() => setLoadError(null)}
                >
                  <p>{loadError}</p>
                </Banner>
              )}

              {saveError && (
                <Banner
                  tone="critical"
                  title="Could not save SEO"
                  onDismiss={() => setSaveError(null)}
                >
                  <p>{saveError}</p>
                </Banner>
              )}

              {isLoading && !product && (
                <Card>
                  <BlockStack gap="200" inlineAlign="center">
                    <Spinner accessibilityLabel="Loading product" size="large" />
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Loading product…
                    </Text>
                  </BlockStack>
                </Card>
              )}

              {!isLoading && !product && !loadError && (
                <Card>
                  <EmptyState heading="No product loaded" image="">
                    <p>
                      Paste a product URL above and click Load product to begin
                      editing its SEO.
                    </p>
                  </EmptyState>
                </Card>
              )}

              {product && (
                <SeoEditor
                  product={product}
                  saving={isSaving}
                  userErrors={userErrors}
                  onSave={handleSave}
                />
              )}
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <RecentEdits edits={recentEdits} onSelect={reloadFromHistory} />
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
