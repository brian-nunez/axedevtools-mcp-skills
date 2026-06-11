// Interactive-Elements review: expand a card and open its "Edit result" editor
// (accessible name accuracy Yes/No, role select, states), dump the editor.
// Close with: igt-step.mjs --button "^cancel$"  (or "^save$" after changing).
//   node igt-edit.mjs 7
import { cdp, sleep, panelTarget, feShot, clickExpr, DEEP } from "./igt-lib.mjs";

const n = process.argv[2];
if (!n) { console.log("usage: igt-edit.mjs <elementNumber>"); process.exit(1); }
const api = await cdp();
const p = await panelTarget(api);
const s = await api.attach(p.targetId);
const T = `const A=e=>e.getAttribute('aria-label')||'';const T=e=>(A(e)||e.textContent||'').replace(/\\s+/g,' ').trim();`;

await clickExpr(api, s,
  `(()=>{${T}return deep('button,[role=button],[aria-expanded],h3,h4,a',document,[]).find(e=>T(e).replace(/\\s+/g,' ').startsWith('Element ${n} of '));})()`,
  `header[${n}]`);
await sleep(800);
await clickExpr(api, s,
  `(()=>{${T}return deep('button,[role=button]',document,[]).find(e=>A(e).startsWith('Edit result') && / Element ${n}\\./.test(' '+A(e)));})()`,
  `edit[${n}]`);
await sleep(1200);

const out = await api.evalIn(
  s,
  `(()=>{${DEEP}
    const T=e=>((e&&e.textContent)||'').replace(/\\s+/g,' ').trim();
    const radios=deep('[role=radio],input[type=radio]',document,[]).map((e,i)=>{
      let c=e; for(let k=0;k<6&&c&&T(c).length<4;k++)c=c.parentElement;
      return {i, on:!!(e.checked||e.getAttribute('aria-checked')==='true'), label:T(c).slice(0,110)};
    });
    const selects=deep('select,[role=combobox],[role=listbox]',document,[]).map(e=>({val:(e.value||T(e)).slice(0,40)}));
    const body=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');
    return JSON.stringify({radios:radios.slice(0,12), selects:selects.slice(0,4), text:body.slice(0,900)}, null, 1);
  })()`
);
console.log(out);
await api.detach(s);
await feShot(api, "/tmp/igt-edit.png").catch(() => {});
console.log("shot -> /tmp/igt-edit.png");
api.close();
process.exit(0);
