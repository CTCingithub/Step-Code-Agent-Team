/**
 * Newline-delimited framing shared by both ends of the team wire protocol.
 *
 * The leader's socket server and a member's stdout both arrive as arbitrary
 * chunks, so both had the same six-line "pull whole lines out of a growing
 * buffer" loop. Two copies of protocol framing means a change to the framing has
 * to be remembered in two places, which is exactly how the two ends drift apart.
 */

/** Splits a growing buffer into complete lines plus the trailing partial. */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
	const lines: string[] = [];
	let idx: number;
	while ((idx = buffer.indexOf("\n")) >= 0) {
		lines.push(buffer.slice(0, idx).replace(/\r$/, ""));
		buffer = buffer.slice(idx + 1);
	}
	return { lines, rest: buffer };
}
