// markdown.jsx — sanitized markdown renderer + helpers to pull out ```options and ```trace blocks
import React, { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

/** Split raw assistant text into {body, options[], trace, slidesHtml} */
export function dissect(text) {
  let t = text || '';
  let options = [];
  let trace = null;

  // extract ```options ... ```
  t = t.replace(/```options\s*\n([\s\S]*?)```/g, (_, inner) => {
    options = inner.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 6);
    return '';
  });
  // extract ```trace ... ```
  t = t.replace(/```trace\s*\n([\s\S]*?)```/g, (_, inner) => { trace = inner.trim(); return ''; });

  // extract oda-slide HTML sections for the live preview
  let slidesHtml = null;
  if (/<section[^>]*class="[^"]*oda-slide/i.test(t)) {
    const matches = t.match(/<section[^>]*class="[^"]*oda-slide[^"]*"[^>]*>[\s\S]*?<\/section>/gi);
    if (matches?.length) slidesHtml = matches;
  }
  return { body: t.trim(), options, trace, slidesHtml };
}

// LINK AUDIT (2026-07-18): every anchor DOMPurify emits gets target="_blank" +
// rel="noopener noreferrer"; placeholder/dead hrefs ('#', javascript:, example.com)
// are stripped down to plain text so no broken link ever renders.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') || '';
    const dead = !href || href === '#' || href.startsWith('javascript:') || /(^|\.)example\.com/i.test(href);
    if (dead) {
      node.removeAttribute('href');
      return;
    }
    if (/^https?:\/\//i.test(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
});

const PURIFY_CFG = {
  ALLOWED_TAGS: ['a','b','strong','i','em','u','s','p','br','hr','ul','ol','li','blockquote','code','pre','h1','h2','h3','h4','h5','h6','table','thead','tbody','tr','th','td','span','div','section','img'],
  ALLOWED_ATTR: ['href','target','rel','dir','style','class','src','alt','download'],
};

// DELIVERABLE LINKS (2026-07-26): agent-output URLs (Azure blob / airevprod) are long,
// signed, and useless as raw text. Anchors pointing at those hosts are swapped for a
// compact file card (name + extension badge + Open / Download) instead of the raw URL.
function fileNameFromUrl(url) {
  try {
    const base = new URL(url).pathname.split('/').filter(Boolean).pop() || 'file';
    return decodeURIComponent(base);
  } catch {
    return 'file';
  }
}
function fileExt(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toUpperCase();
}
function isDeliverableUrl(href) {
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return host.includes('airevprod') || host.endsWith('blob.core.windows.net');
  } catch {
    return false;
  }
}
function buildDeliverableCard(doc, href) {
  const fileName = fileNameFromUrl(href);
  const ext = fileExt(fileName) || 'FILE';
  const card = doc.createElement('div');
  card.className = 'odadeliv odadeliv--md';
  card.innerHTML = `
    <div class="odadeliv__card">
      <span class="odadeliv__ext">${ext}</span>
      <div class="odadeliv__meta"><span class="odadeliv__name"></span></div>
      <div class="odadeliv__btns">
        <a class="odadeliv__btn odadeliv__btn--primary" target="_blank" rel="noopener noreferrer">Open</a>
        <a class="odadeliv__btn" target="_blank" rel="noopener noreferrer">Download</a>
      </div>
    </div>`;
  // Set text/attrs via the DOM (never via the template) so the filename and signed URL
  // can never break out of the markup.
  card.querySelector('.odadeliv__name').textContent = fileName;
  const [openLink, downloadLink] = card.querySelectorAll('.odadeliv__btn');
  openLink.setAttribute('href', href);
  downloadLink.setAttribute('href', href);
  downloadLink.setAttribute('download', fileName);
  return card;
}
function transformDeliverableLinks(html) {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return html;
  if (!/https?:\/\//i.test(html)) return html;
  const doc = new DOMParser().parseFromString(`<body><div id="r">${html}</div></body>`, 'text/html');
  const root = doc.getElementById('r');
  let changed = false;
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (!isDeliverableUrl(href)) return;
    a.replaceWith(buildDeliverableCard(doc, href));
    changed = true;
  });
  return changed ? root.innerHTML : html;
}

export function Markdown({ text }) {
  const html = useMemo(() => {
    const raw = marked.parse(text || '');
    return transformDeliverableLinks(DOMPurify.sanitize(raw, PURIFY_CFG));
  }, [text]);
  return <div className="md" dir="auto" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function SanitizedHtml({ html, className }) {
  const safe = useMemo(() => DOMPurify.sanitize(html || '', PURIFY_CFG), [html]);
  return <div className={className} dir="auto" dangerouslySetInnerHTML={{ __html: safe }} />;
}
