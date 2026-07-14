import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function renderMilestoneDossierHtml({ paths, artifactsDir, sourcePath, outputPath }) {
  const dossierPath = sourcePath ?? path.join(paths.milestonesRoot, "milestones-summary.md");
  const htmlPath = outputPath ?? path.join(paths.milestonesRoot, "milestones.html");
  const milestones = parseDossierMilestones(readOptional(dossierPath));
  const html = buildDossierHtml({ milestones, sourcePath: relative(paths, dossierPath) });
  writeFileSync(htmlPath, html, "utf8");
  writeFileSync(path.join(artifactsDir, "milestones-dossier-render.json"), `${JSON.stringify({
    schema: "create-milestone-dossier-html-render/v1",
    status: "passed",
    source: relative(paths, dossierPath),
    path: relative(paths, htmlPath),
    milestones: milestones.length,
    lines: [...new Set(milestones.map((item) => item.line).filter(Boolean))].sort()
  }, null, 2)}\n`, "utf8");
  return {
    schema: "create-milestone-dossier-html-render/v1",
    status: "passed",
    source: relative(paths, dossierPath),
    path: relative(paths, htmlPath),
    milestones: milestones.length
  };
}

function parseDossierMilestones(body) {
  const rows = body.split(/\r?\n/u).filter((line) => /^\s*\|/u.test(line));
  if (rows.length < 2) return [];
  const headerIndex = rows.findIndex((line) => /Milestone/u.test(line) && /Status/u.test(line));
  if (headerIndex < 0) return [];
  const headers = splitMarkdownRow(rows[headerIndex]).map((header) => stripMarkdown(header).toLowerCase());
  const dataRows = rows.slice(headerIndex + 1).filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line));
  return dataRows.map((line) => {
    const cells = splitMarkdownRow(line);
    return {
      line: cellByHeader(headers, cells, "line"),
      milestone: cellByHeader(headers, cells, "milestone"),
      status: cellByHeader(headers, cells, "status"),
      goal: cellByHeader(headers, cells, "one-line goal"),
      rootTaskId: stripMarkdown(cellByHeader(headers, cells, "root task id")),
      childCount: stripMarkdown(cellByHeader(headers, cells, "child count")),
      dependencies: cellByHeader(headers, cells, "dependencies / entry"),
      batch: cellByHeader(headers, cells, "batch")
    };
  }).filter((row) => row.line || row.milestone || row.status || row.goal || row.rootTaskId || row.dependencies || row.batch);
}

function buildDossierHtml(input) {
  const lines = [...new Set(input.milestones.map((item) => item.line).filter(Boolean))].sort();
  const statuses = [...new Set(input.milestones.map((item) => item.status).filter(Boolean))].sort();
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Milestone Dossier</title>
<style>
${editorialShellCss()}
.summary-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.pill { display: inline-flex; align-items: center; min-height: 28px; border: 1px solid var(--line); border-radius: 5px; background: var(--panel); color: var(--ink-dim); padding: 4px 9px; font-family: var(--mono); font-size: 11px; }
.line-group { display: grid; gap: 14px; }
.milestone-row { display: grid; grid-template-columns: minmax(120px, .72fr) minmax(180px, 1fr) minmax(90px, .42fr) minmax(130px, .54fr); gap: 14px; align-items: start; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 16px; }
.milestone-row h3 { font-family: var(--serif); font-size: 18px; font-weight: 400; line-height: 1.3; margin-bottom: 8px; color: var(--ink); }
.milestone-row p { color: var(--ink-dim); font-size: 13px; line-height: 1.6; }
.status { color: var(--accent); }
.status.done, .status.shipped, .status.complete, .status.completed { color: var(--done); }
.status.planned, .status.active, .status.in-progress { color: var(--defer); }
.status.rejected, .status.blocked { color: var(--reject); }
.small-label { font-family: var(--mono); font-size: 10.5px; color: var(--ink-faint); letter-spacing: .06em; text-transform: uppercase; margin-bottom: 5px; }
@media (max-width: 860px) {
  .milestone-row { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<script>
(function () {
  try {
    var saved = localStorage.getItem('ha-dossier-theme');
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', saved || (prefersDark ? 'dark' : 'light'));
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
</script>
<header class="topbar">
  <div class="wrap row">
    <div class="brand"><span class="dot"></span><span>milestone dossier</span></div>
    <nav>
      <a href="#overview">overview</a>
      <a href="#milestones">milestones</a>
      <a href="#source">source</a>
      <button class="theme-toggle" id="themeToggle" type="button" aria-label="切换日 / 夜主题" title="切换日 / 夜主题">
        <svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.5" y1="4.5" x2="6" y2="6"/><line x1="18" y1="18" x2="19.5" y2="19.5"/><line x1="4.5" y1="19.5" x2="6" y2="18"/><line x1="18" y1="6" x2="19.5" y2="4.5"/></svg>
        <svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
      </button>
    </nav>
  </div>
</header>
<main>
  <div class="hero" id="overview">
    <div class="wrap">
      <div class="eyebrow">mechanical dossier</div>
      <h1>Milestone Dossier</h1>
      <p class="lede">This page is mechanically derived from <code>${escapeHtml(input.sourcePath)}</code>.</p>
      <div class="meta-grid">
        <div class="meta-cell"><div class="k">milestones</div><div class="v">${input.milestones.length}</div></div>
        <div class="meta-cell"><div class="k">lines</div><div class="v">${lines.length}</div></div>
        <div class="meta-cell"><div class="k">statuses</div><div class="v">${statuses.length}</div></div>
        <div class="meta-cell"><div class="k">source</div><div class="v">dossier-data.md</div></div>
      </div>
      <div class="summary-list">
        ${lines.map((line) => `<span class="pill">${escapeHtml(line)}</span>`).join("\n        ")}
      </div>
    </div>
  </div>
  <section id="milestones">
    <div class="wrap">
      <div class="section-head">
        <div class="section-num">01 / derived table</div>
        <h2>Milestones</h2>
      </div>
      <div class="line-group">
        ${input.milestones.map(renderMilestoneRow).join("\n        ")}
      </div>
    </div>
  </section>
  <section id="source">
    <div class="wrap">
      <div class="section-head">
        <div class="section-num">02 / provenance</div>
        <h2>Source</h2>
      </div>
      <div class="card">
        <p><code>${escapeHtml(input.sourcePath)}</code></p>
      </div>
    </div>
  </section>
</main>
<footer>
  <div class="wrap">
    <div class="src">Generated by create-milestone preset render-html from dossier-data.md.</div>
  </div>
</footer>
<script>
document.getElementById('themeToggle').addEventListener('click', function () {
  var cur = document.documentElement.getAttribute('data-theme') || 'light';
  var next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('ha-dossier-theme', next); } catch (e) {}
});
</script>
</body>
</html>
`;
}

function renderMilestoneRow(item) {
  const statusClass = classToken(item.status);
  const childCount = item.childCount ? `<p><span class="small-label">children</span>${escapeHtml(item.childCount)}</p>` : "";
  const rootTask = item.rootTaskId ? `<p><span class="small-label">root task</span><code>${escapeHtml(item.rootTaskId)}</code></p>` : "";
  const dependencies = item.dependencies ? `<p><span class="small-label">dependencies / entry</span>${escapeHtml(item.dependencies)}</p>` : "";
  const batch = item.batch ? `<p><span class="small-label">batch</span>${escapeHtml(item.batch)}</p>` : "";
  const goal = item.goal ? `<p>${escapeHtml(item.goal)}</p>` : "";
  return `<article class="milestone-row">
  <div>
    ${item.line ? `<div class="small-label">${escapeHtml(item.line)}</div>` : ""}
    ${item.milestone ? `<h3>${escapeHtml(item.milestone)}</h3>` : ""}
    ${goal}
  </div>
  <div>${rootTask}${dependencies}</div>
  <div>${item.status ? `<p class="status ${statusClass}"><span class="small-label">status</span>${escapeHtml(item.status)}</p>` : ""}${childCount}</div>
  <div>${batch}</div>
</article>`;
}

function editorialShellCss() {
  // Keep an installed preset package self-contained. The renderer must not
  // reach back into the builtin vertical's sibling template directory.
  return `:root {
  --bg:#faf9f6; --panel:#ffffff; --panel-2:#f5f2ec;
  --ink:#1f1d1a; --ink-dim:#57534a; --ink-faint:#8a8478;
  --line:#e7e3db; --line-soft:#efece5; --accent:#5b6b8c;
  --done:#5f7a55; --defer:#a07238; --reject:#9a4a3f;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Songti SC",Georgia,serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,"PingFang SC",sans-serif;
  --mono:"SF Mono",SFMono-Regular,ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;
}
:root[data-theme="dark"] {
  --bg:#1b1d21; --panel:#23262c; --panel-2:#2a2e35;
  --ink:#e6e3dd; --ink-dim:#a9a39a; --ink-faint:#7d776c;
  --line:#373b43; --line-soft:#2e3138; --accent:#8896b5;
  --done:#9bb089; --defer:#c89a5e; --reject:#bf8074;
}
* { box-sizing:border-box; margin:0; padding:0; }
html { scroll-behavior:smooth; }
body { background:var(--bg); color:var(--ink); font-family:var(--sans); font-size:16px; line-height:1.7; transition:background-color .25s ease,color .25s ease; }
.wrap { max-width:1080px; margin:0 auto; padding:0 32px; }
.topbar { position:sticky; top:0; z-index:50; background:var(--bg); border-bottom:1px solid var(--line); }
.topbar .row { display:flex; align-items:center; justify-content:space-between; padding:14px 0; gap:16px; }
.brand,nav { display:flex; align-items:center; gap:10px; }
.brand .dot { width:8px; height:8px; border-radius:2px; background:var(--accent); }
nav a { color:var(--ink-dim); text-decoration:none; font-size:13px; padding:5px 11px; }
.theme-toggle { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--ink-dim); }
.theme-toggle svg { width:17px; height:17px; }
.theme-toggle .moon { display:none; }
:root[data-theme="dark"] .theme-toggle .sun { display:none; }
:root[data-theme="dark"] .theme-toggle .moon { display:block; }
.hero { padding:72px 0 52px; border-bottom:1px solid var(--line); }
.eyebrow,.small-label,.section-num { font-family:var(--mono); font-size:11px; color:var(--ink-faint); letter-spacing:.08em; text-transform:uppercase; }
h1,h2 { font-family:var(--serif); font-weight:400; line-height:1.2; }
h1 { font-size:clamp(30px,4.6vw,50px); margin:20px 0 24px; }
h2 { font-size:clamp(24px,3.2vw,34px); }
.lede { color:var(--ink-dim); font-family:var(--serif); font-size:18px; }
code { font-family:var(--mono); font-size:.85em; background:var(--panel-2); color:var(--accent); padding:1px 5px; border:1px solid var(--line); border-radius:3px; }
.meta-grid { display:grid; grid-template-columns:repeat(4,1fr); margin-top:28px; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
.meta-cell { padding:18px 22px; border-right:1px solid var(--line); background:var(--panel); }
.meta-cell:last-child { border-right:0; }
.meta-cell .k { font-family:var(--mono); font-size:10px; color:var(--ink-faint); text-transform:uppercase; }
.meta-cell .v { font-size:19px; }
section { padding:64px 0; border-bottom:1px solid var(--line); }
.section-head { margin-bottom:30px; }
.card { border:1px solid var(--line); border-radius:8px; background:var(--panel); padding:22px; }
footer { padding:44px 0 64px; color:var(--ink-faint); }
footer .src { font-family:var(--mono); font-size:11px; }
@media (max-width:760px) { .wrap { padding:0 22px; } .meta-grid { grid-template-columns:1fr; } .meta-cell { border-right:0; border-bottom:1px solid var(--line); } }`;
}

function splitMarkdownRow(line) {
  return String(line ?? "")
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

function cellByHeader(headers, cells, header) {
  const index = headers.indexOf(header);
  return index >= 0 ? String(cells[index] ?? "").trim() : "";
}

function classToken(value) {
  return stripMarkdown(value).toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-|-$/gu, "");
}

function stripMarkdown(value) {
  return String(value ?? "").replace(/[`*]/gu, "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readOptional(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function relative(paths, filePath) {
  return toSlash(path.relative(paths.rootDir ?? process.cwd(), filePath));
}

function toSlash(value) {
  return value.split(path.sep).join("/");
}
