export const GET_COLLECTION_BY_HANDLE = `#graphql
  query GetCollectionByHandle($handle: String!) {
    collectionByHandle(handle: $handle) {
      id
      title
      handle
      image {
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

export const GET_COLLECTION_BY_ID = `#graphql
  query GetCollectionById($id: ID!) {
    collection(id: $id) {
      id
      title
      handle
      image {
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
