import { CDP, TargetInfo, sleep } from "./cdp.js";

const FE_RE = /devtools_app\.html/;
const PANEL_RE = /lhdoppoj.*panel\.html/;
const DEEP =
  "function deep(sel,root,acc){try{root.querySelectorAll(sel).forEach(e=>acc.push(e))}catch(_){}" +
  "for(const e of root.querySelectorAll('*'))if(e.shadowRoot)deep(sel,e.shadowRoot,acc);return acc;}";

export async function showAxeDevToolsPanel(endpoint: string) {
  const cdp = await CDP.connect(endpoint);
  try {
    const panelShown = await showAxePanel(cdp);
    const panel = panelShown ? await panelTarget(cdp) : null;
    return { panelShown, panelTargetFound: !!panel, panelUrl: panel?.url ?? null };
  } finally {
    cdp.close();
  }
}

export async function completeAxeOnboarding(endpoint: string, timeoutMs = 20_000) {
  const cdp = await CDP.connect(endpoint);
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const candidates = extensionTargets(await cdp.targets());
      for (const target of candidates) {
        let session: string | null = null;
        try {
          session = await cdp.attach(target.targetId);
          const result = await cdp
            .evalIn(session, onboardingExpr())
            .then((s) => (typeof s === "string" ? JSON.parse(s) : s))
            .catch((e) => ({ attempted: false, error: e.message }));
          await cdp.detach(session);
          session = null;
          if (result?.completed || result?.attempted) {
            return { ...result, targetUrl: target.url };
          }
        } catch {
          if (session) await cdp.detach(session).catch(() => {});
        }
      }
      await sleep(500);
    }
    return { attempted: false, completed: false, reason: "onboarding controls not found before timeout" };
  } finally {
    cdp.close();
  }
}

export async function dismissAxeAiPopup(endpoint: string, timeoutMs = 15_000) {
  const cdp = await CDP.connect(endpoint);
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const candidates = extensionTargets(await cdp.targets());
      for (const target of candidates) {
        let session: string | null = null;
        try {
          session = await cdp.attach(target.targetId);
          const result = await cdp
            .evalIn(session, dismissAiPopupExpr())
            .then((s) => (typeof s === "string" ? JSON.parse(s) : s))
            .catch((e) => ({ attempted: false, error: e.message }));
          await cdp.detach(session);
          session = null;
          if (result?.dismissed || result?.attempted) {
            return { ...result, targetUrl: target.url };
          }
        } catch {
          if (session) await cdp.detach(session).catch(() => {});
        }
      }
      await sleep(500);
    }
    return { attempted: false, dismissed: false, reason: "AI testing popup not found before timeout" };
  } finally {
    cdp.close();
  }
}

function extensionTargets(targets: TargetInfo[]) {
  return targets
    .filter(
      (t) =>
        (t.type === "page" || t.type === "iframe") &&
        (/chrome-extension:\/\/lhdoppoj/i.test(t.url) || /axe\.deque\.com|deque\.com/i.test(t.url))
    )
    .sort((a, b) => Number(/panel\.html/i.test(b.url)) - Number(/panel\.html/i.test(a.url)));
}

async function showAxePanel(cdp: CDP) {
  for (let i = 0; i < 40; i++) {
    const fes = (await cdp.targets()).filter((t) => FE_RE.test(t.url));
    for (const fe of fes) {
      let session: string | null = null;
      try {
        session = await cdp.attach(fe.targetId);
        const panelId = await cdp
          .evalIn(
            session,
            `(()=>Object.keys((globalThis.UI&&globalThis.UI.panels)||{}).find(k=>/axe/i.test(k))||null)()`
          )
          .catch(() => null);
        if (panelId) {
          await cdp
            .evalIn(session, `(()=>{try{InspectorFrontendAPI.showPanel(${JSON.stringify(panelId)});return true}catch(e){return false}})()`)
            .catch(() => false);
          await cdp.send("Target.activateTarget", { targetId: fe.targetId }).catch(() => {});
          await cdp.detach(session);
          return true;
        }
      } catch {
        // DevTools front-end targets are transient while Chrome closes the
        // install-success tab and rebinds DevTools to the inspected page.
        // Ignore stale targets and continue polling.
      } finally {
        if (session) await cdp.detach(session).catch(() => {});
      }
    }
    await sleep(500);
  }
  return false;
}

function onboardingExpr() {
  return `(async()=> {
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const role=document.getElementById('user-job-role');
    const terms=document.getElementById('terms-and-services-checkbox');
    const text=e=>((e.getAttribute&&e.getAttribute('aria-label'))||e.textContent||'').replace(/\\s+/g,' ').trim();
    const buttons=[...document.querySelectorAll('button,[role=button]')];
    const start=buttons.find(b=>/Start using axe DevTools/i.test(text(b)));
    if(!role && !terms && !start) {
      return JSON.stringify({attempted:false, completed:false});
    }
    if(!role || !terms || !start) {
      return JSON.stringify({
        attempted:true,
        completed:false,
        reason:'missing onboarding controls',
        found:{role:!!role, terms:!!terms, start:!!start},
        buttons:buttons.map(text).filter(Boolean).slice(0,20)
      });
    }
    role.focus();
    role.value='Developer';
    role.dispatchEvent(new Event('input',{bubbles:true}));
    role.dispatchEvent(new Event('change',{bubbles:true}));
    if(!terms.checked) {
      terms.click();
      terms.dispatchEvent(new Event('change',{bubbles:true}));
    }
    await wait(300);
    start.click();
    await wait(1500);
    return JSON.stringify({
      attempted:true,
      completed:true,
      roleValue:role.value,
      termsChecked:!!terms.checked,
      clicked:text(start)
    });
  })()`;
}

function dismissAiPopupExpr() {
  return `(async()=> {
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const norm=s=>(s||'').replace(/\\s+/g,' ').trim();
    const text=e=>norm((e.getAttribute&&e.getAttribute('aria-label'))||e.textContent||'');
    const headings=[...document.querySelectorAll('h2')];
    const heading=headings.find(h=>h.id==='dialog-title-30' || /AI testing that saves hours, not minutes/i.test(text(h)));
    if(!heading) {
      return JSON.stringify({attempted:false, dismissed:false});
    }
    const scopes=[
      heading.parentElement,
      heading.closest('[role=dialog]'),
      heading.closest('[aria-modal=true]'),
      heading.closest('dialog'),
      heading.parentElement && heading.parentElement.parentElement
    ].filter(Boolean);
    let button=null;
    for(const scope of scopes) {
      const buttons=[...scope.querySelectorAll('button,[role=button]')].filter(b=>b!==heading);
      button=buttons.find(b=>b.offsetParent!==null) || buttons[0] || null;
      if(button) break;
    }
    if(!button) {
      const siblingButtons=[
        ...(heading.parentElement ? [...heading.parentElement.children].filter(e=>e!==heading && /^(BUTTON)$/i.test(e.tagName)) : []),
        ...(heading.parentElement ? [...heading.parentElement.querySelectorAll('button,[role=button]')] : [])
      ];
      button=siblingButtons[0] || null;
    }
    if(!button) {
      return JSON.stringify({
        attempted:true,
        dismissed:false,
        reason:'AI popup close button not found',
        headingId:heading.id,
        headingText:text(heading)
      });
    }
    button.click();
    await wait(1000);
    const stillOpen=[...document.querySelectorAll('h2')].some(h=>h.id==='dialog-title-30' || /AI testing that saves hours, not minutes/i.test(text(h)));
    return JSON.stringify({
      attempted:true,
      dismissed:!stillOpen,
      clickedText:text(button),
      headingId:heading.id,
      headingText:text(heading)
    });
  })()`;
}

async function panelTarget(cdp: CDP): Promise<TargetInfo | null> {
  for (let i = 0; i < 40; i++) {
    const panel = (await cdp.targets()).find((t) => PANEL_RE.test(t.url));
    if (panel) return panel;
    await sleep(300);
  }
  return null;
}

export interface ConfigureExtensionOptions {
  endpoint: string;
  email?: string;
  password?: string;
}

export async function configureAxeExtension(opts: ConfigureExtensionOptions) {
  const cdp = await CDP.connect(opts.endpoint);
  try {
    const panelShown = await showAxePanel(cdp);
    const panel = await panelTarget(cdp);
    if (!panel) return { panelShown, loginAttempted: false, loggedIn: false, reason: "axe panel target not found" };

    const session = await cdp.attach(panel.targetId);
    const stateBefore = await cdp.evalIn(session, panelStateExpr()).catch((e) => JSON.stringify({ error: e.message }));
    let loginAttempted = false;
    let loginResult: any = null;
    if (opts.email && opts.password) {
      loginAttempted = true;
      loginResult = await cdp
        .evalIn(session, loginExpr(opts.email, opts.password))
        .then((s) => (typeof s === "string" ? JSON.parse(s) : s))
        .catch((e) => ({ ok: false, error: e.message }));
      await sleep(3000);
    }
    const stateAfter = await cdp.evalIn(session, panelStateExpr()).catch((e) => JSON.stringify({ error: e.message }));
    await cdp.detach(session);
    return {
      panelShown,
      loginAttempted,
      loggedIn: !!loginResult?.ok,
      loginResult,
      stateBefore: typeof stateBefore === "string" ? JSON.parse(stateBefore) : stateBefore,
      stateAfter: typeof stateAfter === "string" ? JSON.parse(stateAfter) : stateAfter,
    };
  } finally {
    cdp.close();
  }
}

function panelStateExpr() {
  return `(()=>{${DEEP}
    const text=e=>((e.getAttribute&&e.getAttribute('aria-label'))||e.placeholder||e.textContent||'').replace(/\\s+/g,' ').trim();
    return JSON.stringify({
      title: document.title,
      url: location.href,
      headings: deep('h1,h2,h3,[role=heading]',document,[]).map(text).filter(Boolean).slice(0,10),
      inputs: deep('input,textarea',document,[]).map(e=>({type:e.type||e.tagName, name:e.name||'', placeholder:e.placeholder||'', label:text(e).slice(0,80)})).slice(0,20),
      buttons: [...new Set(deep('button,[role=button],a',document,[]).map(text).filter(Boolean))].slice(0,30),
      body: (document.body?document.body.innerText:'').replace(/\\s+/g,' ').slice(0,1000)
    });
  })()`;
}

function loginExpr(email: string, password: string) {
  return `(async()=>{${DEEP}
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const text=e=>((e.getAttribute&&e.getAttribute('aria-label'))||e.placeholder||e.textContent||'').replace(/\\s+/g,' ').trim();
    const fire=el=>['input','change'].forEach(t=>el.dispatchEvent(new Event(t,{bubbles:true})));
    const click=el=>['mousedown','mouseup','click'].forEach(t=>el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})));
    const buttons=()=>deep('button,[role=button],a',document,[]);
    const buttonByText=rx=>buttons().find(e=>rx.test(text(e)));
    const start=buttonByText(/log\\s*in|sign\\s*in|connect|account/i);
    if(start){ click(start); await wait(1200); }
    const inputs=deep('input,textarea',document,[]);
    const emailInput=inputs.find(e=>/(email|user|login)/i.test([e.type,e.name,e.id,e.placeholder,text(e)].join(' '))) || inputs.find(e=>e.type==='email') || inputs[0];
    const passInput=inputs.find(e=>e.type==='password'||/(password|pass)/i.test([e.name,e.id,e.placeholder,text(e)].join(' ')));
    if(!emailInput || !passInput) return JSON.stringify({ok:false, reason:'email/password inputs not found', inputs:inputs.map(e=>({type:e.type,name:e.name,id:e.id,placeholder:e.placeholder})).slice(0,20), buttons:[...new Set(buttons().map(text).filter(Boolean))].slice(0,20)});
    emailInput.focus(); emailInput.value=${JSON.stringify(email)}; fire(emailInput);
    passInput.focus(); passInput.value=${JSON.stringify(password)}; fire(passInput);
    const submit=buttonByText(/log\\s*in|sign\\s*in|submit|continue/i) || deep('button,[type=submit]',document,[])[0];
    if(!submit) return JSON.stringify({ok:false, reason:'submit button not found'});
    click(submit);
    return JSON.stringify({ok:true, clicked:text(submit)});
  })()`;
}
