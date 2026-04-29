import { authenticate } from "../APIs/shopify.server.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};
