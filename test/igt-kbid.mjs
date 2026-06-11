// Identify each Keyboard-review element precisely: click its Highlight button in
// the panel, then on the page find the axe highlight overlay and report the
// underlying element (tag/id/class/text) via elementFromPoint at overlay center.
//   node igt-kbid.mjs 1 2 3 ... 15
import { cdp, sleep, panelTarget, DEEP } from "./igt-lib.mjs";

const nums = process.argv.slice(2).map(Number);
const api = await cdp();
const p = await panelTarget(api);
const s = await api.attach(p.targetId);
const page = (await api.targets()).find((t) => t.type === "page" && /dequeuniversity/.test(t.url));
const ps = await api.attach(page.targetId);

for (const n of nums) {
  await api.evalIn(
    s,
    `(()=>{${DEEP}
      const A=e=>e.getAttribute('aria-label')||'';
      const b=deep('button,[role=button]',document,[]).find(e=>A(e).startsWith('Highlight element Element ${n}.'));
      if(!b) return 'notfound';
      b.scrollIntoView({block:'center'});
      ['mousedown','mouseup','click'].forEach(x=>b.dispatchEvent(new MouseEvent(x,{bubbles:true,cancelable:true,view:window})));
      try{b.click()}catch(e){}
      return 'ok';
    })()`
  );
  await sleep(800);
  const r = await api.evalIn(
    ps,
    `(()=>{
      // axe highlight overlay: fixed/absolute div with huge z-index added by the ext
      const cand=[...document.querySelectorAll('div,span')].filter(e=>{
        const cs=getComputedStyle(e); const z=parseInt(cs.zIndex||'0',10);
        return (cs.position==='absolute'||cs.position==='fixed') && z>100000 && e.offsetWidth>2;
      });
      if(!cand.length) return JSON.stringify({err:'no overlay'});
      const ov=cand[cand.length-1];
      const r=ov.getBoundingClientRect();
      const cx=r.x+r.width/2, cy=r.y+r.height/2;
      const old=ov.style.pointerEvents; ov.style.pointerEvents='none';
      let el=document.elementFromPoint(cx,cy);
      ov.style.pointerEvents=old;
      // walk out of any other overlay layers
      let guard=0;
      while(el && guard++<4 && parseInt(getComputedStyle(el).zIndex||'0',10)>100000){ el.style.pointerEvents='none'; el=document.elementFromPoint(cx,cy); }
      const T=e=>((e&&e.textContent)||'').replace(/\\s+/g,' ').trim().slice(0,60);
      return JSON.stringify({
        ovRect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},
        el: el?{tag:el.tagName, id:el.id, cls:(el.className||'').toString().slice(0,50), for:el.getAttribute&&el.getAttribute('for'), txt:T(el)}:null
      });
    })()`
  );
  console.log(`el ${n}:`, r);
}
await api.detach(ps);
await api.detach(s);
api.close();
process.exit(0);
