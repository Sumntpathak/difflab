/* DiffLab diff engine
 *
 * Strategy (matches what git + GitHub actually do):
 *   1. Tokenize both inputs into lines.
 *   2. Run diff-match-patch in *line mode* to get a sequence of
 *      EQUAL / INSERT / DELETE operations on whole lines.
 *   3. Walk the op stream and pair adjacent DELETE+INSERT runs into
 *      "changed line pairs" — for each pair, run a second char-level
 *      diff so we can highlight word-level changes inside the line.
 *   4. Group the resulting rows into "hunks" separated by long runs
 *      of equal context (collapsed with hunk headers à la `git diff`).
 */

(function (global) {
  "use strict";

  const dmp = new diff_match_patch();
  // Tighten the timeout — we render synchronously and want snappy results.
  dmp.Diff_Timeout = 2.0;

  // ---------- public API ----------

  function computeDiff(leftText, rightText, opts) {
    opts = opts || {};
    const ignoreWs = !!opts.ignoreWhitespace;
    const contextLines = opts.contextLines == null ? 3 : opts.contextLines;

    // Normalize line endings so CRLF/LF mismatches don't show up as diffs.
    const left = (leftText || "").replace(/\r\n?/g, "\n");
    const right = (rightText || "").replace(/\r\n?/g, "\n");

    // Optionally collapse all runs of whitespace before comparing.
    // We diff on the normalized version but display the original text.
    const leftCmp = ignoreWs ? normalizeWs(left) : left;
    const rightCmp = ignoreWs ? normalizeWs(right) : right;

    const leftLines = splitLines(left);
    const rightLines = splitLines(right);
    const leftCmpLines = ignoreWs ? splitLines(leftCmp) : leftLines;
    const rightCmpLines = ignoreWs ? splitLines(rightCmp) : rightLines;

    // diff-match-patch trick for line-level diffs: replace each unique
    // line with a single-char surrogate, run a normal char diff, then
    // expand back to lines.
    const lineDiff = lineModeDiff(leftCmpLines, rightCmpLines);

    // Walk the line ops and emit display rows.
    // Each row: { type: 'eq'|'add'|'del'|'mod', leftNo, rightNo, leftText, rightText, leftSegs?, rightSegs? }
    const rows = buildRows(lineDiff, leftLines, rightLines);

    // Group into hunks with limited context.
    const hunks = buildHunks(rows, contextLines);

    // Aggregate stats.
    let additions = 0, deletions = 0;
    for (const r of rows) {
      if (r.type === "add") additions++;
      else if (r.type === "del") deletions++;
      else if (r.type === "mod") { additions++; deletions++; }
    }

    return {
      rows,
      hunks,
      stats: { additions, deletions, hunkCount: hunks.length, totalRows: rows.length }
    };
  }

  // ---------- line-mode diff ----------

  function lineModeDiff(leftLines, rightLines) {
    // Build a string of surrogate chars, one per line, using a shared dictionary.
    const dict = new Map();
    let nextCode = 1; // start at 1 to avoid \0

    function encode(lines) {
      let out = "";
      for (const line of lines) {
        let code = dict.get(line);
        if (code === undefined) {
          code = nextCode++;
          dict.set(line, code);
        }
        out += String.fromCharCode(code);
      }
      return out;
    }

    const a = encode(leftLines);
    const b = encode(rightLines);
    const diffs = dmp.diff_main(a, b, false);
    // Skip semantic cleanup — we want raw line-level granularity.

    // Re-expand to (op, lineCount) pairs while preserving order.
    // We don't actually need the line text from the surrogates — we'll
    // index back into leftLines/rightLines as we walk.
    const result = [];
    for (const [op, chunk] of diffs) {
      result.push([op, chunk.length]);
    }
    return result;
  }

  // ---------- row construction ----------

  function buildRows(lineOps, leftLines, rightLines) {
    const rows = [];
    let li = 0, ri = 0;

    // We process ops in order, but when a DELETE is immediately followed
    // by an INSERT we pair them up into "modified" rows so we can show
    // intra-line word diffs (like git --word-diff).
    for (let i = 0; i < lineOps.length; i++) {
      const [op, count] = lineOps[i];

      if (op === DIFF_EQUAL) {
        for (let k = 0; k < count; k++) {
          rows.push({
            type: "eq",
            leftNo: li + 1,
            rightNo: ri + 1,
            leftText: leftLines[li],
            rightText: rightLines[ri]
          });
          li++; ri++;
        }
      } else if (op === DIFF_DELETE) {
        const next = lineOps[i + 1];
        if (next && next[0] === DIFF_INSERT) {
          // Pair as modifications, line-by-line, up to the shorter run.
          const delCount = count;
          const insCount = next[1];
          const pairCount = Math.min(delCount, insCount);

          for (let k = 0; k < pairCount; k++) {
            const lText = leftLines[li];
            const rText = rightLines[ri];
            const { leftSegs, rightSegs } = wordDiff(lText, rText);
            rows.push({
              type: "mod",
              leftNo: li + 1,
              rightNo: ri + 1,
              leftText: lText,
              rightText: rText,
              leftSegs,
              rightSegs
            });
            li++; ri++;
          }
          // Remaining unpaired deletes:
          for (let k = pairCount; k < delCount; k++) {
            rows.push({
              type: "del",
              leftNo: li + 1, rightNo: null,
              leftText: leftLines[li], rightText: null
            });
            li++;
          }
          // Remaining unpaired inserts:
          for (let k = pairCount; k < insCount; k++) {
            rows.push({
              type: "add",
              leftNo: null, rightNo: ri + 1,
              leftText: null, rightText: rightLines[ri]
            });
            ri++;
          }
          i++; // consume the paired INSERT
        } else {
          for (let k = 0; k < count; k++) {
            rows.push({
              type: "del",
              leftNo: li + 1, rightNo: null,
              leftText: leftLines[li], rightText: null
            });
            li++;
          }
        }
      } else if (op === DIFF_INSERT) {
        for (let k = 0; k < count; k++) {
          rows.push({
            type: "add",
            leftNo: null, rightNo: ri + 1,
            leftText: null, rightText: rightLines[ri]
          });
          ri++;
        }
      }
    }
    return rows;
  }

  // ---------- intra-line word diff ----------
  //
  // For a pair of "this line was modified" texts, return arrays of segments:
  //   [{ op: 'eq'|'del', text }, ...] for the left side
  //   [{ op: 'eq'|'add', text }, ...] for the right side
  // We do a char-level diff then group consecutive same-op chars.

  function wordDiff(leftLine, rightLine) {
    const diffs = dmp.diff_main(leftLine, rightLine);
    dmp.diff_cleanupSemantic(diffs);

    const leftSegs = [];
    const rightSegs = [];
    for (const [op, text] of diffs) {
      if (op === DIFF_EQUAL) {
        leftSegs.push({ op: "eq", text });
        rightSegs.push({ op: "eq", text });
      } else if (op === DIFF_DELETE) {
        leftSegs.push({ op: "del", text });
      } else if (op === DIFF_INSERT) {
        rightSegs.push({ op: "add", text });
      }
    }
    return { leftSegs, rightSegs };
  }

  // ---------- hunk grouping ----------

  function buildHunks(rows, contextLines) {
    if (rows.length === 0) return [];

    // Mark each row as "interesting" if it's a change.
    const isChange = rows.map(r => r.type !== "eq");

    // If nothing is a change, return a single empty hunk list (caller handles it).
    if (!isChange.some(Boolean)) return [];

    // Sweep and create hunks: any change row, plus `contextLines` of equal
    // rows on either side. Adjacent runs that overlap are merged.
    const hunks = [];
    let i = 0;
    const n = rows.length;
    while (i < n) {
      if (!isChange[i]) { i++; continue; }

      // Found a change. Walk back contextLines for the start.
      let start = Math.max(0, i - contextLines);
      // Walk forward until we've seen `contextLines` equal rows in a row.
      let j = i;
      let trailingEq = 0;
      while (j < n) {
        if (isChange[j]) {
          trailingEq = 0;
        } else {
          trailingEq++;
          if (trailingEq > contextLines) break;
        }
        j++;
      }
      // End the hunk at j (exclusive). Trim back the extra trailing eq we counted.
      let end = Math.min(n, j);
      // If the previous hunk overlaps, merge.
      if (hunks.length > 0 && hunks[hunks.length - 1].end >= start) {
        hunks[hunks.length - 1].end = end;
      } else {
        hunks.push({ start, end });
      }
      i = end;
    }

    // Annotate each hunk with the line-number range for the header.
    return hunks.map(h => {
      const slice = rows.slice(h.start, h.end);
      const leftStart = firstNonNull(slice.map(r => r.leftNo));
      const rightStart = firstNonNull(slice.map(r => r.rightNo));
      const leftEnd = lastNonNull(slice.map(r => r.leftNo));
      const rightEnd = lastNonNull(slice.map(r => r.rightNo));
      return {
        start: h.start,
        end: h.end,
        leftStart, leftEnd,
        rightStart, rightEnd,
        header: formatHunkHeader(leftStart, leftEnd, rightStart, rightEnd)
      };
    });
  }

  function formatHunkHeader(ls, le, rs, re) {
    const lLen = (ls != null && le != null) ? (le - ls + 1) : 0;
    const rLen = (rs != null && re != null) ? (re - rs + 1) : 0;
    const lPart = ls != null ? `-${ls},${lLen}` : "-0,0";
    const rPart = rs != null ? `+${rs},${rLen}` : "+0,0";
    return `@@ ${lPart} ${rPart} @@`;
  }

  // ---------- patch (unified diff) export ----------

  function toUnifiedPatch(diffResult, leftName, rightName) {
    leftName = leftName || "original";
    rightName = rightName || "modified";
    const lines = [];
    lines.push(`--- ${leftName}`);
    lines.push(`+++ ${rightName}`);
    for (const h of diffResult.hunks) {
      lines.push(h.header);
      for (let i = h.start; i < h.end; i++) {
        const r = diffResult.rows[i];
        if (r.type === "eq") {
          lines.push(" " + r.leftText);
        } else if (r.type === "del") {
          lines.push("-" + r.leftText);
        } else if (r.type === "add") {
          lines.push("+" + r.rightText);
        } else if (r.type === "mod") {
          lines.push("-" + r.leftText);
          lines.push("+" + r.rightText);
        }
      }
    }
    return lines.join("\n") + "\n";
  }

  // ---------- helpers ----------

  function splitLines(text) {
    if (text === "") return [];
    // Preserve trailing empty line if text ends with \n? Standard diff
    // tools treat the final newline as a terminator, not a separate line.
    // We split, then drop a trailing "" if the text ended with \n.
    const parts = text.split("\n");
    if (parts[parts.length - 1] === "" && text.endsWith("\n")) parts.pop();
    return parts;
  }

  function normalizeWs(text) {
    // Collapse runs of whitespace within each line and trim line ends.
    // We keep \n boundaries so line counts still align.
    return text
      .split("\n")
      .map(l => l.replace(/[ \t\f\v]+/g, " ").replace(/\s+$/g, ""))
      .join("\n");
  }

  function firstNonNull(arr) {
    for (const v of arr) if (v != null) return v;
    return null;
  }
  function lastNonNull(arr) {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
    return null;
  }

  // ---------- expose ----------

  global.DiffLabEngine = {
    computeDiff,
    toUnifiedPatch
  };
})(window);
