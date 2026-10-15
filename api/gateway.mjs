import { createGateway } from "../hosting/gateway.mjs";
// Vercel provides this platform-owned client IP. Never use this adapter on Azure.
// https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
export const getVercelClientIdentity = (request) =>
  request.headers.get("x-vercel-forwarded-for") || "unknown";
export default { fetch: createGateway(process.env, fetch, { getClientIdentity: getVercelClientIdentity }) };
