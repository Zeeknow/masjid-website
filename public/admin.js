const $ = (selector) => document.querySelector(selector);
let site = null;
const DEFAULT_MANUAL_TIMES = { Fajr: "05:26", Dhuhr: "12:48", Asr: "16:12", Maghrib: "19:03", Isha: "20:18" };

function message(selector, text, type = "") {
  const target = $(selector);
  target.textContent = text;
  target.className = type ? `form-message ${type}` : "form-message";
}

function value(id, content) {
  $(id).value = content ?? "";
}

function setLoggedIn(loggedIn, username = "") {
  $("#login-panel").hidden = loggedIn;
  $("#dashboard").hidden = !loggedIn;
  if (loggedIn) $("#dashboard-welcome").textContent = `Signed in as ${username}. Changes publish immediately.`;
}

function field(label, className, type = "text") {
  const wrapper = document.createElement("label");
  wrapper.className = className || "";
  wrapper.textContent = label;
  const input = document.createElement(type === "textarea" ? "textarea" : "input");
  if (type !== "textarea") input.type = type;
  if (type === "textarea") input.rows = 3;
  wrapper.append(input);
  return { wrapper, input };
}

function renderAnnouncements() {
  const editor = $("#announcement-editor");
  editor.replaceChildren();
  site.announcements.forEach((announcement, index) => {
    const row = document.createElement("article");
    row.className = "editor-item";
    row.dataset.index = index;
    const top = document.createElement("div");
    top.className = "editor-item-top";
    const heading = document.createElement("strong");
    heading.textContent = `Announcement ${index + 1}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-announcement";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      site.announcements.splice(index, 1);
      renderAnnouncements();
    });
    top.append(heading, remove);
    const fields = document.createElement("div");
    fields.className = "editor-fields";
    const title = field("Headline", "", "text");
    title.input.value = announcement.title || "";
    title.input.dataset.field = "title";
    const date = field("Date / label", "", "text");
    date.input.value = announcement.date?.trim().toLowerCase() === "community update" ? "Announcement" : announcement.date || "";
    date.input.dataset.field = "date";
    const featured = field("Feature on homepage", "", "checkbox");
    featured.input.checked = Boolean(announcement.featured);
    featured.input.dataset.field = "featured";
    const body = field("Details", "editor-body", "textarea");
    body.input.value = announcement.body || "";
    body.input.dataset.field = "body";
    fields.append(title.wrapper, date.wrapper, featured.wrapper, body.wrapper);
    fields.addEventListener("input", (event) => {
      const input = event.target;
      if (!input.dataset.field) return;
      site.announcements[index][input.dataset.field] = input.type === "checkbox" ? input.checked : input.value;
    });
    fields.addEventListener("change", (event) => {
      const input = event.target;
      if (input.type === "checkbox") site.announcements[index][input.dataset.field] = input.checked;
    });
    row.append(top, fields);
    editor.append(row);
  });
}

function populateForm() {
  value("#identity-name", site.identity.name);
  value("#identity-organization", site.identity.organization);
  value("#identity-tagline", site.identity.tagline);
  value("#identity-intro", site.identity.intro);
  const manualTimes = { ...DEFAULT_MANUAL_TIMES, ...(site.prayerLocation.manualTimes || {}) };
  value("#prayer-mode", site.prayerLocation.mode || "manual");
  value("#manual-fajr", manualTimes.Fajr);
  value("#manual-dhuhr", manualTimes.Dhuhr);
  value("#manual-asr", manualTimes.Asr);
  value("#manual-maghrib", manualTimes.Maghrib);
  value("#manual-isha", manualTimes.Isha);
  value("#prayer-city", site.prayerLocation.city);
  value("#prayer-country", site.prayerLocation.country);
  value("#prayer-method", site.prayerLocation.calculationMethod);
  value("#prayer-note", site.prayerLocation.note);
  value("#contact-address", site.contact.address);
  value("#contact-address-note", site.contact.addressNote);
  value("#contact-phone", site.contact.phone);
  value("#contact-email", site.contact.email);
  value("#contact-maps", site.contact.mapsUrl);
  value("#donation-zakat", site.donations.zakat);
  value("#donation-sadaqah", site.donations.sadaqah);
  value("#donation-general", site.donations.general);
  value("#donation-monthly", site.donations.monthly);
  value("#donation-note", site.donations.note);
  value("#social-whatsapp", site.social.whatsapp);
  value("#social-instagram", site.social.instagram);
  value("#social-facebook", site.social.facebook);
  renderAnnouncements();
}

function buildSiteFromForm() {
  site.identity = {
    name: $("#identity-name").value.trim(),
    organization: $("#identity-organization").value.trim(),
    tagline: $("#identity-tagline").value.trim(),
    intro: $("#identity-intro").value.trim()
  };
  site.prayerLocation = {
    mode: $("#prayer-mode").value,
    city: $("#prayer-city").value.trim(),
    country: $("#prayer-country").value.trim(),
    calculationMethod: Number($("#prayer-method").value),
    note: $("#prayer-note").value.trim(),
    manualTimes: {
      Fajr: $("#manual-fajr").value,
      Dhuhr: $("#manual-dhuhr").value,
      Asr: $("#manual-asr").value,
      Maghrib: $("#manual-maghrib").value,
      Isha: $("#manual-isha").value
    }
  };
  site.contact = {
    address: $("#contact-address").value.trim(),
    addressNote: $("#contact-address-note").value.trim(),
    phone: $("#contact-phone").value.trim(),
    email: $("#contact-email").value.trim(),
    mapsUrl: $("#contact-maps").value.trim()
  };
  site.donations = {
    zakat: $("#donation-zakat").value.trim(),
    sadaqah: $("#donation-sadaqah").value.trim(),
    general: $("#donation-general").value.trim(),
    monthly: $("#donation-monthly").value.trim(),
    note: $("#donation-note").value.trim()
  };
  site.social = {
    whatsapp: $("#social-whatsapp").value.trim(),
    instagram: $("#social-instagram").value.trim(),
    facebook: $("#social-facebook").value.trim()
  };
  return site;
}

async function getSite() {
  const response = await fetch("/api/site");
  if (!response.ok) throw new Error("Could not load website settings.");
  site = await response.json();
}

async function submitLogin(event) {
  event.preventDefault();
  message("#login-message", "Signing in...");
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: $("#login-username").value, password: $("#login-password").value })
  });
  const data = await response.json();
  if (!response.ok) {
    message("#login-message", data.error || "Sign-in failed.");
    return;
  }
  await getSite();
  populateForm();
  setLoggedIn(true, data.username);
  $("#login-password").value = "";
}

async function saveSite(event) {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  message("#save-message", "Saving changes...");
  try {
    const response = await fetch("/api/site", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSiteFromForm())
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save changes.");
    site = data;
    message("#save-message", "Saved and published. Your website now has the new information.", "success");
  } catch (error) {
    message("#save-message", error.message);
  } finally {
    submit.disabled = false;
  }
}

function downloadBackup() {
  const file = new Blob([JSON.stringify(buildSiteFromForm(), null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = `masjid-ar-rahman-content-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function logout() {
  await fetch("/api/logout", { method: "POST" });
  setLoggedIn(false);
  message("#login-message", "You have been signed out.", "success");
}

async function initialize() {
  $("#login-form").addEventListener("submit", submitLogin);
  $("#settings-form").addEventListener("submit", saveSite);
  $("#add-announcement").addEventListener("click", () => {
    site.announcements.push({ title: "New announcement", date: "Announcement", body: "Add the announcement details here.", featured: false });
    renderAnnouncements();
  });
  $("#download-backup").addEventListener("click", downloadBackup);
  $("#logout").addEventListener("click", logout);
  try {
    const session = await (await fetch("/api/session")).json();
    if (session.authenticated) {
      await getSite();
      populateForm();
      setLoggedIn(true, session.username);
    }
  } catch {
    message("#login-message", "The dashboard is unavailable. Check that the website server is running.");
  }
}

initialize();
