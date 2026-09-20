import type { APIRoute } from "astro";
import { AGENT_PROMPT } from "../lib/agentPrompt";

/** The same prompt /submit copies, as a file: for a page with scripts off, and for an agent told to fetch it. */
export const GET: APIRoute = () => new Response(AGENT_PROMPT, { headers: { "content-type": "text/plain; charset=utf-8" } });
