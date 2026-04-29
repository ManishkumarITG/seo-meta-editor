const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const NUMERIC_ID_PATTERN = /^\d+$/;

export class CollectionInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "CollectionInputError";
  }
}

export function parseCollectionInput(raw) {
  const input = raw.trim();
  if (!input) {
    throw new CollectionInputError("Enter a collection URL, handle, or ID.");
  }

  if (NUMERIC_ID_PATTERN.test(input)) {
    return { type: "id", value: input };
  }

  if (input.startsWith("gid://shopify/Collection/")) {
    const id = input.slice("gid://shopify/Collection/".length);
    if (!NUMERIC_ID_PATTERN.test(id)) {
      throw new CollectionInputError("Invalid Shopify collection GID.");
    }
    return { type: "id", value: id };
  }

  let url = null;
  try {
    url = new URL(input);
  } catch {
    url = null;
  }

  if (url) {
    const segments = url.pathname.split("/").filter(Boolean);

    const adminIdx = segments.indexOf("admin");
    if (adminIdx !== -1) {
      const collectionsIdx = segments.indexOf("collections", adminIdx);
      if (collectionsIdx !== -1 && collectionsIdx + 1 < segments.length) {
        const candidate = segments[collectionsIdx + 1];
        if (NUMERIC_ID_PATTERN.test(candidate)) {
          return { type: "id", value: candidate };
        }
      }
      throw new CollectionInputError(
        "Couldn't read a collection ID from that admin URL.",
      );
    }

    const collectionsIdx = segments.indexOf("collections");
    if (collectionsIdx !== -1 && collectionsIdx + 1 < segments.length) {
      const candidate = segments[collectionsIdx + 1];
      if (HANDLE_PATTERN.test(candidate)) {
        return { type: "handle", value: candidate };
      }
      throw new CollectionInputError(
        "Collection handle in URL is not a valid handle.",
      );
    }

    throw new CollectionInputError(
      "URL doesn't look like a Shopify collection URL.",
    );
  }

  if (HANDLE_PATTERN.test(input)) {
    return { type: "handle", value: input };
  }

  throw new CollectionInputError(
    "Couldn't recognize that input. Paste a collection URL, handle, or numeric ID.",
  );
}

export function collectionGidFromId(id) {
  return `gid://shopify/Collection/${id}`;
}

export function collectionIdFromGid(gid) {
  return gid.replace("gid://shopify/Collection/", "");
}
