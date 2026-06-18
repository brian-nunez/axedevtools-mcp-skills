import { CDP, TargetInfo, sleep } from "./cdp.js";

const FE_RE = /devtools_app\.html/;
const PANEL_RE = /lhdoppoj.*panel\.html/;
const DEEP =
  "function deep(sel,root,acc){try{root.querySelectorAll(sel).forEach(e=>acc.push(e))}catch(_){}" +
  "for(const e of root.querySelectorAll('*'))if(e.shadowRoot)deep(sel,e.shadowRoot,acc);return acc;}";

export async function showAxeDevToolsPanel(endpoint: string, timeoutMs = 5_000, pollMs = 250) {
  const cdp = await CDP.connect(endpoint);
  const deadline = Date.now() + timeoutMs;
  try {
    const panelShown = await showAxePanel(cdp, deadline, pollMs);
    const panel = panelShown ? await panelTarget(cdp, deadline, pollMs) : null;
    return { panelShown, panelTargetFound: !!panel, panelUrl: panel?.url ?? null };
  } finally {
    cdp.close();
  }
}

export async function reloadAxeDevToolsPanel(endpoint: string, timeoutMs = 10_000) {
  const cdp = await CDP.connect(endpoint);
  const deadline = Date.now() + timeoutMs;
  try {
    const panelShown = await showAxePanel(cdp, Date.now() + 2_500, 250);
    const panel = await panelTarget(cdp, Date.now() + 2_500, 250);
    if (!panel) return { ok: false, panelShown, reason: "axe panel target not found before reload" };

    const session = await cdp.attach(panel.targetId);
    try {
      await cdp
        .evalIn(
          session,
          `(()=>{ location.reload(); return true; })()`
        )
        .catch((error) => {
          throw new Error(`Failed to reload axe panel frame: ${error?.message || error}`);
        });
    } finally {
      await cdp.detach(session).catch(() => {});
    }

    let reloaded = false;
    while (Date.now() < deadline) {
      const current = await panelTarget(cdp, Date.now() + 500, 100);
      if (current?.targetId === panel.targetId || current?.url === panel.url) {
        reloaded = true;
        break;
      }
      await sleep(100);
    }
    return {
      ok: reloaded,
      panelShown,
      panelTargetFound: reloaded,
      panelUrl: panel.url,
      reloaded: true,
      method: "location.reload",
    };
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
          if (session) await cdp.detach(session).catch(() => { });
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
          if (session) await cdp.detach(session).catch(() => { });
        }
      }
      await sleep(500);
    }
    return { attempted: false, dismissed: false, reason: "AI testing popup not found before timeout" };
  } finally {
    cdp.close();
  }
}

export async function clickScanFullPage(endpoint: string, timeoutMs = 30_000) {
  const cdp = await CDP.connect(endpoint);
  const deadline = Date.now() + timeoutMs;
  let lastResult: any = null;
  try {
    while (Date.now() < deadline) {
      await showAxePanel(cdp, Date.now() + 2_500, 250).catch(() => false);
      const panel = await panelTarget(cdp, Date.now() + 2_500, 250);
      if (!panel) {
        await sleep(500);
        continue;
      }

      let session: string | null = null;
      try {
        session = await cdp.attach(panel.targetId);
        const result = await cdp
          .evalIn(session, scanFullPageClickExpr())
          .then((s) => (typeof s === "string" ? JSON.parse(s) : s))
          .catch((e) => ({ ok: false, reason: e.message }));
        lastResult = result;
        if (result?.clicked) {
          await sleep(1000);
          const verified = await cdp
            .evalIn(session, scanFullPageVerifyExpr())
            .then((s) => (typeof s === "string" ? JSON.parse(s) : s))
            .catch((e) => ({ ok: false, reason: e.message }));
          lastResult = { click: result, verified };
          if (verified?.ok) {
            await cdp.detach(session);
            session = null;
            return { ...verified, click: result, targetUrl: panel.url };
          }
          await cdp.detach(session);
          session = null;
          return {
            ok: false,
            attempted: true,
            clicked: true,
            reason: "Scan full page was clicked once but no state change was confirmed",
            click: result,
            verified,
            targetUrl: panel.url,
          };
        }
        await cdp.detach(session);
        session = null;
        if (result?.attempted && result?.terminal) {
          return { ...result, targetUrl: panel.url };
        }
      } catch {
        if (session) await cdp.detach(session).catch(() => { });
      }

      await sleep(500);
    }
    return { ok: false, attempted: !!lastResult?.attempted || !!lastResult?.click?.attempted, reason: "Scan full page was not confirmed before timeout", lastResult };
  } finally {
    cdp.close();
  }
}

export async function clickWeFoundSomethingSave(endpoint: string, timeoutMs = 60_000) {
  const cdp = await CDP.connect(endpoint);
  const deadline = Date.now() + timeoutMs;
  let sawModal = false;
  let lastResult: any = null;
  try {
    while (Date.now() < deadline) {
      const panel = await panelTarget(cdp, Date.now() + 2_500, 250);
      if (!panel) {
        await sleep(500);
        continue;
      }

      let session: string | null = null;
      try {
        session = await cdp.attach(panel.targetId);
        const result = await cdp
          .evalIn(session, weFoundSomethingSaveExpr())
          .then((s) => (typeof s === "string" ? JSON.parse(s) : s))
          .catch((e) => ({ ok: false, reason: e.message }));
        await cdp.detach(session);
        session = null;
        lastResult = { ...result, targetUrl: panel.url };
        if (result?.attempted) sawModal = true;
        if (result?.saved) {
          return { ...result, targetUrl: panel.url };
        }
      } catch {
        if (session) await cdp.detach(session).catch(() => { });
      }

      await sleep(500);
    }
    if (sawModal) {
      return lastResult ?? { ok: false, attempted: true, saved: false, reason: "We found something modal appeared but Save was not clicked before timeout" };
    }
    return { ok: true, attempted: false, saved: false, reason: "We found something modal did not appear" };
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

async function showAxePanel(cdp: CDP, deadline = Date.now() + 20_000, pollMs = 500) {
  while (Date.now() < deadline) {
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
          await cdp.send("Target.activateTarget", { targetId: fe.targetId }).catch(() => { });
          await cdp.detach(session);
          return true;
        }
      } catch {
        // DevTools front-end targets are transient while Chrome closes the
        // install-success tab and rebinds DevTools to the inspected page.
        // Ignore stale targets and continue polling.
      } finally {
        if (session) await cdp.detach(session).catch(() => { });
      }
    }
    await sleep(pollMs);
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

function scanFullPageClickExpr() {
  return `(async()=> {
    ${DEEP}
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const norm=s=>(s||'').replace(/\\s+/g,' ').trim();
    const text=e=>norm((e.getAttribute&&e.getAttribute('aria-label'))||(e.innerText||e.textContent)||'');
    const visible=e=>{
      const r=e.getBoundingClientRect();
      const s=getComputedStyle(e);
      return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden';
    };
    const buttonState=b=>({
      text:text(b),
      disabled:!!b.disabled,
      ariaDisabled:b.getAttribute('aria-disabled')||'',
      ariaBusy:b.getAttribute('aria-busy')||'',
      className:b.className||''
    });
    const scanButtonText=t=>/^(Scan full page|Full Page Scan)$/i.test(t);
    const activate=el=>{
      const r=el.getBoundingClientRect();
      const init={bubbles:true,cancelable:true,composed:true,view:window,clientX:r.left+r.width/2,clientY:r.top+r.height/2};
      try{el.focus();}catch(_){}
      try{el.dispatchEvent(new PointerEvent('pointerover',init));}catch(_){}
      try{el.dispatchEvent(new MouseEvent('mouseover',init));}catch(_){}
      try{el.dispatchEvent(new PointerEvent('pointermove',init));}catch(_){}
      try{el.dispatchEvent(new MouseEvent('mousemove',init));}catch(_){}
      try{el.dispatchEvent(new PointerEvent('pointerdown',{...init,pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:1}));}catch(_){}
      try{el.dispatchEvent(new MouseEvent('mousedown',{...init,button:0,buttons:1}));}catch(_){}
      try{el.dispatchEvent(new PointerEvent('pointerup',{...init,pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:0}));}catch(_){}
      try{el.dispatchEvent(new MouseEvent('mouseup',{...init,button:0,buttons:0}));}catch(_){}
      try{el.dispatchEvent(new MouseEvent('click',{...init,button:0,buttons:0,detail:1}));}catch(_){}
      try{el.click();}catch(_){}
    };
    const findButton=()=>deep('button[type="button"]',document,[]).find(b=>
      visible(b) &&
      scanButtonText(text(b)) &&
      !b.disabled &&
      b.getAttribute('aria-disabled')!=='true' &&
      b.getAttribute('aria-busy')!=='true'
    );
    const deadline=Date.now()+10000;
    let button=null;
    let stableSince=0;
    while(Date.now()<deadline){
      const found=findButton();
      if(found) {
        if(found===button) {
          if(!stableSince) stableSince=Date.now();
          if(Date.now()-stableSince>=750) break;
        } else {
          button=found;
          stableSince=Date.now();
        }
      } else {
        button=null;
        stableSince=0;
      }
      await wait(150);
    }
    if(!button) {
      return JSON.stringify({
        ok:false,
        attempted:false,
        reason:'Scan full page / Full Page Scan button not found',
        buttons:deep('button',document,[]).map(b=>({type:b.type||'', text:text(b), disabled:!!b.disabled})).filter(b=>b.text).slice(0,30)
      });
    }
    button.scrollIntoView({block:'center', inline:'center'});
    await wait(500);
    activate(button);
    await wait(500);
    return JSON.stringify({
      ok:true,
      attempted:true,
      clicked:true,
      clickedText:text(button),
      button:buttonState(button)
    });
  })()`;
}

function scanFullPageVerifyExpr() {
  return `(async()=> {
    ${DEEP}
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const norm=s=>(s||'').replace(/\\s+/g,' ').trim();
    const text=e=>norm((e.getAttribute&&e.getAttribute('aria-label'))||(e.innerText||e.textContent)||'');
    const body=()=>norm(document.body ? document.body.innerText : '');
    const scanButtonText=t=>/^(Scan full page|Full Page Scan)$/i.test(t);
    const button=()=>deep('button[type="button"]',document,[]).find(b=>scanButtonText(text(b)));
    const deadline=Date.now()+6000;
    while(Date.now()<deadline){
      const b=button();
      const pageText=body();
      const buttonGone=!b;
      const disabled=!!(b && (b.disabled || b.getAttribute('aria-disabled')==='true' || b.getAttribute('aria-busy')==='true'));
      const scanning=/scanning|analyz|running|loading|please wait|in progress/i.test(pageText);
      const results=/issues?|needs review|automatic|guided|violations?|scan results/i.test(pageText);
      if(buttonGone || disabled || scanning || results) {
        return JSON.stringify({
          ok:true,
          attempted:true,
          clicked:'Scan full page / Full Page Scan',
          signal:{buttonGone, disabled, scanning, results}
        });
      }
      await wait(250);
    }
    return JSON.stringify({
      ok:false,
      attempted:true,
      terminal:false,
      reason:'Scan full page click did not produce a detectable state change'
    });
  })()`;
}

function weFoundSomethingSaveExpr() {
  return `(async()=> {
    ${DEEP}
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const norm=s=>(s||'').replace(/\\s+/g,' ').trim();
    const text=e=>norm((e.getAttribute&&e.getAttribute('aria-label'))||(e.innerText||e.textContent)||'');
    const visible=e=>{
      const r=e.getBoundingClientRect();
      const s=getComputedStyle(e);
      return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden';
    };
    const deadline=Date.now()+5000;
    let heading=null;
    while(Date.now()<deadline){
      heading=deep('h1,h2,h3,[role="heading"]',document,[]).find(h=>visible(h) && /^We found something$/i.test(text(h)));
      if(heading) break;
      await wait(150);
    }
    if(!heading) {
      return JSON.stringify({ok:true, attempted:false, saved:false, reason:'We found something modal not present'});
    }

    const scopes=[
      heading.closest('[role=dialog]'),
      heading.closest('[aria-modal=true]'),
      heading.closest('dialog'),
      heading.parentElement,
      heading.parentElement && heading.parentElement.parentElement,
      document
    ].filter(Boolean);
    let button=null;
    for(const scope of scopes){
      button=deep('button,[role=button]',scope,[]).find(b=>visible(b) && /^Save$/i.test(text(b)) && !b.disabled);
      if(button) break;
    }
    const buttonDeadline=Date.now()+5000;
    while(!button && Date.now()<buttonDeadline){
      for(const scope of scopes){
        button=deep('button,[role=button]',scope,[]).find(b=>visible(b) && /^Save$/i.test(text(b)) && !b.disabled);
        if(button) break;
      }
      if(!button) await wait(150);
    }
    if(!button) {
      return JSON.stringify({
        ok:false,
        attempted:true,
        saved:false,
        reason:'Save button not found',
        headingText:text(heading),
        buttons:deep('button,[role=button]',document,[]).map(b=>({text:text(b), disabled:!!b.disabled})).filter(b=>b.text).slice(0,30)
      });
    }
    button.scrollIntoView({block:'center', inline:'center'});
    await wait(100);
    try{button.focus();}catch(_){}
    button.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window}));
    button.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,view:window}));
    button.click();
    await wait(1000);
    return JSON.stringify({ok:true, attempted:true, saved:true, headingText:text(heading), clicked:text(button)});
  })()`;
}

async function panelTarget(cdp: CDP, deadline = Date.now() + 12_000, pollMs = 300): Promise<TargetInfo | null> {
  while (Date.now() < deadline) {
    const panel = (await cdp.targets()).find((t) => PANEL_RE.test(t.url));
    if (panel) return panel;
    await sleep(pollMs);
  }
  return null;
}

export interface ConfigureExtensionOptions {
  endpoint: string;
  email?: string;
  password?: string;
}

export interface ConfigureSettingsOptions {
  endpoint: string;
  serverUrl: string;
}

export interface SignInOptions {
  endpoint: string;
  email: string;
  password: string;
  /** When false (ON_PREM=0), click "or sign in with email" after the Sign in button. Default: true */
  onPrem?: boolean;
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

export async function signInToAxe(opts: SignInOptions) {
  const onPrem = opts.onPrem !== false; // default true; false only when ON_PREM=0
  const cdp = await CDP.connect(opts.endpoint);
  try {
    const panel = await panelTarget(cdp);
    if (!panel) return { ok: false, reason: "axe panel target not found" };

    // Snapshot existing page targets so we can detect the new one that opens
    const existingIds = new Set((await cdp.targets()).map((t) => t.targetId));

    // Click Sign in (and optionally the email link) inside the panel
    const session = await cdp.attach(panel.targetId);
    const clickResult = await cdp
      .evalIn(session, signInClickExpr(!onPrem))
      .then((s) => (typeof s === "string" ? JSON.parse(s) : s))
      .catch((e) => ({ ok: false, error: e.message }));
    await cdp.detach(session);

    if (!clickResult?.ok) return { ok: false, reason: "sign-in click failed", clickResult };

    // Wait for the new login page to open. Chrome is launched with
    // --auto-open-devtools-for-tabs, so the auth tab can create both an actual
    // http(s) page and a new devtools:// frontend. Only attach to the real page.
    const deadline = Date.now() + 15_000;
    let loginPage: TargetInfo | null = null;
    while (Date.now() < deadline) {
      const targets = await cdp.targets();
      const newPages = targets.filter((t) => t.type === "page" && !existingIds.has(t.targetId));
      await Promise.all(
        newPages
          .filter((t) => /^devtools:\/\//i.test(t.url))
          .map((t) => cdp.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {}))
      );
      loginPage = newPages.find((t) => /^https?:\/\//i.test(t.url)) ?? null;
      if (loginPage) break;
      await sleep(300);
    }
    if (!loginPage) return { ok: false, reason: "login page did not open", clickResult };
    await sleep(500);
    await Promise.all(
      (await cdp.targets())
        .filter((t) => t.type === "page" && !existingIds.has(t.targetId) && /^devtools:\/\//i.test(t.url))
        .map((t) => cdp.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {}))
    );

    // Attach first, then use Page.bringToFront through the session — this is
    // what actually gives the page OS-level focus in a headless/VNC environment
    const loginSession = await cdp.attach(loginPage.targetId);
    await cdp.send("Page.bringToFront", {}, loginSession);
    await sleep(3000);

    // Helper: bring page to front + wait for page ready + JS focus + repeated mouse clicks.
    // Used to make the auth page visible/active, but field population below does
    // not depend on OS-level keyboard focus because that has proven unreliable
    // under Xvfb/VNC.
    const focusField = async (field: "username" | "password") => {
      await cdp.send("Page.bringToFront", {}, loginSession);
      await sleep(300);
      const rect = await cdp
        .evalIn(loginSession, fieldRectExpr(field))
        .catch(() => null);
      if (!rect) return null;
      for (let i = 0; i < 3; i++) {
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", x: rect.x, y: rect.y, clickCount: 1 }, loginSession);
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", x: rect.x, y: rect.y, clickCount: 1 }, loginSession);
        await sleep(150);
      }
      // JS focus again after the clicks to make sure it took
      await cdp.evalIn(loginSession, focusDiscoveredFieldExpr(field)).catch(() => {});
      await sleep(300);
      return rect;
    };

    const fillField = async (field: "username" | "password", value: string, label: string) => {
      let lastResult: any = null;
      for (let attempt = 1; attempt <= 4; attempt++) {
        await cdp.send("Page.bringToFront", {}, loginSession).catch(() => {});
        const rect = await focusField(field);
        if (!rect) {
          lastResult = { ok: false, reason: `${label} field not found`, attempt, label };
          await sleep(350);
          continue;
        }

        await cdp.evalIn(loginSession, clearFieldExpr(field)).catch(() => null);
        await sleep(100);
        await cdp.send("Input.insertText", { text: value }, loginSession).catch(async () => {
          for (const ch of value) {
            await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch, unmodifiedText: ch }, loginSession);
            await sleep(15);
          }
        });
        await sleep(250);

        let result = await cdp
          .evalIn(loginSession, verifyFieldExpr(field, value))
          .then((s) => (typeof s === "string" ? JSON.parse(s) : s))
          .catch((e) => ({ ok: false, reason: e.message }));
        if (!result?.ok) {
          result = await cdp
            .evalIn(loginSession, fillFieldExpr(field, value))
            .then((s) => (typeof s === "string" ? JSON.parse(s) : s))
            .catch((e) => ({ ok: false, reason: e.message }));
        }
        lastResult = { ...result, attempt, label };
        if (result?.ok) return lastResult;
        await sleep(350);
      }
      return lastResult ?? { ok: false, reason: `${label} fill did not run`, attempt: 0, label };
    };

    const clickButton = async (label: string, rx: RegExp, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      let lastResult: any = null;
      while (Date.now() < deadline) {
        await cdp.send("Page.bringToFront", {}, loginSession).catch(() => {});
        const result = await cdp
          .evalIn(loginSession, clickButtonExpr(rx.source, rx.flags))
          .then((s) => (typeof s === "string" ? JSON.parse(s) : s))
          .catch((e) => ({ ok: false, reason: e.message }));
        lastResult = { ...result, label };
        if (result?.ok) return lastResult;
        await sleep(300);
      }
      return lastResult ?? { ok: false, reason: `${label} button click did not run`, label };
    };

    // Focus and robustly fill the username/email field. The fill helper verifies the actual DOM
    // value before we click Next, so startup does not silently continue with an
    // empty or partially-filled email field.
    const usernameRect = await focusField("username");
    if (!usernameRect) {
      await cdp.detach(loginSession);
      return { ok: false, reason: "username/email field not found", clickResult };
    }
    const usernameFill = await fillField("username", opts.email, "username");
    if (!usernameFill.ok) {
      await cdp.detach(loginSession);
      return { ok: false, reason: "failed to fill username/email field", clickResult, usernameFill };
    }

    const nextClick = await clickButton("Next", /Next|Continue|Submit|Sign in|Log in/i);
    if (!nextClick.ok) {
      await cdp.detach(loginSession);
      return { ok: false, reason: "Next button not found/clickable", clickResult, usernameFill, nextClick };
    }

    // Focus and robustly fill #password after the password screen appears.
    const passwordRect = await focusField("password");
    if (!passwordRect) {
      await cdp.detach(loginSession);
      return { ok: false, reason: "password field not found", clickResult, usernameFill, nextClick };
    }
    const passwordFill = await fillField("password", opts.password, "password");
    if (!passwordFill.ok) {
      await cdp.detach(loginSession);
      return { ok: false, reason: "failed to fill password field", clickResult, usernameFill, nextClick, passwordFill };
    }

    const submitClick = await clickButton("Submit", /Submit|Sign in|Log in/i);

    await cdp.detach(loginSession);
    return {
      ok: !!submitClick.ok,
      onPrem,
      clickResult,
      usernameFill: redactFillResult(usernameFill),
      nextClick,
      passwordFill: redactFillResult(passwordFill),
      submitClicked: !!submitClick.ok,
      submitClick,
    };
  } finally {
    cdp.close();
  }
}

function redactFillResult(result: any) {
  if (!result || typeof result !== "object") return result;
  const { expectedLength, actualLength, attempt, label, ok, reason, selector, tagName, type, name, id, autocomplete, method } = result;
  return { ok, reason, method, selector, tagName, type, name, id, autocomplete, expectedLength, actualLength, attempt, label };
}

function fieldDiscoverySource(field: "username" | "password") {
  return `
    const field=${JSON.stringify(field)};
    const norm=s=>(s||'').replace(/\\s+/g,' ').trim();
    const attr=(el,n)=>el.getAttribute&&el.getAttribute(n)||'';
    const labelText=(el)=>{
      const id=attr(el,'id');
      const labels=[
        ...(el.labels ? [...el.labels] : []),
        ...(id ? [...document.querySelectorAll('label[for="'+CSS.escape(id)+'"]')] : [])
      ];
      return norm(labels.map(l=>l.innerText||l.textContent||'').join(' '));
    };
    const descriptor=(el)=>norm([
      attr(el,'id'),
      attr(el,'name'),
      attr(el,'type'),
      attr(el,'autocomplete'),
      attr(el,'placeholder'),
      attr(el,'aria-label'),
      labelText(el)
    ].join(' '));
    const visible=(el)=>{
      const r=el.getBoundingClientRect();
      const s=getComputedStyle(el);
      return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden';
    };
    const candidates=()=>[...document.querySelectorAll('input,textarea')]
      .filter(el=>visible(el) && !el.disabled && !el.readOnly && !['hidden','checkbox','radio','submit','button'].includes((el.type||'').toLowerCase()));
    const findField=()=>{
      const all=candidates();
      if(field==='password') {
        const byId=document.querySelector('#password');
        return (byId && visible(byId) && !byId.disabled && !byId.readOnly ? byId : null)
          || all.find(el=>(el.type||'').toLowerCase()==='password')
          || all.find(el=>/(^|\\b)(password|passwd|passcode|pwd)(\\b|$)/i.test(descriptor(el)));
      }
      const byId=document.querySelector('#username');
      return (byId && visible(byId) && !byId.disabled && !byId.readOnly ? byId : null)
        || all.find(el=>/(^|\\b)(username|user-name|email|e-mail|login|userid|user id|user_id)(\\b|$)/i.test(descriptor(el)))
        || all.find(el=>(el.type||'').toLowerCase()==='email')
        || all.find(el=>/(email|username)/i.test((el.autocomplete||'')))
        || all.find(el=>['text','email',''].includes((el.type||'').toLowerCase()));
    };
  `;
}

function fieldRectExpr(field: "username" | "password") {
  return `(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const readyDeadline=Date.now()+10000;
    while(document.readyState!=='complete' && Date.now()<readyDeadline){
      await wait(200);
    }
    ${fieldDiscoverySource(field)}
    const deadline=Date.now()+15000;
    while(Date.now()<deadline){
      const el=findField();
      if(el){
        el.focus();
        const r=el.getBoundingClientRect();
        return {x:r.left+r.width/2,y:r.top+r.height/2};
      }
      await wait(300);
    }
    return null;
  })()`;
}

function focusDiscoveredFieldExpr(field: "username" | "password") {
  return `(()=>{
    ${fieldDiscoverySource(field)}
    const el=findField();
    if(el){el.focus();try{el.click();}catch(_){}}
  })()`;
}

function clearFieldExpr(field: "username" | "password") {
  return `(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    ${fieldDiscoverySource(field)}
    const deadline=Date.now()+5000;
    let el=null;
    while(Date.now()<deadline){
      el=findField();
      if(el) break;
      await wait(100);
    }
    if(!el) return JSON.stringify({ok:false, reason:'field not found', field});
    el.focus();
    try{el.click();}catch(_){}
    if(typeof el.select==='function') {
      try{el.select();}catch(_){}
    }
    const setter=(el instanceof HTMLTextAreaElement
      ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')?.set
      : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set);
    if(setter) setter.call(el,''); else el.value='';
    el.dispatchEvent(new Event('input',{bubbles:true,cancelable:true}));
    el.dispatchEvent(new Event('change',{bubbles:true,cancelable:true}));
    el.focus();
    return JSON.stringify({ok:true, field});
  })()`;
}

function verifyFieldExpr(field: "username" | "password", value: string) {
  return `(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const expected=${JSON.stringify(value)};
    ${fieldDiscoverySource(field)}
    const deadline=Date.now()+3000;
    let el=null;
    while(Date.now()<deadline){
      el=findField();
      if(el) {
        if(el.value===expected) {
          el.dispatchEvent(new Event('input',{bubbles:true,cancelable:true}));
          el.dispatchEvent(new Event('change',{bubbles:true,cancelable:true}));
          return JSON.stringify({
            ok:true,
            method:'cdp-insertText',
            field,
            selector:el.id ? '#'+el.id : '',
            tagName:el.tagName,
            type:el.type||'',
            name:el.name||'',
            id:el.id||'',
            autocomplete:el.autocomplete||'',
            expectedLength:expected.length,
            actualLength:el.value.length
          });
        }
      }
      await wait(100);
    }
    return JSON.stringify({
      ok:false,
      reason:'typed field value did not match',
      field,
      selector:el && el.id ? '#'+el.id : '',
      tagName:el ? el.tagName : '',
      type:el ? (el.type||'') : '',
      name:el ? (el.name||'') : '',
      id:el ? (el.id||'') : '',
      autocomplete:el ? (el.autocomplete||'') : '',
      expectedLength:expected.length,
      actualLength:el ? (el.value||'').length : 0
    });
  })()`;
}

function fillFieldExpr(field: "username" | "password", value: string) {
  return `(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const expected=${JSON.stringify(value)};
    ${fieldDiscoverySource(field)}
    const deadline=Date.now()+8000;
    let el=null;
    while(Date.now()<deadline){
      el=findField();
      if(el) break;
      await wait(150);
    }
    if(!el) return JSON.stringify({ok:false, reason:'field not found or not interactable', field, expectedLength:expected.length});

    const fire=(type)=>el.dispatchEvent(new Event(type,{bubbles:true,cancelable:true}));
    const inputSetter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
    const textAreaSetter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')?.set;
    const setter=el instanceof HTMLTextAreaElement ? textAreaSetter : inputSetter;
    const setValue=(v)=>{
      el.focus();
      try{el.click();}catch(_){}
      if(typeof el.select==='function') {
        try{el.select();}catch(_){}
      }
      if(setter) setter.call(el,v);
      else el.value=v;
      fire('beforeinput');
      fire('input');
      fire('change');
      fire('blur');
      el.focus();
    };

    for(let i=0;i<4;i++){
      setValue('');
      await wait(80);
      setValue(expected);
      await wait(150);
      if(el.value===expected) {
        return JSON.stringify({
          ok:true,
          field,
          selector:el.id ? '#'+el.id : '',
          tagName:el.tagName,
          type:el.type||'',
          name:el.name||'',
          id:el.id||'',
          autocomplete:el.autocomplete||'',
          expectedLength:expected.length,
          actualLength:el.value.length
        });
      }
    }

    return JSON.stringify({
      ok:false,
      reason:'field value did not match after retries',
      field,
      selector:el.id ? '#'+el.id : '',
      tagName:el.tagName,
      type:el.type||'',
      name:el.name||'',
      id:el.id||'',
      autocomplete:el.autocomplete||'',
      expectedLength:expected.length,
      actualLength:(el.value||'').length
    });
  })()`;
}

function clickButtonExpr(pattern: string, flags: string) {
  return `(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const rx=new RegExp(${JSON.stringify(pattern)},${JSON.stringify(flags)});
    const text=e=>((e.getAttribute&&e.getAttribute('aria-label'))||(e.innerText||e.textContent)||'').replace(/\\s+/g,' ').trim();
    const isVisible=e=>{
      const r=e.getBoundingClientRect();
      const s=getComputedStyle(e);
      return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none';
    };
    const deadline=Date.now()+3000;
    let btn=null;
    while(Date.now()<deadline){
      const buttons=[...document.querySelectorAll('button,[role=button],input[type=submit],input[type=button]')];
      btn=buttons.find(b=>rx.test(text(b) || b.value || '') && isVisible(b) && !b.disabled);
      if(!btn) btn=buttons.find(b=>b.type==='submit' && isVisible(b) && !b.disabled);
      if(btn) break;
      await wait(150);
    }
    if(!btn) return JSON.stringify({ok:false, reason:'button not found', pattern:${JSON.stringify(pattern)}});
    btn.scrollIntoView({block:'center', inline:'center'});
    await wait(100);
    try{btn.focus();}catch(_){}
    btn.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window}));
    btn.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,view:window}));
    btn.click();
    return JSON.stringify({ok:true, clicked:text(btn) || btn.value || btn.type || btn.tagName});
  })()`;
}

function signInClickExpr(clickEmailLink: boolean) {
  return `(async()=>{
    ${DEEP}
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const click=el=>{try{el.click();}catch(_){}};
    const itext=e=>((e.getAttribute&&e.getAttribute('aria-label'))||(e.innerText||e.textContent)||'').replace(/\\s+/g,' ').trim();

    const btnDeadline=Date.now()+10000;
    let signInBtn=null;
    while(Date.now()<btnDeadline){
      signInBtn=deep('ul > li > button',document,[]).find(b=>/Sign in/i.test(itext(b)));
      if(!signInBtn) signInBtn=deep('button,[role=button]',document,[]).find(b=>/Sign in/i.test(itext(b)));
      if(signInBtn) break;
      await wait(400);
    }
    if(!signInBtn) return JSON.stringify({ok:false, reason:'Sign in button not found after 10s', buttons:deep('button,[role=button]',document,[]).map(itext).filter(Boolean).slice(0,20)});
    click(signInBtn);
    await wait(500);

    ${clickEmailLink ? `
    const emailDeadline=Date.now()+8000;
    let emailLink=null;
    while(Date.now()<emailDeadline){
      emailLink=deep('a',document,[]).find(a=>/or sign in with email/i.test(itext(a)));
      if(emailLink) break;
      await wait(300);
    }
    if(!emailLink) return JSON.stringify({ok:false, reason:'"or sign in with email" link not found', anchors:deep('a',document,[]).map(itext).filter(Boolean).slice(0,20)});
    click(emailLink);
    return JSON.stringify({ok:true, clicked:'sign-in-button+email-link'});
    ` : `
    return JSON.stringify({ok:true, clicked:'sign-in-button'});
    `}
  })()`;
}


export async function configureAxeSettings(opts: ConfigureSettingsOptions) {
  const cdp = await CDP.connect(opts.endpoint);
  try {
    const panel = await panelTarget(cdp);
    if (!panel) return { ok: false, reason: "axe panel target not found" };
    const session = await cdp.attach(panel.targetId);
    const result = await cdp
      .evalIn(session, settingsExpr(opts.serverUrl))
      .then((s) => (typeof s === "string" ? JSON.parse(s) : s))
      .catch((e) => ({ ok: false, error: e.message }));
    await cdp.detach(session);
    return result;
  } finally {
    cdp.close();
  }
}

function settingsExpr(serverUrl: string) {
  return `(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const click=el=>['mousedown','mouseup','click'].forEach(t=>el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})));

    const menuTrigger=document.querySelector('#menu-trigger2');
    if(!menuTrigger) return JSON.stringify({ok:false, reason:'#menu-trigger2 not found'});
    click(menuTrigger);
    await wait(600);

    const settingsItem=document.querySelector('#action-list-item4');
    if(!settingsItem) return JSON.stringify({ok:false, reason:'#action-list-item4 not found'});
    click(settingsItem);
    await wait(800);

    const defaultCheckbox=document.querySelector('#settings-user-default-settings');
    if(defaultCheckbox && defaultCheckbox.checked) {
      click(defaultCheckbox);
      await wait(300);
    }

    const serverInput=document.querySelector('#settings-axe-server-url');
    if(!serverInput) return JSON.stringify({ok:false, reason:'#settings-axe-server-url not found', defaultCheckboxFound:!!defaultCheckbox});
    serverInput.focus();
    serverInput.value=${JSON.stringify(serverUrl)};
    serverInput.dispatchEvent(new Event('input',{bubbles:true}));
    serverInput.dispatchEvent(new Event('change',{bubbles:true}));
    await wait(300);

    const saveButton=document.querySelector('#save-button');
    if(!saveButton) return JSON.stringify({ok:false, reason:'#save-button not found'});
    click(saveButton);
    await wait(1000);

    return JSON.stringify({ok:true, serverUrl:${JSON.stringify(serverUrl)}});
  })()`;
}

function loginExpr(email: string, password: string) {
  return `(async()=>{${DEEP}
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const text=e=>((e.getAttribute&&e.getAttribute('aria-label'))||e.placeholder||e.textContent||'').replace(/\\s+/g,' ').trim();
    const fire=el=>['input','change'].forEach(t=>el.dispatchEvent(new Event(t,{bubbles:true})));
    const click=el=>['mousedown','mouseup','click'].forEach(t=>el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})));
    const setField=async(el,value)=>{
      const setter=(el instanceof HTMLTextAreaElement
        ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')?.set
        : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set);
      for(let i=0;i<4;i++){
        el.focus();
        try{el.click();}catch(_){}
        if(typeof el.select==='function') { try{el.select();}catch(_){} }
        if(setter) setter.call(el,''); else el.value='';
        fire(el);
        await wait(80);
        if(setter) setter.call(el,value); else el.value=value;
        fire(el);
        await wait(150);
        if(el.value===value) return true;
      }
      return false;
    };
    const buttons=()=>deep('button,[role=button],a',document,[]);
    const buttonByText=rx=>buttons().find(e=>rx.test(text(e)));
    const start=buttonByText(/log\\s*in|sign\\s*in|connect|account/i);
    if(start){ click(start); await wait(1200); }
    const inputs=deep('input,textarea',document,[]);
    const emailInput=inputs.find(e=>/(email|user|login)/i.test([e.type,e.name,e.id,e.placeholder,text(e)].join(' '))) || inputs.find(e=>e.type==='email') || inputs[0];
    const passInput=inputs.find(e=>e.type==='password'||/(password|pass)/i.test([e.name,e.id,e.placeholder,text(e)].join(' ')));
    if(!emailInput || !passInput) return JSON.stringify({ok:false, reason:'email/password inputs not found', inputs:inputs.map(e=>({type:e.type,name:e.name,id:e.id,placeholder:e.placeholder})).slice(0,20), buttons:[...new Set(buttons().map(text).filter(Boolean))].slice(0,20)});
    const emailOk=await setField(emailInput,${JSON.stringify(email)});
    const passOk=await setField(passInput,${JSON.stringify(password)});
    if(!emailOk || !passOk) return JSON.stringify({
      ok:false,
      reason:'credential field verification failed',
      emailOk,
      passOk,
      emailLength:(emailInput.value||'').length,
      passwordLength:(passInput.value||'').length
    });
    const submit=buttonByText(/log\\s*in|sign\\s*in|submit|continue/i) || deep('button,[type=submit]',document,[])[0];
    if(!submit) return JSON.stringify({ok:false, reason:'submit button not found'});
    click(submit);
    return JSON.stringify({ok:true, clicked:text(submit), emailOk, passOk});
  })()`;
}
