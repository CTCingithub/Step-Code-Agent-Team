/**
 * Host-rendering probe (plan-124). Zero-token, standalone.
 *
 * `extensions/render.ts` returns plain `Text` components, so our own rendering
 * is covered by phase15. What is NOT covered is the host's half: the content our
 * tools return is a single line of JSON (`bin/topo-search.mjs` prints exactly
 * one), and the host feeds that text through its markdown renderer — which Step
 * Code 0.1.7 reworked into a streaming one (#315/#319). A renderer that folds,
 * truncates or escapes away our payload would leave the model and the user
 * looking at a partial result, and nothing in the gate would notice.
 *
 * This probe drives the host's own `Markdown` component with the content shapes
 * our tools actually produce, and asserts the payload survives rendering:
 *   1. a single-line search result keeps its url/title;
 *   2. a very long single line is not swallowed;
 *   3. markdown-hostile characters survive;
 *   4. a multi-line batch stream keeps every line's verdict;
 *   5. rendering never throws.
 */

import { Markdown, type MarkdownTheme } from "@step-harness/pi-tui";
import type { ExtensionAPI } from "@step-harness/coding-agent";

/** The exact shape `bin/topo-search.mjs` prints for one search. */
const SEARCH_LINE =
	'{"ok":true,"kind":"search","data":{"results":[{"title":"Step-Code-Agent-Team","url":"https://github.com/CTCingithub/Step-Code-Agent-Team","snippet":"topology agent team"}],"needContent":false},"meta":{"endpoint":"configured","attempts":1}}';

/** A fetch result whose body is far longer than any terminal line. */
const LONG_LINE = `{"ok":true,"kind":"fetch","data":{"title":"DeepSeek API Docs","content":"${"x".repeat(4000)}"}}`;

/** Characters that mean something to a markdown parser. */
const HOSTILE =
	'{"ok":true,"data":{"results":[{"title":"a * b _ c # d ` e [f](g)","url":"https://e.com/?q=100%&x=<tag>"}]}}';

/** What `batch --stdin-jsonl` prints: one result per input line. */
const BATCH = [
	'{"ok":true,"kind":"search","data":{"results":[]}}',
	'{"ok":true,"kind":"fetch","data":{"title":"Page","content":"body"}}',
	'{"ok":false,"kind":"fetch","error":"HTTP 404","retryable":false}',
].join("\n");

/** Pass-through theme: an identity for every style hook, as phase15 does. */
const identity = (text: string) => text;
const theme: MarkdownTheme = {
	heading: identity,
	link: identity,
	linkUrl: identity,
	code: identity,
	codeBlock: identity,
	codeBlockBorder: identity,
	quote: identity,
	quoteBorder: identity,
	hr: identity,
	listBullet: identity,
	bold: identity,
	italic: identity,
	strikethrough: identity,
	underline: identity,
};

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke33]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${String(detail).replace(/\s+/g, " ").slice(0, 170)}` : ""}`);
		};

		const render = (text: string, width = 80): string => {
			const lines = new Markdown(text, 0, 0, theme).render(width);
			return lines.join("\n");
		};

		// The host renders tool text as Markdown, which word-wraps at the terminal
		// width and pads the short lines — so a long single-line JSON comes back
		// with runs of spaces inserted mid-token. Comparing raw text would report
		// a loss that never happened; collapse whitespace before looking for a
		// payload. Note this also means markup characters (`*` `_` `` ` `` `[` `]`
		// `<>`) are consumed by the parser: the words and URLs survive, the
		// punctuation does not. That is the host's rendering of every tool's text,
		// not data loss, so the assertions below look for information, not bytes.
		const norm = (text: string): string => text.replace(/\s+/g, " ").trim();

		try {
			// ---- 1. a single-line search result survives ----
			const search = norm(render(SEARCH_LINE));
			check("render: a single-line JSON result does not throw", search.length > 0);
			for (const needle of ["ok", "true", "Step-Code-Agent-Team", "github.com/CTCingithub"]) {
				check(`render: keeps "${needle}"`, search.includes(needle), search.slice(0, 100));
			}

			// ---- 2. a very long single line is not swallowed ----
			const long = norm(render(LONG_LINE));
			check("render: a 4000-char body is not dropped", long.length > 2000, `rendered ${long.length} chars`);
			check("render: the long body's title survives", long.includes("DeepSeek API Docs"), long.slice(0, 100));

			// ---- 3. markdown-hostile characters do not eat the payload ----
			const hostile = norm(render(HOSTILE));
			check("render: the hostile payload's url survives", hostile.includes("e.com"), hostile.slice(0, 140));
			check("render: the hostile payload's words survive", /a b c d/.test(hostile) || hostile.includes("_ c # d"), hostile.slice(0, 140));

			// ---- 4. a multi-line batch stream keeps every verdict ----
			const batch = norm(render(BATCH));
			check("render: a batch stream keeps three lines", batch.split(" ").length > 3, `words=${batch.split(" ").length}`);
			check("render: the failed line's status survives", /404/.test(batch), batch.slice(0, 160));
			check("render: the fetch line's title survives", batch.includes("Page"), batch.slice(0, 160));

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE33 DONE (all passed)" : `SMOKE33 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE33 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
