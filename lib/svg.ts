import { XMLParser, XMLValidator } from "fast-xml-parser";

/**
 * Is this icon inert? (spec §5.2)
 *
 * An SVG is a document that can carry script, fetch other documents and restyle itself. The site only ever shows an
 * icon through <img>, where none of that runs, and serves the file under a policy that forbids it again. This check
 * is the third layer, and the only one that still holds if someone opens the file somewhere else.
 *
 * It is an ALLOWLIST. An element this file does not name is refused, so a new way to be dangerous that nobody has
 * thought of yet is refused too. The bytes are only ever parsed, never rendered.
 */
export const MAX_ICON_BYTES = 8 * 1024;

const SVG_NS = "http://www.w3.org/2000/svg";
// No <use>: a chain of them that each reference the last twice expands to 2^n shapes from a kilobyte of text, and
// an 8 KB icon has no need to reuse anything.
const ELEMENTS = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "title", "desc"]);
const LOCAL_REF = /^#[A-Za-z_][A-Za-z0-9_.-]*$/;
const LOCAL_URL = /url\(\s*(['"]?)#[A-Za-z_][A-Za-z0-9_.-]*\1\s*\)/gi;

type Node = Record<string, unknown>;

export function iconProblems(bytes: Uint8Array): string[] {
  if (bytes.byteLength === 0) return ["the icon is empty"];
  if (bytes.byteLength > MAX_ICON_BYTES) return [`the icon is ${bytes.byteLength} bytes; at most ${MAX_ICON_BYTES}`];

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return ["the icon is not UTF-8"];
  }

  const problems: string[] = [];
  // Refused on the raw text, before any parser gets to have an opinion about them.
  if (/<!DOCTYPE/i.test(text)) problems.push("a DOCTYPE is not allowed");
  if (/<!ENTITY/i.test(text)) problems.push("entity declarations are not allowed");
  if (/<!\[CDATA\[/i.test(text)) problems.push("CDATA sections are not allowed");
  if (/<\?(?!xml\s)/i.test(text) || text.lastIndexOf("<?") > 0) problems.push("processing instructions are not allowed");
  // A numeric character reference lets a value read one way here and another in a browser: `u&#114;l(` is `url(`.
  if (/&#/.test(text)) problems.push("numeric character references are not allowed");
  if (problems.length > 0) return problems;

  const wellFormed = XMLValidator.validate(text, { allowBooleanAttributes: false });
  if (wellFormed !== true) return [`the icon is not well-formed XML: ${wellFormed.err.msg}`];

  let roots: Node[];
  try {
    const parsed = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", processEntities: false, parseTagValue: false, parseAttributeValue: false, trimValues: false }).parse(text) as Node[];
    roots = parsed.filter((node) => !("?xml" in node) && !("#text" in node));
  } catch {
    return ["the icon could not be parsed"];
  }
  if (roots.length !== 1 || !("svg" in roots[0]!)) return ["the icon must have exactly one root element, <svg>"];
  if (attributesOf(roots[0]!).xmlns !== SVG_NS) return [`the root must declare xmlns="${SVG_NS}"`];

  walk(roots, problems);
  return [...new Set(problems)];
}

function attributesOf(node: Node): Record<string, string> {
  return (node[":@"] ?? {}) as Record<string, string>;
}

function walk(nodes: Node[], problems: string[]): void {
  for (const node of nodes) {
    const name = Object.keys(node).find((key) => key !== ":@");
    if (name === undefined || name === "#text") continue;
    if (!ELEMENTS.has(name)) {
      problems.push(`<${name.slice(0, 40)}> is not an allowed element`);
      continue;
    }
    for (const [attribute, raw] of Object.entries(attributesOf(node))) {
      const value = String(raw);
      const lower = attribute.toLowerCase();
      const local = lower.includes(":") ? lower.slice(lower.indexOf(":") + 1) : lower;
      if (lower.startsWith("on")) problems.push(`the ${attribute.slice(0, 40)} attribute is an event handler`);
      if (local === "href" && !LOCAL_REF.test(value.trim())) problems.push(`${attribute} may only point inside the same document (#id)`);
      if (local === "base" || local === "src" || local === "style") problems.push(`the ${attribute.slice(0, 40)} attribute is not allowed`);
      // A CSS escape spells a keyword this check looks for without containing it: `\75rl(` is `url(`. Presentation
      // attributes are parsed as CSS too, so no attribute value may carry a backslash at all.
      if (value.includes("\\")) problems.push(`the ${attribute.slice(0, 40)} attribute contains a backslash`);
      // Whitespace and controls are skipped by browsers inside a scheme name, so they are skipped here too.
      const squeezed = Array.from(value).filter((ch) => ch.codePointAt(0)! > 0x20).join("").toLowerCase();
      if (squeezed.includes("javascript:") || squeezed.includes("expression(") || squeezed.includes("@import")) problems.push(`the ${attribute.slice(0, 40)} attribute carries script or an import`);
      if (/url\(/i.test(value.replace(LOCAL_URL, ""))) problems.push(`url() in ${attribute.slice(0, 40)} may only point inside the same document (#id)`);
    }
    const children = node[name];
    if (Array.isArray(children)) walk(children as Node[], problems);
  }
}
