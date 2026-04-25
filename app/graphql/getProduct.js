export const GET_PRODUCT_BY_HANDLE = `#graphql
  query GetProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      title
      handle
      featuredImage {
        url
        altText
      }
      seo {
        title
        description
      }
    }
  }
`;

export const GET_PRODUCT_BY_ID = `#graphql
  query GetProductById($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      featuredImage {
        url
        altText
      }
      seo {
        title
        description
      }
    }
  }
`;
