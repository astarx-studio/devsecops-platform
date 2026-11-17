import path from 'node:path';

// Finds code around the change that the diff alone doesn't show: other uses
// of the symbols the change defines or edits, files that import the changed
// files, and sibling files. This is what lets the review judge whether the
// change breaks existing behavior beyond the lines it touches.

const KEYWORDS = new Set(
  'if else for while return function const let var class new this true false null undefined async await import export from default switch case break continue try catch finally throw typeof instanceof delete void yield static public private protected readonly interface type enum extends implements super get set def self None True False select from where insert update delete create table begin end and or not into values join left right inner outer order group by limit offset with as on is in'.split(' '),
);

const DECL = [
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/g,
  /\bclass\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  /\bdef\s+([A-Za-z_]\w*)/g,
  /^\s*(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[\w<>[\]|, ]+)?\s*\{/gm,
  /\bcreate\s+(?:or\s+replace\s+)?(?:function|view|table|trigger)\s+(?:if\s+not\s+exists\s+)?(?:[\w"]+\.)?"?([A-Za-z_]\w*)/gi,
  /\b(?:export\s+)?(?:const|let)\s+([A-Z][A-Z0-9_]{2,})\s*=/g,
];

function usable(name) {
  return name && name.length >= 3 && !KEYWORDS.has(name.toLowerCase()) && !/^\d/.test(name);
}

function declsIn(text) {
  const names = [];
  for (const re of DECL) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) names.push(m[1]);
  }
  return names;
}

// The declaration enclosing each changed hunk, found by scanning the head
// file upward from the first changed line. The hunk header can't name it when
// the edit is near the top of the function.
export async function enclosingSymbols({ repo, headSha, files, maxFiles = 10, scanLines = 80 }) {
  const out = [];
  for (const f of files.filter((x) => !x.deleted).slice(0, maxFiles)) {
    const added = [...f.newLines.entries()].filter(([, v]) => v.type === 'added').map(([n]) => n);
    if (!added.length) continue;
    let lines;
    try {
      lines = (await repo.readLines(headSha, f.newPath, 1, 1_000_000)).lines;
    } catch {
      continue;
    }
    const starts = [...new Set(added.filter((n) => !added.includes(n - 1)))].slice(0, 10);
    for (const start of starts) {
      for (let i = start - 1; i >= Math.max(0, start - scanLines); i--) {
        const names = declsIn(lines[i] ?? '').filter(usable);
        if (names.length) {
          out.push(names[0]);
          break;
        }
      }
    }
  }
  return out;
}

// Symbols the change defines or edits, most specific first.
export function changedSymbols(files, max, enclosing = []) {
  const seen = new Map();
  const add = (name, weight) => {
    if (!usable(name)) return;
    seen.set(name, (seen.get(name) ?? 0) + weight);
  };
  for (const name of enclosing) add(name, 2);
  for (const f of files) {
    for (const h of f.hunks) {
      for (const re of DECL) {
        for (const text of [...h.added, ...h.removed]) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(text))) add(m[1], 3);
        }
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(h.context))) add(m[1], 1);
      }
    }
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([n]) => n);
}

function moduleStem(p) {
  const base = path.posix.basename(p).replace(/\.(d\.ts|[cm]?[jt]sx?|vue|svelte|py)$/, '');
  return base === 'index' || base === '__init__' ? path.posix.basename(path.posix.dirname(p)) : base;
}

// Returns { text, symbols } for the prompt. `repo` is a Repo; reads only git objects.
export async function gatherRelated({ repo, headSha, files, cfg }) {
  const c = cfg.context;
  if (!c.related_code) return { text: '', symbols: [] };
  const changed = new Set(files.map((f) => f.newPath));
  const out = [];
  const enclosing = await enclosingSymbols({ repo, headSha, files });
  const symbols = changedSymbols(files, c.max_symbols, enclosing);

  for (const sym of symbols) {
    const g = await repo.grep(headSha, sym, '', 200, { word: true, fixed: true }).catch(() => ({ hits: [], total: 0 }));
    // Uses outside the changed hunks are what can break.
    const hits = g.hits.filter((h) => {
      const [file, ln] = h.split(':');
      const f = files.find((x) => x.newPath === file);
      return !f || f.newLines.get(Number(ln))?.type !== 'added';
    });
    if (!hits.length) continue;
    const shown = hits.slice(0, c.max_hits_per_symbol);
    out.push(`Uses of \`${sym}\` outside the changed lines (${hits.length}${hits.length > shown.length ? `, first ${shown.length}` : ''}):\n${shown.join('\n')}`);
  }

  const stems = [...new Set([...changed].map(moduleStem).filter((s) => s.length >= 3))].slice(0, 6);
  for (const stem of stems) {
    const re = `(from|require\\(|import\\()[[:space:]]*['"][^'"]*[/'"]${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.[a-z]+)?['"]`;
    const g = await repo.grep(headSha, re, '', 50).catch(() => ({ hits: [] }));
    const importers = g.hits.filter((h) => !changed.has(h.split(':')[0])).slice(0, c.max_hits_per_symbol);
    if (importers.length) out.push(`Files importing \`${stem}\`:\n${importers.join('\n')}`);
  }

  if (c.list_sibling_files) {
    const dirs = [...new Set([...changed].map((p) => path.posix.dirname(p)))].slice(0, 5);
    for (const d of dirs) {
      const names = await repo.listDir(headSha, d).catch(() => []);
      const others = names.filter((n) => !changed.has(d === '.' ? n : `${d}/${n}`)).slice(0, 25);
      if (others.length) out.push(`Sibling files in \`${d}/\`: ${others.map((n) => `\`${n}\``).join(', ')}`);
    }
  }
  return { text: out.join('\n\n'), symbols };
}
