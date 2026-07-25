// StageIssueTree.jsx — problem-solve canvas (Phase 3).
// Parses the workbook markdown artifact into a visual issue tree: a
// bottom-line headline, the structured tree itself, and any recommendation
// sections as numbered cards. Renders the problem_definition / hypotheses /
// recommendations gate beside the tree while it is open.
import React from 'react';
import { parseMdStructure } from '../md';
import GateCard from '../GateCard';

const TREE_RE = /tree|structure/i;
const BOTTOM_RE = /bottom.?line|answer/i;
const RECOMMEND_RE = /recommend/i;
const TAG_RE = /\[(fact|assumption|web)\]|\*\*(fact|assumption|web)\*\*/i;

function tagFromText(text) {
  const m = String(text || '').match(TAG_RE);
  if (!m) return null;
  return (m[1] || m[2] || '').toLowerCase();
}

function stripTag(text) {
  return String(text || '')
    .replace(/\[(fact|assumption|web)\]/ig, '')
    .replace(/\*\*(fact|assumption|web)\*\*/ig, '')
    .trim();
}

function splitLabelNote(text) {
  const idx = text.indexOf(' — ');
  if (idx === -1) return { label: text, note: null };
  return { label: text.slice(0, idx).trim(), note: text.slice(idx + 3).trim() };
}

/**
 * parseMdStructure() flattens bullet indentation, so to draw an indented tree
 * we re-scan the raw markdown for the matched heading and rebuild nesting
 * from each bullet line's leading whitespace.
 */
function buildIndentedTree(rawText, headingText) {
  const lines = String(rawText || '').split('\n');
  let capturing = false;
  const root = [];
  const stack = []; // { indent, node }
  for (const line of lines) {
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      if (capturing) break; // next heading ends this section
      if (h[2].trim() === headingText) capturing = true;
      continue;
    }
    if (!capturing) continue;
    const b = line.match(/^(\s*)[-*•]\s+(.*)$/);
    if (!b) continue;
    const indent = b[1].replace(/\t/g, '    ').length;
    const raw = b[2].trim();
    const tag = tagFromText(raw);
    const { label, note } = splitLabelNote(stripTag(raw));
    const node = { label, note, tag, children: [] };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else root.push(node);
    stack.push({ indent, node });
  }
  return root;
}

function TreeNode({ node }) {
  return (
    <div className="oda-tree__node">
      <span>{node.label}</span>
      {node.tag && <span className={`oda-pill oda-tag--${node.tag}`}>{node.tag}</span>}
      {node.note && <span className="oda-muted"> — {node.note}</span>}
      {node.children.length > 0 && (
        <div className="oda-tree__children">
          {node.children.map((c, i) => <TreeNode key={i} node={c} />)}
        </div>
      )}
    </div>
  );
}

export default function StageIssueTree({ run, stage, gate, artifact, artifactContent, onResolveGate, fetchArtifact }) {
  const content = artifactContent?.content || null;
  const running = run?.currentNodeId && run?.nodeStates?.[run.currentNodeId]?.status === 'running';
  const structure = content ? parseMdStructure(content) : null;
  const sections = structure?.sections || [];

  const treeSection = sections.find((s) => TREE_RE.test(s.heading));
  const treeNodes = treeSection && content ? buildIndentedTree(content, treeSection.heading) : [];

  const bottomSection = sections.find((s) => BOTTOM_RE.test(s.heading));
  let bottomLine = null;
  if (bottomSection) {
    bottomLine = (bottomSection.lines.length ? bottomSection.lines : bottomSection.bullets).join(' ');
  } else if (content) {
    const bq = content.split('\n').find((l) => /^\s*>\s*\S/.test(l));
    if (bq) bottomLine = bq.replace(/^\s*>\s*/, '').trim();
  }

  const recommendSections = sections.filter((s) => RECOMMEND_RE.test(s.heading));

  const body = (
    <div className="oda-card">
      <div className="oda-kicker">Problem structure</div>
      {!content ? (
        <div className="oda-empty" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {running && <span className="oda-spin" aria-hidden />}
          <span>Structuring the problem…</span>
        </div>
      ) : (
        <>
          {bottomLine && (
            <div className="oda-card--gold" style={{ marginBottom: 16 }}>
              <div className="oda-kicker">Bottom line</div>
              <div className="oda-h" style={{ fontSize: '1em' }}>{bottomLine}</div>
            </div>
          )}

          {treeNodes.length > 0 ? (
            <div className="oda-tree">
              {treeNodes.map((n, i) => <TreeNode key={i} node={n} />)}
            </div>
          ) : (
            <div className="oda-muted">No structured tree found in this artifact yet.</div>
          )}

          {recommendSections.map((s, i) => (
            <div key={i} style={{ marginTop: 16 }}>
              <div className="oda-sub">{s.heading}</div>
              <div className="oda-cardgrid">
                {(s.bullets.length ? s.bullets : s.lines).map((item, j) => (
                  <div key={j} className="oda-card">
                    <span className="oda-num">{j + 1}</span> {item}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );

  if (!gate) return body;

  return (
    <div className="oda-two">
      {body}
      <GateCard gate={gate} onResolve={onResolveGate} allowEdits />
    </div>
  );
}
