import { describe, expect, it } from "vitest";
import { iconProblems } from "../lib/svg";

const bytes = (text: string) => new TextEncoder().encode(text);
const svg = (inner: string, attrs = "") => bytes(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${attrs}>${inner}</svg>`);

describe("iconProblems", () => {
  it.each([
    ["a plain icon", svg('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>')],
    ["an XML declaration", bytes('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')],
    ["a same-document reference", svg('<defs><path id="a" d="M0 0"/></defs><use href="#a"/>')],
    ["a gradient", svg('<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="4" height="4" fill="#000"/>')],
    ["a title", svg("<title>Your Protocol</title><path d='M0 0'/>")],
  ])("accepts %s", (_name, input) => {
    expect(iconProblems(input)).toEqual([]);
  });

  it.each([
    ["a script element", svg("<script>alert(1)</script>")],
    ["a script element in another case", svg("<SCRIPT>alert(1)</SCRIPT>")],
    ["foreignObject", svg("<foreignObject><body/></foreignObject>")],
    ["an iframe", svg('<iframe src="https://x"/>')],
    ["an image", svg('<image href="https://x/a.png"/>')],
    ["an anchor", svg('<a href="https://x"><path d="M0 0"/></a>')],
    ["an animation that sets an attribute", svg('<set attributeName="href" to="javascript:alert(1)"/>')],
    ["an event handler", svg('<path d="M0 0" onclick="alert(1)"/>')],
    ["an event handler on the root", svg("", 'onload="alert(1)"')],
    ["an event handler in another case", svg('<path d="M0 0" ONLOAD="alert(1)"/>')],
    ["an external use", svg('<use href="https://x/a.svg#a"/>')],
    ["an external xlink:href", svg('<use xlink:href="//x/a.svg#a"/>')],
    ["a data: href", svg('<use href="data:image/svg+xml,&lt;svg/&gt;"/>')],
    ["a style element", svg("<style>path{fill:red}</style>")],
    ["a style attribute with url()", svg('<path d="M0 0" style="fill:url(https://x)"/>')],
    ["a presentation attribute with an external url()", svg('<path d="M0 0" fill="url(https://x/a.svg#g)"/>')],
    ["a style attribute with @import", svg('<path d="M0 0" style="@import \'https://x\'"/>')],
    ["a javascript: value anywhere", svg('<path d="M0 0" fill="javascript:alert(1)"/>')],
    ["a DOCTYPE", bytes('<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>')],
    ["an entity declaration", bytes('<!ENTITY x "y"><svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["a processing instruction", bytes('<?xml-stylesheet href="https://x/a.css"?><svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["a CDATA section", svg("<title><![CDATA[<script>alert(1)</script>]]></title>")],
    ["text that is not XML", bytes("not an svg")],
    ["two roots", bytes('<svg xmlns="http://www.w3.org/2000/svg"/><svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["a root that is not svg", bytes('<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>')],
    ["a missing SVG namespace", bytes("<svg><path d='M0 0'/></svg>")],
    ["more than 8 KB", svg(`<path d="${"M0 0".repeat(3000)}"/>`)],
    ["a UTF-16 byte order mark", new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x73, 0x00])],
    ["bytes that are not UTF-8", new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0xc3, 0x28, 0x3e])],
    ["nothing", new Uint8Array()],
  ])("refuses %s", (_name, input) => {
    expect(iconProblems(input).length).toBeGreaterThan(0);
  });

  it("allows a url() only when it points inside the same document", () => {
    expect(iconProblems(svg('<defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><rect width="4" height="4" fill="url(#g)"/>'))).toEqual([]);
  });
});
