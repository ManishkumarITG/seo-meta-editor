export const UPDATE_COLLECTION_SEO = `#graphql
  mutation UpdateCollectionSEO($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        seo {
          title
          description
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;
