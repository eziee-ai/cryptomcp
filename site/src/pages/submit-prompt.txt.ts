import type { APIRoute } from "astro";
import { AGENT_PROMPT } from "../lib/agentPrompt";

/**
 * The same prompt /submit copies, as a file: for a page with scripts off, and for an agent told to fetch it.
 * Built to a static file, so the host picks text/plain from the .txt name; a header set here would be thrown away.
 */
export const GET: APIRoute = () => new Response(AGENT_PROMPT);
