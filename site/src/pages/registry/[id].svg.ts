import { readFile } from "node:fs/promises";
import type { APIRoute, GetStaticPaths } from "astro";
import { registry } from "../../lib/data";

export const prerender = true;

export const getStaticPaths = (() => registry.map((entry) => ({ params: { id: entry.id }, props: { iconPath: entry.iconPath } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const bytes = await readFile((props as { iconPath: string }).iconPath);
  return new Response(bytes, { headers: { "Content-Type": "image/svg+xml" } });
};
