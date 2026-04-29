import {
  GET_PRODUCT_BY_HANDLE,
  GET_PRODUCT_BY_ID,
} from "../graphql/getProduct.js";
import { UPDATE_PRODUCT_SEO } from "../graphql/updateProductSeo.js";
import {
  GET_COLLECTION_BY_HANDLE,
  GET_COLLECTION_BY_ID,
} from "../graphql/getCollection.js";
import { UPDATE_COLLECTION_SEO } from "../graphql/updateCollectionSeo.js";
import {
  ProductInputError,
  parseProductInput,
  productGidFromId,
} from "../../utils/parseProductUrl.js";
import {
  CollectionInputError,
  collectionGidFromId,
  parseCollectionInput,
} from "../../utils/parseCollectionUrl.js";

// Single source of truth for resource-specific bits used across the bulk
// pipeline (parser, processor, recovery, routes). Adding a new resource type
// means adding one entry here and a few thin wiring changes in the routes —
// the rest of the backend already routes by adapter.
const ADAPTERS = {
  product: {
    type: "product",
    label: "product",
    pluralLabel: "products",
    parseInput: parseProductInput,
    InputError: ProductInputError,
    gidFromId: productGidFromId,
    getByHandleQuery: GET_PRODUCT_BY_HANDLE,
    getByIdQuery: GET_PRODUCT_BY_ID,
    updateMutation: UPDATE_PRODUCT_SEO,
    byHandleDataKey: "productByHandle",
    byIdDataKey: "product",
    mutationDataKey: "productUpdate",
    urlColumnKeys: ["product_url", "product url", "url", "producturl"],
    primaryUrlColumnHeader: "product_url",
    storefrontPathSegment: "products",
  },
  collection: {
    type: "collection",
    label: "collection",
    pluralLabel: "collections",
    parseInput: parseCollectionInput,
    InputError: CollectionInputError,
    gidFromId: collectionGidFromId,
    getByHandleQuery: GET_COLLECTION_BY_HANDLE,
    getByIdQuery: GET_COLLECTION_BY_ID,
    updateMutation: UPDATE_COLLECTION_SEO,
    byHandleDataKey: "collectionByHandle",
    byIdDataKey: "collection",
    mutationDataKey: "collectionUpdate",
    urlColumnKeys: [
      "collection_url",
      "collection url",
      "url",
      "collectionurl",
    ],
    primaryUrlColumnHeader: "collection_url",
    storefrontPathSegment: "collections",
  },
};

export const SUPPORTED_RESOURCE_TYPES = Object.keys(ADAPTERS);

export function getResourceAdapter(resourceType) {
  const adapter = ADAPTERS[resourceType];
  if (!adapter) {
    throw new Error(
      `Unsupported resourceType "${resourceType}". Expected one of: ${SUPPORTED_RESOURCE_TYPES.join(", ")}`,
    );
  }
  return adapter;
}

export function normalizeResourceType(input) {
  if (typeof input !== "string") return "product";
  const normalized = input.trim().toLowerCase();
  return SUPPORTED_RESOURCE_TYPES.includes(normalized)
    ? normalized
    : "product";
}
