const FALLBACK_TIMES = {
  Fajr: "5:26 AM",
  Dhuhr: "12:48 PM",
  Asr: "4:12 PM",
  Maghrib: "7:03 PM",
  Isha: "8:18 PM"
};

const $ = (selector) => document.querySelector(selector);
let site = null;
let prayerState = { timings: FALLBACK_TIMES, source: "draft", timezone: "America/New_York" };

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function isWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch { return false; }
}

function openNotice(title, body) {
  setText("#notice-title", title);
  setText("#notice-body", body);
  const dialog = $("#notice-dialog");
  if (!dialog.open) dialog.showModal();
}

function timeToMinutes(time) {
  const value = String(time);
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  let hours = Number(match[1]);
  const meridiem = value.match(/\b([ap])\.?m\.?\b/i)?.[1]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  return hours * 60 + Number(match[2]);
}

function formatPrayerTime(value) {
  const original = String(value);
  const parsed = original.match(/(\d{1,2}):(\d{2})/);
  if (!parsed) return "--";
  let hours = Number(parsed[1]);
  const minutes = parsed[2];
  const suppliedMeridiem = original.match(/\b([ap])\.?m\.?\b/i)?.[1]?.toUpperCase();
  const suffix = suppliedMeridiem || (hours >= 12 ? "PM" : "AM");
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${suffix}`;
}

function locationMinutes(timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || undefined,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === "hour")?.value || 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value || 0);
}

function getNextPrayer(timings, timezone) {
  const ordered = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
  const now = locationMinutes(timezone);
  const next = ordered.find((name) => timeToMinutes(timings[name]) > now) || "Fajr";
  const target = timeToMinutes(timings[next]);
  const minutesAway = target > now ? target - now : target + 1440 - now;
  const hours = Math.floor(minutesAway / 60);
  return { name: next, time: timings[next], countdown: hours ? `${hours} hr ${minutesAway % 60} min remaining` : `${minutesAway} min remaining` };
}

function renderPrayerTimes() {
  const next = getNextPrayer(prayerState.timings, prayerState.timezone);
  const grid = $("#prayer-grid");
  grid.replaceChildren();
  Object.entries(prayerState.timings).forEach(([name, value]) => {
    const card = document.createElement("article");
    card.className = `prayer-card${name === next.name ? " next" : ""}`;
    const label = document.createElement("p");
    label.textContent = name === "Dhuhr" ? "Dhuhr / Zuhr" : name;
    const time = document.createElement("strong");
    time.textContent = formatPrayerTime(value);
    const status = document.createElement("small");
    status.textContent = name === next.name ? "Next prayer" : "Daily salah";
    card.append(label, time, status);
    grid.append(card);
  });
  setText("#next-prayer-name", next.name);
  setText("#next-prayer-time", formatPrayerTime(next.time));
  setText("#next-prayer-countdown", next.countdown);
  renderJumuahNotice();
}

function renderJumuahNotice() {
  const notice = $("#jumuah-notice");
  if (!notice) return;
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: prayerState.timezone || undefined,
    weekday: "long"
  }).format(new Date());
  notice.hidden = weekday !== "Friday";
  if (notice.hidden) return;
  const time = site.jumuah?.time?.trim();
  setText("#jumuah-time", time ? formatPrayerTime(time) : "Time to be announced");
  setText("#jumuah-note", site.jumuah?.note?.trim() || "Every Friday");
}

async function fetchPrayerTimes() {
  const { city, country, calculationMethod, mode, note, manualTimes } = site.prayerLocation;
  const useManualSchedule = mode !== "automatic";
  const savedTimes = { ...FALLBACK_TIMES, ...(manualTimes || {}) };
  setText("#location-label", useManualSchedule ? "Masjid-managed schedule" : `${city}, ${country}`);
  if (useManualSchedule) {
    prayerState = { timings: savedTimes, source: "manual", timezone: "America/New_York" };
    renderPrayerTimes();
    setText("#prayer-note", note || "These prayer times are entered by the masjid. Check the latest schedule before travelling.");
    return;
  }
  const cityIsUnconfirmed = String(city).toLowerCase() === "massachusetts";
  if (cityIsUnconfirmed) {
    prayerState = { timings: savedTimes, source: "draft", timezone: "America/New_York" };
    renderPrayerTimes();
    setText("#prayer-note", "Add the precise city before turning on automatic prayer times. The manually entered masjid schedule is shown for now.");
    return;
  }
  try {
    const endpoint = new URL("https://api.aladhan.com/v1/timingsByCity");
    endpoint.searchParams.set("city", city);
    endpoint.searchParams.set("country", country);
    endpoint.searchParams.set("method", String(calculationMethod || 2));
    const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Prayer-time service is unavailable.");
    const payload = await response.json();
    const timings = Object.fromEntries(["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"].map((name) => [name, payload.data.timings[name]]));
    prayerState = { timings, source: "live", timezone: payload.data.meta.timezone };
    renderPrayerTimes();
    setText("#prayer-note", `Live times for ${city}, ${country}. Calculation method ${payload.data.meta.method.name}. Please confirm local masjid iqamah times separately.`);
  } catch {
    prayerState = { timings: savedTimes, source: "draft", timezone: "America/New_York" };
    renderPrayerTimes();
    setText("#prayer-note", "Live prayer times are temporarily unavailable. Please check with the masjid before travelling.");
  }
}

function renderAnnouncements() {
  const container = $("#announcements");
  container.replaceChildren();
  site.announcements.forEach((announcement, index) => {
    const article = document.createElement("article");
    article.className = `announcement-card${announcement.featured || index === 0 ? " featured" : ""}`;
    const date = document.createElement("p");
    date.className = "date";
    const announcementDate = announcement.date?.trim().toLowerCase() === "community update" ? "Announcement" : announcement.date;
    date.textContent = announcementDate || "Announcement";
    const title = document.createElement("h3");
    title.textContent = announcement.title;
    const body = document.createElement("p");
    body.textContent = announcement.body;
    article.append(date, title, body);
    container.append(article);
  });
}

function wireExternalLink(id, url, fallbackTitle, fallbackBody) {
  const element = document.getElementById(id);
  if (!element) return;
  if (isWebUrl(url)) {
    element.href = url;
    element.target = "_blank";
    element.rel = "noreferrer";
  } else {
    element.href = "#contact";
    element.addEventListener("click", (event) => {
      event.preventDefault();
      openNotice(fallbackTitle, fallbackBody);
    });
  }
}

function applyContactAndSocial() {
  const { contact, social, donations, identity } = site;
  setText("#community-line", identity.organization);
  setText("#footer-organization", identity.organization);
  setText("#hero-intro", identity.intro);
  setText("#about-text", identity.intro);
  setText("#contact-address", contact.address + (contact.addressNote ? ` - ${contact.addressNote}` : ""));
  setText("#contact-phone", contact.phone || "Add a public phone number in the Admin Dashboard.");
  const email = $("#contact-email");
  if (contact.email) {
    email.textContent = contact.email;
    email.href = `mailto:${contact.email}`;
  }
  wireExternalLink("map-link", contact.mapsUrl, "Map link to be confirmed", "The exact address has not been added yet. Please contact the masjid before your first visit.");
  ["whatsapp", "instagram", "facebook"].forEach((network) => {
    const title = network[0].toUpperCase() + network.slice(1);
    const body = `The masjid’s ${title} link will be added by the administrator.`;
    wireExternalLink(`top-${network}`, social[network], `${title} coming soon`, body);
    wireExternalLink(`contact-${network}`, social[network], `${title} coming soon`, body);
  });
  document.querySelectorAll("[data-donation]").forEach((link) => {
    const type = link.dataset.donation;
    const label = type === "general" ? "General fund" : type[0].toUpperCase() + type.slice(1);
    if (isWebUrl(donations[type])) {
      link.href = donations[type];
      link.target = "_blank";
      link.rel = "noreferrer";
    } else {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        openNotice(`${label} giving`, donations.note || "The secure giving link is being prepared by the masjid team.");
      });
    }
  });
  setText("#donation-note", donations.note || "Donation links will be published once the masjid connects its preferred secure giving provider.");
}

async function loadSite() {
  const response = await fetch("/api/site");
  if (!response.ok) throw new Error("Website information could not be loaded.");
  site = await response.json();
  document.title = `${site.identity.name} | Prayer, learning and community`;
  renderAnnouncements();
  applyContactAndSocial();
  await fetchPrayerTimes();
}

function setupNavigation() {
  const toggle = $(".menu-toggle");
  const links = $("#nav-links");
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  links.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    links.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  }));
  $("#refresh-prayer-times").addEventListener("click", fetchPrayerTimes);
  setInterval(renderJumuahNotice, 60_000);
  $(".dialog-close").addEventListener("click", () => $("#notice-dialog").close());
  $("[data-close-dialog]").addEventListener("click", () => $("#notice-dialog").close());
  $("#year").textContent = new Date().getFullYear();
}

function setupHeroIntro() {
  const hero = $(".hero");
  const video = $(".hero-intro-video");
  if (!hero || !video) return;
  const revealHero = () => {
    hero.classList.remove("intro-pending");
    hero.classList.add("intro-complete");
    video.pause();
  };
  hero.classList.add("intro-pending");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    revealHero();
    return;
  }
  video.addEventListener("ended", revealHero, { once: true });
  video.addEventListener("error", revealHero, { once: true });
  video.play().catch(revealHero);
}

setupNavigation();
setupHeroIntro();
loadSite().catch(() => {
  setText("#prayer-note", "The website details could not be loaded. Please refresh the page or contact the masjid.");
  setText("#location-label", "Prayer time service unavailable");
});
