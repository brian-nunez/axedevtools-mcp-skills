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

    // Wait for the new login page to open (new page target)
    const deadline = Date.now() + 15_000;
    let loginPage: TargetInfo | null = null;
    while (Date.now() < deadline) {
      const targets = await cdp.targets();
      loginPage = targets.find((t) => t.type === "page" && !existingIds.has(t.targetId)) ?? null;
      if (loginPage) break;
      await sleep(300);
    }
    if (!loginPage) return { ok: false, reason: "login page did not open", clickResult };

    // Attach first, then use Page.bringToFront through the session — this is
    // what actually gives the page OS-level focus in a headless/VNC environment
    const loginSession = await cdp.attach(loginPage.targetId);
    await cdp.send("Page.bringToFront", {}, loginSession);
    await sleep(2000);

    // Helper: bring page to front + JS focus + repeated mouse clicks before typing
    const focusField = async (selector: string) => {
      await cdp.send("Page.bringToFront", {}, loginSession);
      await sleep(300);
      const rect = await cdp
        .evalIn(loginSession, `(async()=>{
          const wait=ms=>new Promise(r=>setTimeout(r,ms));
          const deadline=Date.now()+15000;
          while(Date.now()<deadline){
            const el=document.querySelector(${JSON.stringify(selector)});
            if(el && el.getBoundingClientRect().width>0){
              el.focus();
              const r=el.getBoundingClientRect();
              return {x:r.left+r.width/2,y:r.top+r.height/2};
            }
            await wait(300);
          }
          return null;
        })()`)
        .catch(() => null);
      if (!rect) return null;
      for (let i = 0; i < 3; i++) {
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", x: rect.x, y: rect.y, clickCount: 1 }, loginSession);
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", x: rect.x, y: rect.y, clickCount: 1 }, loginSession);
        await sleep(150);
      }
      // JS focus again after the clicks to make sure it took
      await cdp.evalIn(loginSession, `(()=>{
        const el=document.querySelector(${JSON.stringify(selector)});
        if(el){el.focus();el.click();}
      })()`).catch(() => {});
      await sleep(300);
      return rect;
    };

    // Focus #username and type email
    const usernameRect = await focusField("#username");
    if (!usernameRect) {
      await cdp.detach(loginSession);
      return { ok: false, reason: "#username not found", clickResult };
    }
    await sleep(2000);
    for (const ch of opts.email) {
      await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch, unmodifiedText: ch }, loginSession);
      await sleep(50);
    }
    await sleep(1000);

    // Click Next via CDP mouse event
    const nextRect = await cdp
      .evalIn(loginSession, `(()=>{
        const text=e=>((e.innerText||e.textContent)||'').replace(/\\s+/g,' ').trim();
        const btn=[...document.querySelectorAll('button[type="submit"]')].find(b=>/Next/i.test(text(b)));
        if(!btn) return null;
        const r=btn.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};
      })()`)
      .catch(() => null);
    if (!nextRect) {
      await cdp.detach(loginSession);
      return { ok: false, reason: "Next button not found", clickResult };
    }
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", x: nextRect.x, y: nextRect.y, clickCount: 1 }, loginSession);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", x: nextRect.x, y: nextRect.y, clickCount: 1 }, loginSession);
    await sleep(1000);

    // Focus #password and type password
    const passwordRect = await focusField("#password");
    if (!passwordRect) {
      await cdp.detach(loginSession);
      return { ok: false, reason: "#password not found", clickResult };
    }
    await sleep(2000);
    for (const ch of opts.password) {
      await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch, unmodifiedText: ch }, loginSession);
      await sleep(50);
    }
    await sleep(1000);

    // Click Submit via CDP mouse event
    const submitRect = await cdp
      .evalIn(loginSession, `(()=>{
        const text=e=>((e.innerText||e.textContent)||'').replace(/\\s+/g,' ').trim();
        const btn=[...document.querySelectorAll('button[type="submit"]')].find(b=>/Submit/i.test(text(b)));
        if(!btn) return null;
        const r=btn.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};
      })()`)
      .catch(() => null);
    const submitClicked = !!submitRect;
    if (submitRect) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", x: submitRect.x, y: submitRect.y, clickCount: 1 }, loginSession);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", x: submitRect.x, y: submitRect.y, clickCount: 1 }, loginSession);
    }

    await cdp.detach(loginSession);
    return { ok: !!submitClicked, onPrem, clickResult, submitClicked };
  } finally {
    cdp.close();
  }
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
