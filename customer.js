/* Cuenta cliente opcional para Reymero 3D.
   Permite registro/login, perfil básico y consulta de pedidos propios. */
(function () {
  "use strict";

  const STYLE_ID = "rmCustomerStyles";
  let sb = null;
  let modal = null, backdrop = null, bodyEl = null, statusEl = null;
  let currentUser = null;
  let profile = null;
  const listeners = [];

  function getSb() {
    if (sb) return sb;
    const cfg = window.ReymeroConfig || {};
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return sb;
  }

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
  function money(n){ const v=Number(n); return "$ " + (Number.isFinite(v)?v:0).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function fmtDate(v){ const d=new Date(v); return isNaN(d)?"-":d.toLocaleString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}); }
  const STATUS = { pending:"Pendiente", confirmed:"Confirmado", preparing:"En preparación", ready:"Listo para entregar", delivered:"Entregado", cancelled:"Cancelado" };

  function emit() { listeners.slice().forEach(fn => { try { fn({ user: currentUser, profile }); } catch(e){} }); }

  async function loadProfile() {
    profile = null;
    if (!currentUser) return null;
    const { data } = await getSb().from("customer_profiles").select("*").eq("user_id", currentUser.id).maybeSingle();
    profile = data || null;
    return profile;
  }

  async function saveProfile(data) {
    if (!currentUser) return { error: { message: "No hay sesión" } };
    const payload = {
      user_id: currentUser.id,
      full_name: String(data.full_name || "").trim(),
      phone: String(data.phone || "").trim(),
      email: String(data.email || currentUser.email || "").trim() || null,
      province: String(data.province || "").trim() || null,
      city: String(data.city || "").trim() || null,
      address: String(data.address || "").trim() || null,
      postal_code: String(data.postal_code || "").trim() || null,
      extra_references: String(data.extra_references || "").trim() || null
    };
    const { data: row, error } = await getSb().from("customer_profiles").upsert(payload, { onConflict: "user_id" }).select("*").single();
    if (!error) profile = row;
    return { data: row, error };
  }

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style"); s.id = STYLE_ID;
    s.textContent = `
      .rm-cust-back{position:fixed;inset:0;background:rgba(28,25,23,.55);z-index:75;display:none}.rm-cust-back.open{display:block}
      .rm-cust{position:fixed;inset:1rem;margin:auto;max-width:720px;max-height:calc(100vh - 2rem);overflow:auto;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-lg);z-index:76;display:none}
      .rm-cust.open{display:block}
      .rm-cust-head{display:flex;justify-content:space-between;gap:1rem;padding:1rem 1.25rem;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface)}
      .rm-cust-head h2{margin:0;font-family:"Fraunces",serif;font-size:1.3rem}
      .rm-cust-body{padding:1.25rem;display:grid;gap:1rem}
      .rm-cust-box{border:1px solid var(--border);border-radius:10px;padding:1rem;background:var(--surface-2)}
      .rm-cust-box h3{margin:0 0 .7rem;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
      .rm-cust input{width:100%;padding:.65rem .75rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font:inherit;margin-top:.25rem}
      .rm-cust label{display:block;font-size:.75rem;color:var(--muted);margin-top:.6rem}
      .rm-cust .row{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.8rem}
      .rm-cust button,.rm-cust-btn{padding:.65rem .9rem;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font:inherit;cursor:pointer}
      .rm-cust .primary{background:var(--accent);border-color:var(--accent);color:#fff;font-family:"JetBrains Mono",monospace;font-size:.72rem;font-weight:700;text-transform:uppercase}
      .rm-cust .muted{font-size:.78rem;color:var(--muted);line-height:1.45}
      .rm-cust-order{padding:.75rem 0;border-bottom:1px solid var(--border)}
      .rm-cust-order:last-child{border-bottom:0}
      .rm-cust-badge{display:inline-block;padding:.15rem .5rem;border-radius:99px;font-size:.66rem;font-weight:700;background:var(--accent-soft);color:var(--accent)}
    `;
    document.head.appendChild(s);
  }

  function ensureModal() {
    if (modal) return;
    css();
    backdrop = document.createElement("div"); backdrop.className = "rm-cust-back";
    modal = document.createElement("div"); modal.className = "rm-cust"; modal.setAttribute("role","dialog"); modal.setAttribute("aria-modal","true");
    modal.innerHTML = `<div class="rm-cust-head"><h2 id="rmCustTitle">Mi cuenta</h2><button type="button" id="rmCustClose">Cerrar</button></div><div class="rm-cust-body" id="rmCustBody"></div>`;
    document.body.appendChild(backdrop); document.body.appendChild(modal);
    bodyEl = modal.querySelector("#rmCustBody");
    modal.querySelector("#rmCustClose").addEventListener("click", close);
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", e => { if (e.key === "Escape" && modal.classList.contains("open")) close(); });
  }

  function open(view) { ensureModal(); modal.classList.add("open"); backdrop.classList.add("open"); render(view || (currentUser ? "account" : "login")); }
  function close() { if (!modal) return; modal.classList.remove("open"); backdrop.classList.remove("open"); }

  function setStatus(msg, err) { if (statusEl) { statusEl.textContent = msg || ""; statusEl.style.color = err ? "var(--accent)" : "var(--muted)"; } }

  async function render(view) {
    ensureModal();
    if (!currentUser) view = (view === "register") ? "register" : "login";
    if (view === "login" || view === "register") {
      const isReg = view === "register";
      bodyEl.innerHTML = `
        <div class="rm-cust-box">
          <h3>${isReg ? "Crear cuenta" : "Ingresar"}</h3>
          <p class="muted">Opcional. Con cuenta podés guardar tus datos y ver tus pedidos. También podés comprar como invitado.</p>
          <label>Email<input id="rmCustEmail" type="email" autocomplete="email"></label>
          <label>Contraseña<input id="rmCustPass" type="password" autocomplete="${isReg?"new-password":"current-password"}"></label>
          <div class="row">
            <button class="primary" id="rmCustSubmit" type="button">${isReg?"Crear cuenta":"Ingresar"}</button>
            <button type="button" id="rmCustToggle">${isReg?"Ya tengo cuenta":"Crear cuenta"}</button>
          </div>
          <p class="muted" id="rmCustStatus" style="margin-top:.75rem;"></p>
        </div>`;
      statusEl = bodyEl.querySelector("#rmCustStatus");
      bodyEl.querySelector("#rmCustToggle").onclick = () => render(isReg ? "login" : "register");
      bodyEl.querySelector("#rmCustSubmit").onclick = async () => {
        const email = bodyEl.querySelector("#rmCustEmail").value.trim();
        const password = bodyEl.querySelector("#rmCustPass").value;
        if (!email || !password) return setStatus("Completá email y contraseña.", true);
        setStatus(isReg ? "Creando cuenta..." : "Ingresando...");
        const fn = isReg ? getSb().auth.signUp({ email, password }) : getSb().auth.signInWithPassword({ email, password });
        const { data, error } = await fn;
        if (error) return setStatus(error.message, true);
        if (isReg && data && data.user && !data.session) { setStatus("Cuenta creada. Revisá tu email para confirmar el acceso, si tu proyecto lo requiere.", false); return; }
        await refresh();
        render("account");
      };
      return;
    }

    if (view === "account") {
      await loadProfile();
      const p = profile || {};
      bodyEl.innerHTML = `
        <div class="rm-cust-box">
          <h3>Sesión</h3>
          <p class="muted">Ingresaste como <strong>${esc(currentUser.email||"")}</strong></p>
          <div class="row"><button type="button" id="rmCustOrders">Mis pedidos</button><button type="button" id="rmCustLogout">Cerrar sesión</button></div>
        </div>
        <div class="rm-cust-box">
          <h3>Datos para autocompletar</h3>
          <p class="muted">Se usan solo para completar el checkout. Podés comprar como invitado si preferís.</p>
          <label>Nombre y apellido<input id="pName" value="${esc(p.full_name||"")}"></label>
          <label>Teléfono<input id="pPhone" value="${esc(p.phone||"")}"></label>
          <label>Email<input id="pEmail" type="email" value="${esc(p.email||currentUser.email||"")}"></label>
          <label>Provincia<input id="pProv" value="${esc(p.province||"")}"></label>
          <label>Localidad<input id="pCity" value="${esc(p.city||"")}"></label>
          <label>Dirección<input id="pAddr" value="${esc(p.address||"")}"></label>
          <label>Código postal<input id="pCp" value="${esc(p.postal_code||"")}"></label>
          <label>Referencias<input id="pRef" value="${esc(p.extra_references||"")}"></label>
          <div class="row"><button class="primary" id="rmCustSaveProfile" type="button">Guardar datos</button></div>
          <p class="muted" id="rmCustStatus" style="margin-top:.75rem;"></p>
        </div>`;
      statusEl = bodyEl.querySelector("#rmCustStatus");
      bodyEl.querySelector("#rmCustLogout").onclick = async () => { await getSb().auth.signOut(); await refresh(); close(); };
      bodyEl.querySelector("#rmCustOrders").onclick = () => render("orders");
      bodyEl.querySelector("#rmCustSaveProfile").onclick = async () => {
        setStatus("Guardando...");
        const { error } = await saveProfile({
          full_name: bodyEl.querySelector("#pName").value, phone: bodyEl.querySelector("#pPhone").value,
          email: bodyEl.querySelector("#pEmail").value, province: bodyEl.querySelector("#pProv").value,
          city: bodyEl.querySelector("#pCity").value, address: bodyEl.querySelector("#pAddr").value,
          postal_code: bodyEl.querySelector("#pCp").value, extra_references: bodyEl.querySelector("#pRef").value
        });
        setStatus(error ? error.message : "Datos guardados.", !!error);
        emit();
      };
      return;
    }

    if (view === "orders") {
      bodyEl.innerHTML = `<div class="rm-cust-box"><h3>Mis pedidos</h3><p class="muted" id="rmCustStatus">Cargando...</p><div id="rmCustOrdersList"></div><div class="row"><button type="button" id="rmCustBack">Volver</button></div></div>`;
      statusEl = bodyEl.querySelector("#rmCustStatus");
      bodyEl.querySelector("#rmCustBack").onclick = () => render("account");
      const { data, error } = await getSb().from("orders").select("id,order_number,status,total,created_at,delivery_method").order("created_at", { ascending: false }).limit(50);
      const list = bodyEl.querySelector("#rmCustOrdersList");
      if (error) { setStatus("No se pudieron cargar tus pedidos: " + error.message, true); return; }
      if (!data || !data.length) { setStatus("Todavía no tenés pedidos."); return; }
      setStatus("");
      list.innerHTML = data.map(o => `<div class="rm-cust-order"><div><strong>RM-${String(o.order_number).padStart(6,"0")}</strong> <span class="rm-cust-badge">${esc(STATUS[o.status]||o.status)}</span></div><div class="muted">${esc(fmtDate(o.created_at))} · ${esc(o.delivery_method==="pickup_agreed"?"Retiro acordado":"Envío")} · ${esc(money(o.total))}</div></div>`).join("");
    }
  }

  async function refresh() {
    const { data } = await getSb().auth.getSession();
    currentUser = data && data.session ? data.session.user : null;
    if (currentUser) await loadProfile(); else profile = null;
    emit();
    return { user: currentUser, profile };
  }

  window.ReymeroCustomer = {
    init: async function () { await refresh(); getSb().auth.onAuthStateChange(async () => { await refresh(); }); return { user: currentUser, profile }; },
    open: open,
    close: close,
    getUser: function () { return currentUser; },
    getProfile: function () { return profile; },
    saveProfile: saveProfile,
    refresh: refresh,
    subscribe: function (fn) { if (typeof fn === "function") listeners.push(fn); return () => { const i=listeners.indexOf(fn); if(i>=0) listeners.splice(i,1); }; }
  };
})();