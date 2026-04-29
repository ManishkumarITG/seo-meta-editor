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
import { authenticate } from "../APIs/shopify.server.js";
import {
  GET_COLLECTION_BY_HANDLE,
  GET_COLLECTION_BY_ID,
} from "../APIs/graphql/getCollection.js";
import { UPDATE_COLLECTION_SEO } from "../APIs/graphql/updateCollectionSeo.js";
import {
  listRecentEditsForShop,
  recordEdit,
} from "../APIs/models/editHistory.server.js";
import {
  CollectionInputError,
  collectionGidFromId,
  collectionIdFromGid,
  parseCollectionInput,
} from "../utils/parseCollectionUrl.js";
import {
  COLLECTION_EDIT_TABS,
  ResourceEditTabs,
} from "../components/ResourceEditTabs.jsx";
import { SeoEditor } from "../components/SeoEditor";
import { RecentEdits } from "../components/RecentEdits";

const RECENT_EDITS_LIMIT = 10;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const records = await listRecentEditsForShop({
    shop: session.shop,
    resourceType: "collection",
    limit: RECENT_EDITS_LIMIT,
  });

  const recentEdits = records.map((record) => ({
    id: record.id,
    productId: record.productId,
    productTitle: record.productTitle,
    editedAt: record.editedAt.toISOString(),
  }));

  return { recentEdits };
};

// Normalize Shopify's collection.image into the `featuredImage` shape that
// the shared SeoEditor / save round-trip expect.
function normalizeCollection(collection) {
  if (!collection) return null;
  return {
    id: collection.id,
    title: collection.title,
    handle: collection.handle,
    featuredImage: collection.image
      ? { url: collection.image.url, altText: collection.image.altText ?? null }
      : null,
    seo: collection.seo,
  };
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "load") {
    const raw = String(formData.get("input") ?? "");
    let parsed;
    try {
      parsed = parseCollectionInput(raw);
    } catch (error) {
      const message =
        error instanceof CollectionInputError
          ? error.message
          : "Invalid collection input.";
      return { ok: false, intent: "load", message };
    }

    try {
      let collection = null;

      if (parsed.type === "handle") {
        const response = await admin.graphql(GET_COLLECTION_BY_HANDLE, {
          variables: { handle: parsed.value },
        });
        const json = await response.json();
        collection = json.data?.collectionByHandle ?? null;
      } else {
        const response = await admin.graphql(GET_COLLECTION_BY_ID, {
          variables: { id: collectionGidFromId(parsed.value) },
        });
        const json = await response.json();
        collection = json.data?.collection ?? null;
      }

      if (!collection) {
        return {
          ok: false,
          intent: "load",
          message: "Collection not found in this store.",
        };
      }

      return {
        ok: true,
        intent: "load",
        product: normalizeCollection(collection),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load collection.";
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
      const response = await admin.graphql(UPDATE_COLLECTION_SEO, {
        variables: {
          input: {
            id: productId,
            seo: { title: newTitle, description: newDescription },
          },
        },
      });
      const json = await response.json();

      const result = json.data?.collectionUpdate;
      const userErrors = result?.userErrors ?? [];
      const updatedSeo = result?.collection?.seo ?? {
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

      await recordEdit({
        shop: session.shop,
        resourceType: "collection",
        productId,
        productTitle,
        oldTitle,
        newTitle,
        oldDescription,
        newDescription,
      });

      return { ok: true, intent: "save", product: refreshedProduct };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save collection SEO.";
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

export default function CollectionsIndex() {
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
      setUrlError("Enter a collection URL, handle, or ID.");
      return;
    }
    try {
      parseCollectionInput(trimmed);
      setUrlError(undefined);
    } catch (error) {
      if (error instanceof CollectionInputError) {
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
    const id = collectionIdFromGid(edit.productId);
    setUrlInput(id);
    setUrlError(undefined);
    const fd = new FormData();
    fd.set("intent", "load");
    fd.set("input", id);
    loadFetcher.submit(fd, { method: "POST" });
  };

  const adminUrl = product
    ? `shopify:admin/collections/${collectionIdFromGid(product.id)}`
    : null;

  return (
    <Page title="Collection Editor">
      <TitleBar title="Collection Editor" />
      <BlockStack gap="500">
        <ResourceEditTabs tabs={COLLECTION_EDIT_TABS} activeTab="single" />
        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Load a collection
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Paste a collection URL, handle, or ID from your Shopify
                    storefront or admin.
                  </Text>
                  <TextField
                    label="Collection URL or handle"
                    labelHidden
                    value={urlInput}
                    onChange={(value) => {
                      setUrlInput(value);
                      if (urlError) setUrlError(undefined);
                    }}
                    autoComplete="off"
                    placeholder="https://your-store.myshopify.com/collections/summer-sale"
                    error={urlError}
                    onBlur={() => {
                      if (!urlInput.trim()) return;
                      try {
                        parseCollectionInput(urlInput);
                        setUrlError(undefined);
                      } catch (error) {
                        if (error instanceof CollectionInputError) {
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
                        Load collection
                      </Button>
                    }
                  />
                </BlockStack>
              </Card>

              {loadError && (
                <Banner
                  tone="critical"
                  title="Could not load collection"
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
                    <Spinner accessibilityLabel="Loading collection" size="large" />
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Loading collection…
                    </Text>
                  </BlockStack>
                </Card>
              )}

              {!isLoading && !product && !loadError && (
                <Card>
                  <EmptyState heading="No collection loaded" image="">
                    <p>
                      Paste a collection URL above and click Load collection to
                      begin editing its SEO.
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
                  adminUrl={adminUrl}
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
