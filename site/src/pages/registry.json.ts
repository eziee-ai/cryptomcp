import type { APIRoute } from "astro";
import { registry, toRegistryJson } from "../lib/data";

export const prerender = true;

export const GET: APIRoute = () => {
  const body = JSON.stringify(registry.map(toRegistryJson));
  return new Response(body, { headers: { "Content-Type": "application/json" } });
};
