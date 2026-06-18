import { CDP } from "./cdp.js";

type Heading = {
  selector?: string;
  level: number;
  tag: string;
  text: string;
  fontSize?: number;
  fontWeight?: string;
};

type ListInfo = {
  selector?: string;
  tag: string;
  itemCount: number;
  text: string;
};

type StructureSnapshot = {
  url?: string;
  title?: string;
  lang?: string | null;
  headings: Heading[];
  lists: ListInfo[];
  landmarksPresent: string[];
  landmarksMissing: string[];
};

type StructureIssue = {
  rule: string;
  impact: "critical" | "serious" | "moderate" | "minor";
  message: string;
  selector?: string;
  evidence?: unknown;
};

export type StructureAuditResult = {
  url?: string;
  title?: string;
  lang?: string | null;
  summary: {
    headings: number;
    lists: number;
    issues: number;
  };
  issues: StructureIssue[];
  snapshot: StructureSnapshot;
};

async function inspectedPage(cdp: CDP, urlContains?: string) {
  const tis = await cdp.targets();
  const pages = tis.filter((t) => t.type === "page" && /^(https?|file):/.test(t.url));
  const page = (urlContains ? pages.find((p) => p.url.includes(urlContains)) : undefined) ?? pages[0];
  if (!page) throw new Error("No inspected http(s)/file page found in the browser.");
  const s = await cdp.attach(page.targetId);
  await cdp.send("Page.enable", {}, s).catch(() => {});
  return { page, s };
}

export function analyzeStructureSnapshot(snapshot: StructureSnapshot): StructureAuditResult {
  const issues: StructureIssue[] = [];
  const headings = snapshot.headings ?? [];

  if (!snapshot.lang || !snapshot.lang.trim()) {
    issues.push({
      rule: "html-lang",
      impact: "serious",
      message: "Page does not declare a document language with the html lang attribute.",
      evidence: { lang: snapshot.lang ?? null },
    });
  }

  if (!snapshot.title || !snapshot.title.trim()) {
    issues.push({
      rule: "document-title",
      impact: "serious",
      message: "Page does not have a non-empty document title.",
      evidence: { title: snapshot.title ?? "" },
    });
  }

  const h1s = headings.filter((h) => h.level === 1);
  if (h1s.length === 0) {
    issues.push({
      rule: "page-has-heading-one",
      impact: "moderate",
      message: "Page has no h1/level-1 heading.",
    });
  } else if (h1s.length > 1) {
    issues.push({
      rule: "single-h1",
      impact: "minor",
      message: "Page has more than one h1/level-1 heading.",
      evidence: h1s.map((h) => h.text),
    });
  }

  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1];
    const curr = headings[i];
    if (curr.level > prev.level + 1) {
      issues.push({
        rule: "heading-order",
        impact: "moderate",
        message: `Heading level skips from h${prev.level} to h${curr.level}: ${curr.text}`,
        selector: curr.selector,
        evidence: { previous: prev.text, current: curr.text },
      });
    }
  }

  for (const heading of headings) {
    const wordCount = heading.text.split(/\s+/).filter(Boolean).length;
    const sentenceLike = /[.!?]/.test(heading.text) && wordCount >= 12;
    if (sentenceLike) {
      issues.push({
        rule: "prose-as-heading",
        impact: "minor",
        message: "Heading text looks like body prose rather than a section label.",
        selector: heading.selector,
        evidence: { text: heading.text },
      });
    }
  }

  for (const landmark of snapshot.landmarksMissing ?? []) {
    issues.push({
      rule: "missing-landmark",
      impact: "minor",
      message: `Page is missing a common ${landmark} landmark.`,
      evidence: { landmark },
    });
  }

  return {
    url: snapshot.url,
    title: snapshot.title,
    lang: snapshot.lang,
    summary: {
      headings: headings.length,
      lists: snapshot.lists?.length ?? 0,
      issues: issues.length,
    },
    issues,
    snapshot,
  };
}

export async function structureAudit(endpoint: string, urlContains?: string): Promise<StructureAuditResult> {
  const cdp = await CDP.connect(endpoint);
  try {
    const { s } = await inspectedPage(cdp, urlContains);
    const raw = await cdp.evalIn(
      s,
      `(()=>{
        const cssPath=(el)=>{
          if(el.id) return '#'+CSS.escape(el.id);
          const parts=[];
          for(let n=el;n&&n.nodeType===1&&n!==document.documentElement;n=n.parentElement){
            const tag=n.tagName.toLowerCase();
            const peers=[...n.parentElement.children].filter(x=>x.tagName===n.tagName);
            const idx=peers.length>1 ? ':nth-of-type('+(peers.indexOf(n)+1)+')' : '';
            parts.unshift(tag+idx);
          }
          return parts.join(' > ');
        };
        const text=e=>(e.textContent||'').replace(/\\s+/g,' ').trim();
        const headings=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].map(e=>{
          const cs=getComputedStyle(e);
          const tag=e.tagName.toLowerCase();
          const aria=Number(e.getAttribute('aria-level'));
          const level=tag.match(/^h[1-6]$/) ? Number(tag.slice(1)) : aria || 2;
          return {selector:cssPath(e), level, tag, text:text(e), fontSize:parseFloat(cs.fontSize), fontWeight:cs.fontWeight};
        }).filter(h=>h.text);
        const lists=[...document.querySelectorAll('ul,ol,dl')].map(e=>({
          selector:cssPath(e), tag:e.tagName.toLowerCase(),
          itemCount:e.matches('dl') ? e.querySelectorAll('dt,dd').length : e.querySelectorAll(':scope > li').length,
          text:text(e).slice(0,160)
        }));
        const landmarkSel={
          banner:'header,[role=banner]',
          navigation:'nav,[role=navigation]',
          main:'main,[role=main]',
          contentinfo:'footer,[role=contentinfo]'
        };
        const landmarksPresent=Object.entries(landmarkSel).filter(([,sel])=>document.querySelector(sel)).map(([k])=>k);
        const landmarksMissing=Object.keys(landmarkSel).filter(k=>!landmarksPresent.includes(k));
        return JSON.stringify({
          url:location.href,
          title:document.title,
          lang:document.documentElement.getAttribute('lang'),
          headings,
          lists,
          landmarksPresent,
          landmarksMissing
        });
      })()`
    );
    return analyzeStructureSnapshot(JSON.parse(raw));
  } finally {
    cdp.close();
  }
}
