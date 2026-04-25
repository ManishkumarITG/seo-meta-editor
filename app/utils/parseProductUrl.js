const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const NUMERIC_ID_PATTERN = /^\d+$/;

export class ProductInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductInputError";
  }
}

export function parseProductInput(raw) {
  const input = raw.trim();
  if (!input) {
    throw new ProductInputError("Enter a product URL, handle, or ID.");
  }

  if (NUMERIC_ID_PATTERN.test(input)) {
    return { type: "id", value: input };
  }

  if (input.startsWith("gid://shopify/Product/")) {
    const id = input.slice("gid://shopify/Product/".length);
    if (!NUMERIC_ID_PATTERN.test(id)) {
      throw new ProductInputError("Invalid Shopify product GID.");
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
      const productsIdx = segments.indexOf("products", adminIdx);
      if (productsIdx !== -1 && productsIdx + 1 < segments.length) {
        const candidate = segments[productsIdx + 1];
        if (NUMERIC_ID_PATTERN.test(candidate)) {
          return { type: "id", value: candidate };
        }
      }
      throw new ProductInputError(
        "Couldn't read a product ID from that admin URL.",
      );
    }

    const productsIdx = segments.indexOf("products");
    if (productsIdx !== -1 && productsIdx + 1 < segments.length) {
      const candidate = segments[productsIdx + 1];
      if (HANDLE_PATTERN.test(candidate)) {
        return { type: "handle", value: candidate };
      }
      throw new ProductInputError(
        "Product handle in URL is not a valid handle.",
      );
    }

    throw new ProductInputError(
      "URL doesn't look like a Shopify product URL.",
    );
  }

  if (HANDLE_PATTERN.test(input)) {
    return { type: "handle", value: input };
  }

  throw new ProductInputError(
    "Couldn't recognize that input. Paste a product URL, handle, or numeric ID.",
  );
}

export function productGidFromId(id) {
  return `gid://shopify/Product/${id}`;
}

export function productIdFromGid(gid) {
  return gid.replace("gid://shopify/Product/", "");
}
