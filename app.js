(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const cfg = window.COLORME_CONFIG || {};
  let db = null, user = null, clients = [], selected = null, recognition = null;

  const say = (id, text) => { $(id).textContent = text || ""; };
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));

  function showNotice(text) { $("notice").hidden = !text; $("notice").textContent = text || ""; }

  async function init() {
    if (!window.supabase) return showNotice("Nu s-a încărcat biblioteca Supabase. Verifică internetul și reîncarcă pagina.");
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || cfg.supabaseAnonKey.includes("PUNE_AICI")) {
      return showNotice("Mai trebuie introdusă cheia publică Supabase în fișierul config.js.");
    }
    db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    db.auth.onAuthStateChange((_event, session) => setTimeout(() => handleSession(session), 0));
    const { data, error } = await db.auth.getSession();
    if (error) showNotice("Eroare de autentificare: " + error.message);
    await handleSession(data?.session || null);
  }

  async function handleSession(session) {
    user = session?.user || null;
    $("auth").hidden = !!user;
    $("app").hidden = !user;
    $("logout").hidden = !user;
    if (user) await loadClients();
  }

  $("login").addEventListener("submit", async event => {
    event.preventDefault();
    say("authmsg", "Se autentifică…");
    const { error } = await db.auth.signInWithPassword({
      email: $("email").value.trim(), password: $("password").value
    });
    say("authmsg", error ? error.message : "Autentificare reușită.");
  });

  $("signup").addEventListener("click", async () => {
    const email = $("email").value.trim(), password = $("password").value;
    if (!email || password.length < 6) return say("authmsg", "Introdu emailul și o parolă de minimum 6 caractere.");
    const { data, error } = await db.auth.signUp({ email, password });
    say("authmsg", error ? error.message : (data.session ? "Cont creat. Ești autentificat." : "Cont creat. Verifică emailul dacă ți se cere confirmarea."));
  });

  $("logout").addEventListener("click", async () => { await db.auth.signOut(); });

  async function loadClients(keepId) {
    say("state", "Se sincronizează…");
    const { data, error } = await db.from("client").select("id,nume,formula,user_id").order("nume");
    if (error) {
      say("state", "Eroare de sincronizare");
      showNotice("Nu pot încărca clienții: " + error.message);
      return;
    }
    showNotice("");
    clients = data || [];
    selected = clients.find(c => String(c.id) === String(keepId ?? selected?.id)) || null;
    renderClients();
    renderDetail();
    say("state", "Sincronizat cu Supabase");
  }

  function renderClients() {
    const query = $("search").value.trim().toLocaleLowerCase("ro");
    const visible = clients.filter(c => (c.nume || "").toLocaleLowerCase("ro").includes(query));
    $("clients").innerHTML = visible.map(c =>
      `<button type="button" class="client-item ${selected && String(c.id) === String(selected.id) ? "active" : ""}" data-id="${escapeHtml(c.id)}">${escapeHtml(c.nume)}</button>`
    ).join("");
    $("clients").querySelectorAll("[data-id]").forEach(button => {
      button.addEventListener("click", () => selectClient(button.dataset.id));
    });
  }

  async function selectClient(id) {
    selected = clients.find(c => String(c.id) === String(id)) || null;
    renderClients();
    renderDetail();
    say("formmsg", "");
  }

  function renderDetail() {
    $("empty").hidden = !!selected;
    $("detail").hidden = !selected;
    if (!selected) return;
    $("chosen").textContent = selected.nume;
    $("formula").value = selected.formula || "";
    $("formulaform").dataset.clientId = selected.id;
  }

  $("newclient").addEventListener("submit", async event => {
    event.preventDefault();
    const name = $("clientname").value.trim();
    if (!name) return;
    const button = event.submitter;
    button.disabled = true;
    say("clientmsg", "");
    const { data, error } = await db.from("client")
      .insert({ nume: name, user_id: user.id, formula: "" })
      .select("id").single();
    button.disabled = false;
    if (error) return say("clientmsg", "Nu am putut adăuga clientul: " + error.message);
    $("clientname").value = "";
    await loadClients(data.id);
    $("formula").focus();
  });

  $("search").addEventListener("input", renderClients);

  $("formulaform").addEventListener("submit", async event => {
    event.preventDefault();
    if (!selected) return;
    const formula = $("formula").value.trim();
    if (!formula) return say("formmsg", "Scrie sau dictează formula înainte de salvare.");
    const button = event.submitter;
    button.disabled = true;
    say("formmsg", "Se salvează…");
    const { data, error } = await db.from("client")
      .update({ formula })
      .eq("id", selected.id)
      .select("id,nume,formula,user_id").single();
    button.disabled = false;
    if (error) return say("formmsg", "Nu s-a salvat formula: " + error.message);
    selected = data;
    clients = clients.map(c => String(c.id) === String(data.id) ? data : c);
    renderClients();
    say("formmsg", "Formula a fost salvată.");
    say("state", "Sincronizat cu Supabase");
  });

  $("deleteclient").addEventListener("click", async () => {
    if (!selected || !confirm(`Ștergi clientul „${selected.nume}”?`)) return;
    const { error } = await db.from("client").delete().eq("id", selected.id);
    if (error) return say("formmsg", "Nu am putut șterge clientul: " + error.message);
    selected = null;
    await loadClients();
  });

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    $("voice").disabled = true;
    $("voicestatus").textContent = "Dictarea vocală nu este disponibilă în acest browser. Încearcă Chrome.";
  } else {
    recognition = new SpeechRecognition();
    recognition.lang = "ro-RO";
    recognition.continuous = true;
    recognition.interimResults = true;
    let finalText = "";
    recognition.onstart = () => {
      finalText = $("formula").value.trim();
      $("voice").hidden = true;
      $("stopvoice").hidden = false;
      say("voicestatus", "Ascult… vorbește în română.");
    };
       recognition.onresult = event => {
      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;

        if (result.isFinal) {
          finalText += (finalText ? " " : "") + text;
        } else {
          interim += text;
        }
      }

      $("formula").value = [finalText, interim].filter(Boolean).join(" ");
    };
    recognition.onerror = event => say("voicestatus", event.error === "not-allowed" ? "Permite accesul la microfon în Chrome." : "Eroare de dictare: " + event.error);
    recognition.onend = () => {
      $("voice").hidden = false;
      $("stopvoice").hidden = true;
      if (!$("voicestatus").textContent.startsWith("Eroare") && !$("voicestatus").textContent.includes("Permite")) say("voicestatus", "Dictare încheiată. Verifică textul și apasă Salvează formula.");
    };
    $("voice").addEventListener("click", () => {
      if (!selected) return say("voicestatus", "Selectează mai întâi un client.");
      try { recognition.start(); } catch (_) { say("voicestatus", "Dictarea este deja pornită."); }
    });
    $("stopvoice").addEventListener("click", () => recognition.stop());
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
  init();
})();
