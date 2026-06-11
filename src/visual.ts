// Visual + media analysis helpers for answering guided-test judgment questions.
// Captures element/page screenshots from the INSPECTED page (not the panel) so
// Claude can see an element and judge it (alt-text appropriateness, decorative vs
// informative, visible focus, etc.), plus a lightweight media (audio/video) audit.
import { CDP } from "./cdp.js";

async function inspectedPage(cdp: CDP, urlContains?: string) {
  const tis = await cdp.targets();
  const pages = tis.filter((t) => t.type === "page" && /^(https?|file):/.test(t.url));
  const page = (urlContains ? pages.find((p) => p.url.includes(urlContains)) : undefined) ?? pages[0];
  if (!page) throw new Error("No inspected http(s)/file page found in the browser.");
  const s = await cdp.attach(page.targetId);
  await cdp.send("Page.enable", {}, s).catch(() => {});
  return { page, s };
}

export interface CaptureResult {
  base64: string;
  meta: any;
}

export async function captureElement(endpoint: string, selector: string, urlContains?: string): Promise<CaptureResult> {
  const cdp = await CDP.connect(endpoint);
  try {
    const { s } = await inspectedPage(cdp, urlContains);
    const info = await cdp.evalIn(
      s,
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return null;
        el.scrollIntoView({block:'center',inline:'center'});
        const r=el.getBoundingClientRect();
        return JSON.stringify({x:r.x,y:r.y,width:r.width,height:r.height,tag:el.tagName,
          role:el.getAttribute('role'),alt:el.getAttribute('alt'),ariaLabel:el.getAttribute('aria-label'),
          title:el.getAttribute('title'),tabindex:el.getAttribute('tabindex'),
          text:(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,120),
          html:el.outerHTML.replace(/\\s+/g,' ').slice(0,240)});})()`
    );
    if (!info) throw new Error(`No element matches selector: ${selector}`);
    const meta = JSON.parse(info);
    const pad = 6;
    const clip = {
      x: Math.max(0, meta.x - pad),
      y: Math.max(0, meta.y - pad),
      width: Math.max(1, meta.width + pad * 2),
      height: Math.max(1, meta.height + pad * 2),
      scale: 1,
    };
    const { data } = await cdp.send(
      "Page.captureScreenshot",
      { format: "png", clip, captureBeyondViewport: false },
      s
    );
    return { base64: data as string, meta };
  } finally {
    cdp.close();
  }
}

export async function capturePage(endpoint: string, fullPage = false, urlContains?: string): Promise<CaptureResult> {
  const cdp = await CDP.connect(endpoint);
  try {
    const { s } = await inspectedPage(cdp, urlContains);
    const { data } = await cdp.send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: fullPage },
      s
    );
    return { base64: data as string, meta: { fullPage } };
  } finally {
    cdp.close();
  }
}

/**
 * Per-category element inventory for the guided audit. Tags candidate elements with
 * data-axe-id and returns stable `[data-axe-id="N"]` selectors so the caller can then
 * axe_capture_element each one for visual judgment. Covers the categories axe's
 * automatic rules can't fully judge (alt quality, label meaning, real-vs-fake controls,
 * landmark/heading structure, data-vs-layout tables).
 */
export async function inventory(endpoint: string, urlContains?: string) {
  const cdp = await CDP.connect(endpoint);
  try {
    const { s } = await inspectedPage(cdp, urlContains);
    const info = await cdp.evalIn(
      s,
      `(()=>{
        const vis=el=>{const r=el.getBoundingClientRect();return r.width>1&&r.height>1;};
        let k=0; const tag=el=>{const id='axe-'+(k++);el.setAttribute('data-axe-id',id);return '[data-axe-id="'+id+'"]';};
        const accName=el=>{ // rough accessible name
          const al=el.getAttribute('aria-label'); if(al) return al.trim();
          const lb=el.getAttribute('aria-labelledby'); if(lb){const t=lb.split(/\\s+/).map(i=>{const n=document.getElementById(i);return n?n.textContent:'';}).join(' ').trim(); if(t) return t;}
          if(el.id){const l=document.querySelector('label[for="'+CSS.escape(el.id)+'"]'); if(l) return (l.textContent||'').trim();}
          const wrap=el.closest&&el.closest('label'); if(wrap) return (wrap.textContent||'').trim();
          return (el.textContent||'').trim();
        };
        const images=[...document.querySelectorAll('img')].filter(vis).map(e=>{const r=e.getBoundingClientRect();
          return {selector:tag(e), hasAlt:e.hasAttribute('alt'), alt:e.getAttribute('alt'), w:Math.round(r.width), h:Math.round(r.height),
            file:(e.currentSrc||e.src||'').split('/').pop().split('?')[0].slice(0,40), inLink:!!(e.closest&&e.closest('a'))};});
        const formFields=[...document.querySelectorAll('input,select,textarea')].filter(vis)
          .filter(e=>!['hidden'].includes(e.type)).map(e=>({selector:tag(e), tag:e.tagName.toLowerCase(), type:e.type||null,
            name:e.name||e.id||null, accessibleName:accName(e)||null, hasLabel:!!accName(e), placeholder:e.getAttribute('placeholder')||null}));
        const interactive=[...document.querySelectorAll('a,button,[role=button],[role=link],[onclick],[tabindex]')].filter(vis).map(e=>({
          selector:tag(e), tag:e.tagName.toLowerCase(), role:e.getAttribute('role'), accessibleName:accName(e)||null,
          tabindex:e.getAttribute('tabindex'), href:e.getAttribute('href')||null,
          looksClickableButNotNative: !['A','BUTTON','INPUT','SELECT','TEXTAREA'].includes(e.tagName) && (!!e.getAttribute('onclick')||!!e.onclick) }));
        const headings=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].map(e=>({level:e.tagName.toLowerCase(), text:(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60)}));
        const landmarkSel={banner:'header,[role=banner]',navigation:'nav,[role=navigation]',main:'main,[role=main]',contentinfo:'footer,[role=contentinfo]',search:'[role=search]',complementary:'aside,[role=complementary]'};
        const landmarksPresent=Object.keys(landmarkSel).filter(k=>document.querySelector(landmarkSel[k]));
        const landmarksMissing=Object.keys(landmarkSel).filter(k=>!landmarksPresent.includes(k)&&['banner','navigation','main','contentinfo'].includes(k));
        const tables=[...document.querySelectorAll('table')].filter(vis).map(e=>({selector:tag(e), rows:e.rows.length, cols:e.rows[0]?e.rows[0].cells.length:0,
          hasTh:!!e.querySelector('th'), hasCaption:!!e.querySelector('caption'), likelyLayout: e.rows.length<=1 || !e.querySelector('th')}));
        return JSON.stringify({
          url:location.href, counts:{images:images.length, formFields:formFields.length, interactive:interactive.length, headings:headings.length, tables:tables.length},
          images, formFields, interactive: interactive.slice(0,80), headings, landmarksPresent, landmarksMissing, tables});
      })()`
    );
    return JSON.parse(info);
  } finally {
    cdp.close();
  }
}

/** Lightweight media-accessibility audit: <audio>/<video> + caption/description tracks. */
export async function mediaAudit(endpoint: string, urlContains?: string) {
  const cdp = await CDP.connect(endpoint);
  try {
    const { s } = await inspectedPage(cdp, urlContains);
    const info = await cdp.evalIn(
      s,
      `(()=>{const out=[];
        for(const el of document.querySelectorAll('video,audio')){
          const tracks=[...el.querySelectorAll('track')].map(tr=>({kind:tr.kind,label:tr.label,srclang:tr.getAttribute('srclang'),hasSrc:!!tr.getAttribute('src')}));
          out.push({tag:el.tagName.toLowerCase(),
            accessibleName:el.getAttribute('aria-label')||el.getAttribute('title')||null,
            controls:el.hasAttribute('controls'), autoplay:el.hasAttribute('autoplay'), muted:el.muted,
            hasCaptions:tracks.some(t=>/captions|subtitles/i.test(t.kind)),
            hasDescriptions:tracks.some(t=>/descriptions/i.test(t.kind)),
            tracks});}
        return JSON.stringify({count:out.length, media:out});})()`
    );
    return JSON.parse(info);
  } finally {
    cdp.close();
  }
}
