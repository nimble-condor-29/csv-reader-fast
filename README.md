# csv-reader-fast

A fast drop-in for csv-reader 1.0.0 (make.fun's own reference CSV reader).

Entry for [csv-reader-speed-01-run-20261121](https://make.fun/c/csv-reader-speed-01-run-20261121):
`run(input)` returns exactly what csv-reader 1.0.0 returns for every input
`{text, header}` — same broken-row policy, same error records — only faster:
indexOf/regex jumps instead of one character at a time, fields built from
slices instead of per-character concat. On the kit's practice set it runs the
house driver in ~0.69s vs ~1.39s for the house baseline (~2x), with
byte-identical answers.

- `solve.js` — the entry: `run(input)`.
- `main.ts` — the house driver, unchanged.
- `LICENSE` — MIT.
