import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ProductInputError,
  parseProductInput,
  productGidFromId,
  productIdFromGid,
} from "../parseProductUrl.js";

describe("parseProductInput", () => {
  it("parses a storefront product URL by handle", () => {
    const result = parseProductInput(
      "https://example-store.myshopify.com/products/cool-shirt",
    );
    assert.deepEqual(result, { type: "handle", value: "cool-shirt" });
  });

  it("parses a storefront URL with trailing slash and query string", () => {
    const result = parseProductInput(
      "https://example-store.myshopify.com/products/cool-shirt/?variant=123",
    );
    assert.deepEqual(result, { type: "handle", value: "cool-shirt" });
  });

  it("parses an admin product URL by numeric ID", () => {
    const result = parseProductInput(
      "https://example-store.myshopify.com/admin/products/1234567890",
    );
    assert.deepEqual(result, { type: "id", value: "1234567890" });
  });

  it("parses a custom-domain storefront URL", () => {
    const result = parseProductInput(
      "https://shop.example.com/products/some-handle",
    );
    assert.deepEqual(result, { type: "handle", value: "some-handle" });
  });

  it("parses a bare handle string", () => {
    const result = parseProductInput("cool-shirt");
    assert.deepEqual(result, { type: "handle", value: "cool-shirt" });
  });

  it("parses a bare numeric ID", () => {
    const result = parseProductInput("9876543210");
    assert.deepEqual(result, { type: "id", value: "9876543210" });
  });

  it("parses a Shopify GID", () => {
    const result = parseProductInput("gid://shopify/Product/9876543210");
    assert.deepEqual(result, { type: "id", value: "9876543210" });
  });

  it("trims whitespace before parsing", () => {
    const result = parseProductInput("  cool-shirt  ");
    assert.deepEqual(result, { type: "handle", value: "cool-shirt" });
  });

  it("rejects empty input", () => {
    assert.throws(() => parseProductInput(""), ProductInputError);
    assert.throws(() => parseProductInput("   "), ProductInputError);
  });

  it("rejects an admin URL with a non-numeric segment", () => {
    assert.throws(
      () =>
        parseProductInput(
          "https://example-store.myshopify.com/admin/products/not-a-number",
        ),
      ProductInputError,
    );
  });

  it("rejects a non-product URL", () => {
    assert.throws(
      () => parseProductInput("https://example.com/collections/all"),
      ProductInputError,
    );
  });

  it("rejects garbage input", () => {
    assert.throws(
      () => parseProductInput("hello world!"),
      ProductInputError,
    );
  });
});

describe("productGidFromId / productIdFromGid", () => {
  it("round-trips an ID through a GID", () => {
    const gid = productGidFromId("123");
    assert.equal(gid, "gid://shopify/Product/123");
    assert.equal(productIdFromGid(gid), "123");
  });
});
