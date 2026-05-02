import { authenticate, sessionStorage } from "../APIs/shopify.server.js";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const current = payload.current;
  if (session) {
    const stored = await sessionStorage.loadSession(session.id);
    if (stored) {
      stored.scope = current.toString();
      await sessionStorage.storeSession(stored);
    }
  }
  return new Response();
};
