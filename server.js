import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const scrypt = promisify(scryptCallback);
const dbPath = resolve(process.env.DATABASE_PATH || "./data/travelmate.sqlite");
if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS destinations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, country TEXT NOT NULL,
    category TEXT NOT NULL, description TEXT NOT NULL, history TEXT NOT NULL DEFAULT '',
    best_time TEXT NOT NULL, estimated_cost INTEGER NOT NULL, image TEXT NOT NULL,
    attractions TEXT NOT NULL DEFAULT '[]', stay TEXT NOT NULL DEFAULT '',
    food TEXT NOT NULL DEFAULT '', transport TEXT NOT NULL DEFAULT '',
    popularity INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, destination_id INTEGER REFERENCES destinations(id) ON DELETE SET NULL,
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, companions TEXT NOT NULL DEFAULT '',
    budget REAL NOT NULL DEFAULT 0, share_token TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS itinerary (
    id INTEGER PRIMARY KEY, trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    title TEXT NOT NULL, place TEXT NOT NULL, visit_date TEXT NOT NULL, visit_time TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY, trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    category TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL CHECK(amount >= 0),
    expense_date TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id, destination_id)
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE
  );
`);

const initialDestinations = [
  ["Kyoto", "Kyoto", "Japan", "Culture", "A timeless city where lantern-lit lanes, quiet gardens, and centuries-old traditions live side by side.", "Once the imperial capital of Japan, Kyoto preserves more than a thousand years of art, craft, and ceremony.", "March–May · October–November", 165, "photo-1493976040374-85c8e12f0c0e", ["Fushimi Inari Shrine", "Arashiyama Bamboo Grove", "Kinkaku-ji"], "Ryokans & boutique stays", "Seasonal kaiseki, ramen & matcha", "Walk, bus & rail", 98],
  ["Amalfi Coast", "Amalfi", "Italy", "Coastal", "Pastel villages cling to dramatic cliffs above the sparkling Tyrrhenian Sea.", "Maritime republics, lemon groves, and winding coastal roads shaped this celebrated corner of southern Italy.", "April–June · September", 220, "photo-1533105079780-92b9be482077", ["Path of the Gods", "Ravello gardens", "Amalfi Cathedral"], "Cliffside inns & family hotels", "Fresh seafood, limoncello & pasta", "Ferries & local buses", 96],
  ["Marrakech", "Marrakech", "Morocco", "Culture", "A sensory medina of tiled palaces, spice-filled souks, and sunlit gardens.", "Founded in 1070, Marrakech grew into a vibrant crossroads of Amazigh, Arab, and Andalusian cultures.", "March–May · September–November", 115, "photo-1539020140153-e479b8c22e70", ["Jemaa el-Fnaa", "Bahia Palace", "Majorelle Garden"], "Historic riads & design hotels", "Tagine, mint tea & market stalls", "Walk, taxi & horse carriage", 94],
  ["Banff", "Banff", "Canada", "Nature", "Turquoise alpine lakes, mountain air, and trails that make the outdoors feel boundless.", "Established in 1885 around Canada's first national park, Banff is a gateway to the Canadian Rockies.", "June–September · December–March", 195, "photo-1503614472-8c93d56cd5b0", ["Lake Louise", "Moraine Lake", "Sulphur Mountain"], "Lodges, cabins & mountain hotels", "Canadian comfort food & local cafés", "Shuttles, buses & scenic drives", 91],
  ["Bali", "Ubud", "Indonesia", "Nature", "Green rice terraces, temple ceremonies, and a gentle island rhythm.", "Balinese Hindu traditions flourish across the island's ancient temples and Subak irrigation landscapes.", "April–October", 105, "photo-1537996194471-e657df975ab4", ["Tegallalang Rice Terraces", "Uluwatu Temple", "Ubud Art Market"], "Guesthouses, villas & retreats", "Nasi campur, satay & tropical fruit", "Scooters, drivers & local shuttles", 95],
  ["Lisbon", "Lisbon", "Portugal", "City", "Sunny hilltop streets, soulful fado, and tiled facades overlooking the Tagus.", "Portugal's capital grew from ancient Roman roots into a vibrant Atlantic port and a center of exploration.", "March–May · September–October", 145, "photo-1555881400-74d7acaacd8b", ["Belém Tower", "Alfama", "São Jorge Castle"], "Boutique hotels & guesthouses", "Pastéis de nata, seafood & petiscos", "Metro, tram & walk", 93],
  ["Patagonia", "El Chaltén", "Argentina", "Adventure", "A wild end-of-the-world landscape of granite peaks, glacial lakes, and open skies.", "For thousands of years the Aonikenk people called this vast region home, tracing routes through the Andes.", "November–March", 180, "photo-1519681393784-d120267933ba", ["Fitz Roy trail", "Perito Moreno Glacier", "Torres del Paine"], "Mountain refuges & estancias", "Patagonian lamb & hearty stews", "Hiking, buses & guided trips", 89],
  ["Santorini", "Oia", "Greece", "Coastal", "Whitewashed villages spill down volcanic cliffs into a blue Aegean horizon.", "A dramatic volcanic eruption shaped the island's caldera and preserved a remarkable Minoan settlement.", "April–June · September–October", 240, "photo-1533105079780-92b9be482077", ["Oia sunset", "Akrotiri ruins", "Caldera cruise"], "Cliffside suites & family stays", "Fresh seafood, fava & local wines", "Buses, boats & walk", 97]
];
const count = db.prepare("SELECT COUNT(*) AS count FROM destinations").get().count;
if (!count) {
  const insert = db.prepare(`INSERT INTO destinations
    (name,city,country,category,description,history,best_time,estimated_cost,image,attractions,stay,food,transport,popularity)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of initialDestinations) insert.run(...row.slice(0, 9), JSON.stringify(row[9]), ...row.slice(10));
}
for (const name of ["Culture", "Coastal", "Nature", "City", "Adventure"]) {
  db.prepare("INSERT OR IGNORE INTO categories(name) VALUES (?)").run(name);
}
try {
  db.exec("ALTER TABLE trips ADD COLUMN share_token TEXT");
} catch (error) {
  if (!String(error.message).includes("duplicate column name")) throw error;
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_share_token ON trips(share_token)");

const send = (res, status, data, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(data));
};
const cookie = (token, maxAge) => `travelmate_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
const parseCookies = (header = "") => Object.fromEntries(header.split(";").map((part) => part.trim().split("=")).filter((part) => part.length === 2));
const body = async (req) => {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error("Request body is too large"), { status: 413 });
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error("Please send valid JSON"), { status: 400 }); }
};
const requiredText = (value, label, max = 180) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw Object.assign(new Error(`${label} is required and must be under ${max} characters`), { status: 400 });
  return value.trim();
};
const dateText = (value, label) => {
  const date = requiredText(value, label, 10);
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) throw Object.assign(new Error(`${label} must be a valid date`), { status: 400 });
  return date;
};
const timeText = (value) => {
  const time = value === undefined || value === null ? "" : requiredText(value, "Visit time", 5);
  if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Object.assign(new Error("Visit time must use 24-hour HH:MM format"), { status: 400 });
  return time;
};
const sortOrder = (value) => {
  const order = Number(value || 0);
  if (!Number.isSafeInteger(order) || order < 0 || order > 10000) throw Object.assign(new Error("Enter a valid itinerary order"), { status: 400 });
  return order;
};
const destinationId = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || !db.prepare("SELECT id FROM destinations WHERE id=?").get(id)) throw Object.assign(new Error("Choose a valid destination"), { status: 400 });
  return id;
};
const isUniqueConstraint = (error) => String(error.message).includes("UNIQUE constraint failed");
async function authenticate(req) {
  const token = parseCookies(req.headers.cookie).travelmate_session;
  if (!token) return null;
  const row = db.prepare(`SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=? AND s.expires_at > ?`).get(token, new Date().toISOString());
  return row || null;
}
const adminOnly = (user) => {
  if (!user || user.role !== "admin") throw Object.assign(new Error("Administrator access is required"), { status: 403 });
};
const tripForUser = (id, userId) => db.prepare(`SELECT t.*, d.name AS destination_name, d.image AS destination_image
  FROM trips t LEFT JOIN destinations d ON d.id=t.destination_id WHERE t.id=? AND t.user_id=?`).get(id, userId);
const tripDetails = (trip) => ({
  ...trip,
  itinerary: db.prepare("SELECT * FROM itinerary WHERE trip_id=? ORDER BY visit_date,visit_time,sort_order,id").all(trip.id),
  expenses: db.prepare("SELECT * FROM expenses WHERE trip_id=? ORDER BY expense_date,id").all(trip.id)
});
const distRoot = resolve("./dist");

const api = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const method = req.method || "GET";
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  if (!url.pathname.startsWith("/api/")) {
    if (!existsSync(distRoot) || !["GET", "HEAD"].includes(method)) return send(res, 404, { error: "Not found" });
    let requested;
    try { requested = decodeURIComponent(url.pathname); }
    catch { return send(res, 400, { error: "Invalid URL path" }); }
    const file = resolve(distRoot, `.${requested}`);
    if (file !== distRoot && !file.startsWith(`${distRoot}${sep}`)) return send(res, 403, { error: "Forbidden" });
    const selected = existsSync(file) && statSync(file).isFile() ? file : resolve(distRoot, "index.html");
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };
    const ext = selected.slice(selected.lastIndexOf("."));
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": selected.endsWith(".html") ? "no-cache" : "public, max-age=31536000, immutable" });
    if (method === "HEAD") return res.end();
    return createReadStream(selected).pipe(res);
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); }
    catch { return send(res, 403, { error: "Invalid request origin" }); }
    const developmentOrigin = process.env.NODE_ENV !== "production" && ["localhost:5173", "127.0.0.1:5173"].includes(origin.host);
    if (origin.host !== req.headers.host && !developmentOrigin) return send(res, 403, { error: "Cross-origin request rejected" });
  }
  try {
    const route = url.pathname;
    if (route === "/api/health" && method === "GET") return send(res, 200, { status: "ok" });
    if (route === "/api/destinations" && method === "GET") {
      const { q = "", country = "", city = "", category = "", maxBudget = "", sort = "popular" } = Object.fromEntries(url.searchParams);
      let sql = "SELECT * FROM destinations WHERE 1=1";
      const params = [];
      if (q) { sql += " AND (name LIKE ? OR city LIKE ? OR country LIKE ?)"; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      if (country) { sql += " AND country=?"; params.push(country); }
      if (city) { sql += " AND city=?"; params.push(city); }
      if (category) { sql += " AND category=?"; params.push(category); }
      if (maxBudget && Number.isFinite(Number(maxBudget))) { sql += " AND estimated_cost<=?"; params.push(Number(maxBudget)); }
      sql += sort === "cost" ? " ORDER BY estimated_cost ASC" : sort === "name" ? " ORDER BY name ASC" : " ORDER BY popularity DESC";
      return send(res, 200, db.prepare(sql).all(...params).map((item) => ({ ...item, attractions: JSON.parse(item.attractions) })));
    }
    if (route === "/api/categories" && method === "GET") return send(res, 200, db.prepare("SELECT name FROM categories ORDER BY name").all().map((row) => row.name));
    if (route === "/api/auth/register" && method === "POST") {
      const data = await body(req);
      const name = requiredText(data.name, "Name");
      const email = requiredText(data.email, "Email", 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address"), { status: 400 });
      if (typeof data.password !== "string" || data.password.length < 8 || data.password.length > 128) throw Object.assign(new Error("Password must be 8–128 characters"), { status: 400 });
      const salt = randomBytes(16).toString("hex");
      const hash = Buffer.from(await scrypt(data.password, salt, 64)).toString("hex");
      let result;
      try { result = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name, email, `${salt}:${hash}`); }
      catch (error) { if (isUniqueConstraint(error)) throw Object.assign(new Error("An account with that email already exists"), { status: 409 }); throw error; }
      const token = randomBytes(32).toString("hex");
      db.prepare("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)").run(token, result.lastInsertRowid, new Date(Date.now() + 30 * 86400000).toISOString());
      const user = db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(result.lastInsertRowid);
      return send(res, 201, { user }, { "Set-Cookie": cookie(token, 30 * 86400) });
    }
    if (route === "/api/auth/login" && method === "POST") {
      const data = await body(req);
      const email = requiredText(data.email, "Email", 254).toLowerCase();
      const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
      if (!user || typeof data.password !== "string" || data.password.length > 128) throw Object.assign(new Error("Email or password is incorrect"), { status: 401 });
      const [salt, expectedHex] = user.password_hash.split(":");
      const actual = Buffer.from(await scrypt(data.password, salt, 64));
      const expected = Buffer.from(expectedHex, "hex");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Object.assign(new Error("Email or password is incorrect"), { status: 401 });
      const token = randomBytes(32).toString("hex");
      db.prepare("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)").run(token, user.id, new Date(Date.now() + 30 * 86400000).toISOString());
      return send(res, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role } }, { "Set-Cookie": cookie(token, 30 * 86400) });
    }
    if (route === "/api/auth/forgot-password" && method === "POST") {
      const email = requiredText((await body(req)).email, "Email", 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address"), { status: 400 });
      const account = db.prepare("SELECT id FROM users WHERE email=?").get(email);
      let developmentToken;
      if (account) {
        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        db.prepare("DELETE FROM password_resets WHERE user_id=?").run(account.id);
        db.prepare("INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES(?,?,?)").run(tokenHash, account.id, new Date(Date.now() + 15 * 60000).toISOString());
        if (process.env.PASSWORD_RESET_WEBHOOK_URL) {
          try {
            const deliveryUrl = new URL(process.env.PASSWORD_RESET_WEBHOOK_URL);
            if (deliveryUrl.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("The password-reset webhook must use HTTPS in production");
            const response = await fetch(deliveryUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ to: email, resetUrl: `${req.headers.origin || `http://${req.headers.host}`}/?reset=${token}`, expiresInMinutes: 15 }),
              signal: AbortSignal.timeout(8000)
            });
            if (!response.ok) console.error(`Password-reset delivery failed with HTTP ${response.status}`);
          } catch (error) { console.error("Password-reset delivery failed:", error.message); }
        } else if (process.env.NODE_ENV !== "production") {
          developmentToken = token;
        } else {
          console.error("Password reset requested but PASSWORD_RESET_WEBHOOK_URL is not configured.");
        }
      }
      return send(res, 200, {
        message: "If an account exists for that email, a reset link will be sent.",
        ...(developmentToken ? { developmentToken } : {})
      });
    }
    if (route === "/api/auth/reset-password" && method === "POST") {
      const data = await body(req);
      if (typeof data.token !== "string" || !/^[a-f0-9]{64}$/.test(data.token)) throw Object.assign(new Error("Enter a valid reset link"), { status: 400 });
      if (typeof data.password !== "string" || data.password.length < 8 || data.password.length > 128) throw Object.assign(new Error("Password must be 8–128 characters"), { status: 400 });
      const tokenHash = createHash("sha256").update(data.token).digest("hex");
      const reset = db.prepare("SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>?").get(tokenHash, new Date().toISOString());
      if (!reset) throw Object.assign(new Error("This reset link has expired or has already been used"), { status: 400 });
      const salt = randomBytes(16).toString("hex");
      const hash = Buffer.from(await scrypt(data.password, salt, 64)).toString("hex");
      db.exec("BEGIN");
      try {
        db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(`${salt}:${hash}`, reset.user_id);
        db.prepare("DELETE FROM password_resets WHERE user_id=?").run(reset.user_id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(reset.user_id);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return send(res, 200, { ok: true });
    }
    if (route === "/api/auth/logout" && method === "POST") {
      const token = parseCookies(req.headers.cookie).travelmate_session;
      if (token) db.prepare("DELETE FROM sessions WHERE token=?").run(token);
      return send(res, 200, { ok: true }, { "Set-Cookie": cookie("", 0) });
    }
    if (route === "/api/me" && method === "GET") return send(res, 200, { user: await authenticate(req) });
    const sharedMatch = route.match(/^\/api\/shared\/([a-f0-9]{64})$/);
    if (sharedMatch && method === "GET") {
      const trip = db.prepare(`SELECT t.*, d.name AS destination_name, d.image AS destination_image
        FROM trips t LEFT JOIN destinations d ON d.id=t.destination_id WHERE t.share_token=?`).get(sharedMatch[1]);
      if (!trip) throw Object.assign(new Error("This shared trip link is no longer available"), { status: 404 });
      const { user_id, share_token, ...details } = tripDetails(trip);
      return send(res, 200, { ...details, shared: true });
    }

    const user = await authenticate(req);
    if (!user) throw Object.assign(new Error("Please sign in to continue"), { status: 401 });
    if (route === "/api/profile" && method === "PATCH") {
      const data = await body(req);
      const name = requiredText(data.name, "Name");
      const email = requiredText(data.email, "Email", 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address"), { status: 400 });
      try { db.prepare("UPDATE users SET name=?,email=? WHERE id=?").run(name, email, user.id); }
      catch (error) { if (isUniqueConstraint(error)) throw Object.assign(new Error("That email is already in use"), { status: 409 }); throw error; }
      return send(res, 200, { user: { ...user, name, email } });
    }
    if (route === "/api/favorites" && method === "GET") {
      return send(res, 200, db.prepare(`SELECT d.* FROM favorites f JOIN destinations d ON d.id=f.destination_id
        WHERE f.user_id=? ORDER BY f.created_at DESC`).all(user.id).map((item) => ({ ...item, attractions: JSON.parse(item.attractions) })));
    }
    const favoriteMatch = route.match(/^\/api\/favorites\/(\d+)$/);
    if (favoriteMatch && method === "POST") {
      if (!db.prepare("SELECT id FROM destinations WHERE id=?").get(Number(favoriteMatch[1]))) throw Object.assign(new Error("Destination not found"), { status: 404 });
      db.prepare("INSERT OR IGNORE INTO favorites(user_id,destination_id) VALUES(?,?)").run(user.id, Number(favoriteMatch[1]));
      return send(res, 200, { ok: true });
    }
    if (favoriteMatch && method === "DELETE") {
      db.prepare("DELETE FROM favorites WHERE user_id=? AND destination_id=?").run(user.id, Number(favoriteMatch[1]));
      return send(res, 200, { ok: true });
    }
    if (route === "/api/trips" && method === "GET") return send(res, 200, db.prepare("SELECT t.*, d.name AS destination_name, d.image AS destination_image FROM trips t LEFT JOIN destinations d ON d.id=t.destination_id WHERE t.user_id=? ORDER BY t.start_date").all(user.id).map(tripDetails));
    if (route === "/api/trips" && method === "POST") {
      const data = await body(req);
      const name = requiredText(data.name, "Trip name");
      const start = dateText(data.start_date, "Start date");
      const end = dateText(data.end_date, "End date");
      if (end < start) throw Object.assign(new Error("End date must be on or after the start date"), { status: 400 });
      const budget = Number(data.budget || 0);
      if (!Number.isFinite(budget) || budget < 0 || budget > 100000000) throw Object.assign(new Error("Enter a valid trip budget"), { status: 400 });
      const selectedDestination = destinationId(data.destination_id);
      const result = db.prepare("INSERT INTO trips(user_id,name,destination_id,start_date,end_date,companions,budget) VALUES(?,?,?,?,?,?,?)")
        .run(user.id, name, selectedDestination, start, end, typeof data.companions === "string" ? data.companions.slice(0, 500) : "", budget);
      return send(res, 201, tripDetails(tripForUser(result.lastInsertRowid, user.id)));
    }
    const tripMatch = route.match(/^\/api\/trips\/(\d+)$/);
    if (tripMatch) {
      const trip = tripForUser(Number(tripMatch[1]), user.id);
      if (!trip) throw Object.assign(new Error("Trip not found"), { status: 404 });
      if (method === "GET") return send(res, 200, tripDetails(trip));
      if (method === "PATCH") {
        const data = await body(req);
        const name = requiredText(data.name, "Trip name");
        const start = dateText(data.start_date, "Start date");
        const end = dateText(data.end_date, "End date");
        if (end < start) throw Object.assign(new Error("End date must be on or after the start date"), { status: 400 });
        if (db.prepare("SELECT COUNT(*) AS count FROM itinerary WHERE trip_id=? AND (visit_date<? OR visit_date>?)").get(trip.id, start, end).count) {
          throw Object.assign(new Error("Update itinerary dates before shortening this trip"), { status: 400 });
        }
        const budget = Number(data.budget || 0);
        if (!Number.isFinite(budget) || budget < 0 || budget > 100000000) throw Object.assign(new Error("Enter a valid trip budget"), { status: 400 });
        const selectedDestination = destinationId(data.destination_id);
        db.prepare("UPDATE trips SET name=?,destination_id=?,start_date=?,end_date=?,companions=?,budget=? WHERE id=? AND user_id=?")
          .run(name, selectedDestination, start, end, (data.companions || "").toString().slice(0, 500), budget, trip.id, user.id);
        return send(res, 200, tripDetails(tripForUser(trip.id, user.id)));
      }
      if (method === "DELETE") { db.prepare("DELETE FROM trips WHERE id=? AND user_id=?").run(trip.id, user.id); return send(res, 200, { ok: true }); }
    }
    const shareMatch = route.match(/^\/api\/trips\/(\d+)\/share$/);
    if (shareMatch && method === "POST") {
      const trip = tripForUser(Number(shareMatch[1]), user.id);
      if (!trip) throw Object.assign(new Error("Trip not found"), { status: 404 });
      const token = trip.share_token || randomBytes(32).toString("hex");
      if (!trip.share_token) db.prepare("UPDATE trips SET share_token=? WHERE id=? AND user_id=?").run(token, trip.id, user.id);
      return send(res, 200, { token });
    }
    const itineraryCollection = route.match(/^\/api\/trips\/(\d+)\/itinerary$/);
    if (itineraryCollection && method === "POST") {
      const trip = tripForUser(Number(itineraryCollection[1]), user.id);
      if (!trip) throw Object.assign(new Error("Trip not found"), { status: 404 });
      const data = await body(req);
      const title = requiredText(data.title, "Activity name");
      const place = requiredText(data.place, "Place");
      const date = dateText(data.visit_date, "Visit date");
      if (date < trip.start_date || date > trip.end_date) throw Object.assign(new Error("Activity date must fall within the trip dates"), { status: 400 });
      const time = timeText(data.visit_time);
      const order = sortOrder(data.sort_order);
      const result = db.prepare("INSERT INTO itinerary(trip_id,title,place,visit_date,visit_time,notes,sort_order) VALUES(?,?,?,?,?,?,?)")
        .run(trip.id, title, place, date, time, (data.notes || "").toString().slice(0, 1000), order);
      return send(res, 201, db.prepare("SELECT * FROM itinerary WHERE id=?").get(result.lastInsertRowid));
    }
    const itineraryItem = route.match(/^\/api\/itinerary\/(\d+)$/);
    if (itineraryItem && ["PATCH", "DELETE"].includes(method)) {
      const item = db.prepare("SELECT i.* FROM itinerary i JOIN trips t ON t.id=i.trip_id WHERE i.id=? AND t.user_id=?").get(Number(itineraryItem[1]), user.id);
      if (!item) throw Object.assign(new Error("Itinerary activity not found"), { status: 404 });
      if (method === "DELETE") { db.prepare("DELETE FROM itinerary WHERE id=?").run(item.id); return send(res, 200, { ok: true }); }
      const data = await body(req);
      const title = requiredText(data.title, "Activity name");
      const place = requiredText(data.place, "Place");
      const date = dateText(data.visit_date, "Visit date");
      const trip = tripForUser(item.trip_id, user.id);
      if (date < trip.start_date || date > trip.end_date) throw Object.assign(new Error("Activity date must fall within the trip dates"), { status: 400 });
      const time = timeText(data.visit_time);
      const order = sortOrder(data.sort_order);
      db.prepare("UPDATE itinerary SET title=?,place=?,visit_date=?,visit_time=?,notes=?,sort_order=? WHERE id=?")
        .run(title, place, date, time, (data.notes || "").toString().slice(0, 1000), order, item.id);
      return send(res, 200, db.prepare("SELECT * FROM itinerary WHERE id=?").get(item.id));
    }
    const expenseCollection = route.match(/^\/api\/trips\/(\d+)\/expenses$/);
    if (expenseCollection && method === "POST") {
      const trip = tripForUser(Number(expenseCollection[1]), user.id);
      if (!trip) throw Object.assign(new Error("Trip not found"), { status: 404 });
      const data = await body(req);
      const category = requiredText(data.category, "Expense category", 40);
      const description = requiredText(data.description, "Description");
      const amount = Number(data.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) throw Object.assign(new Error("Enter an amount greater than zero"), { status: 400 });
      const expenseDate = data.expense_date ? dateText(data.expense_date, "Expense date") : "";
      const result = db.prepare("INSERT INTO expenses(trip_id,category,description,amount,expense_date) VALUES(?,?,?,?,?)").run(trip.id, category, description, amount, expenseDate);
      return send(res, 201, db.prepare("SELECT * FROM expenses WHERE id=?").get(result.lastInsertRowid));
    }
    const expenseItem = route.match(/^\/api\/expenses\/(\d+)$/);
    if (expenseItem && ["PATCH", "DELETE"].includes(method)) {
      const item = db.prepare("SELECT e.* FROM expenses e JOIN trips t ON t.id=e.trip_id WHERE e.id=? AND t.user_id=?").get(Number(expenseItem[1]), user.id);
      if (!item) throw Object.assign(new Error("Expense not found"), { status: 404 });
      if (method === "DELETE") { db.prepare("DELETE FROM expenses WHERE id=?").run(item.id); return send(res, 200, { ok: true }); }
      const data = await body(req);
      const category = requiredText(data.category, "Expense category", 40);
      const description = requiredText(data.description, "Description");
      const amount = Number(data.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error("Enter an amount greater than zero"), { status: 400 });
      const expenseDate = data.expense_date ? dateText(data.expense_date, "Expense date") : "";
      db.prepare("UPDATE expenses SET category=?,description=?,amount=?,expense_date=? WHERE id=?").run(category, description, amount, expenseDate, item.id);
      return send(res, 200, db.prepare("SELECT * FROM expenses WHERE id=?").get(item.id));
    }
    if (route === "/api/admin/stats" && method === "GET") {
      adminOnly(user);
      const users = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
      const trips = db.prepare("SELECT COUNT(*) AS count FROM trips").get().count;
      const destinations = db.prepare("SELECT COUNT(*) AS count FROM destinations").get().count;
      return send(res, 200, { users, trips, destinations });
    }
    if (route === "/api/admin/users" && method === "GET") {
      adminOnly(user);
      return send(res, 200, db.prepare("SELECT id,name,email,role,created_at FROM users ORDER BY created_at DESC").all());
    }
    const adminUser = route.match(/^\/api\/admin\/users\/(\d+)$/);
    if (adminUser && method === "PATCH") {
      adminOnly(user);
      const id = Number(adminUser[1]);
      if (id === user.id) throw Object.assign(new Error("You cannot change your own administrator role"), { status: 400 });
      const data = await body(req);
      if (!["user", "admin"].includes(data.role)) throw Object.assign(new Error("Role must be user or admin"), { status: 400 });
      db.prepare("UPDATE users SET role=? WHERE id=?").run(data.role, id);
      return send(res, 200, { ok: true });
    }
    if (route === "/api/admin/categories" && method === "POST") {
      adminOnly(user);
      const name = requiredText((await body(req)).name, "Category name", 40);
      try { db.prepare("INSERT INTO categories(name) VALUES(?)").run(name); } catch (error) { if (isUniqueConstraint(error)) throw Object.assign(new Error("That category already exists"), { status: 409 }); throw error; }
      return send(res, 201, { name });
    }
    if (route === "/api/admin/categories" && method === "DELETE") {
      adminOnly(user);
      const name = requiredText(url.searchParams.get("name"), "Category name", 40);
      if (db.prepare("SELECT COUNT(*) AS count FROM destinations WHERE category=?").get(name).count) throw Object.assign(new Error("Move or update destinations in this category before deleting it"), { status: 409 });
      db.prepare("DELETE FROM categories WHERE name=?").run(name);
      return send(res, 200, { ok: true });
    }
    if (route === "/api/admin/destinations" && method === "POST") {
      adminOnly(user);
      const d = await body(req);
      const name = requiredText(d.name, "Destination name");
      const city = requiredText(d.city, "City");
      const country = requiredText(d.country, "Country");
      const category = requiredText(d.category, "Category", 40);
      if (!db.prepare("SELECT id FROM categories WHERE name=?").get(category)) throw Object.assign(new Error("Choose a valid travel category"), { status: 400 });
      const description = requiredText(d.description, "Description", 1000);
      const best = requiredText(d.best_time, "Best time to visit");
      const cost = Number(d.estimated_cost);
      if (!Number.isFinite(cost) || cost < 0) throw Object.assign(new Error("Enter a valid estimated daily cost"), { status: 400 });
      const image = requiredText(d.image, "Image identifier", 100);
      const attractions = Array.isArray(d.attractions) ? d.attractions.map((item) => requiredText(item, "Attraction")).slice(0, 20) : [];
      const result = db.prepare(`INSERT INTO destinations(name,city,country,category,description,history,best_time,estimated_cost,image,attractions,stay,food,transport)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(name, city, country, category, description, (d.history || "").toString().slice(0, 1000), best, cost, image, JSON.stringify(attractions), (d.stay || "").toString().slice(0, 300), (d.food || "").toString().slice(0, 300), (d.transport || "").toString().slice(0, 300));
      return send(res, 201, { id: result.lastInsertRowid });
    }
    const adminDestination = route.match(/^\/api\/admin\/destinations\/(\d+)$/);
    if (adminDestination && ["PATCH", "DELETE"].includes(method)) {
      adminOnly(user);
      const id = Number(adminDestination[1]);
      if (method === "DELETE") { db.prepare("DELETE FROM destinations WHERE id=?").run(id); return send(res, 200, { ok: true }); }
      const d = await body(req);
      const name = requiredText(d.name, "Destination name");
      const city = requiredText(d.city, "City");
      const country = requiredText(d.country, "Country");
      const category = requiredText(d.category, "Category", 40);
      if (!db.prepare("SELECT id FROM categories WHERE name=?").get(category)) throw Object.assign(new Error("Choose a valid travel category"), { status: 400 });
      const description = requiredText(d.description, "Description", 1000);
      const best = requiredText(d.best_time, "Best time to visit");
      const cost = Number(d.estimated_cost);
      if (!Number.isFinite(cost) || cost < 0) throw Object.assign(new Error("Enter a valid estimated daily cost"), { status: 400 });
      db.prepare(`UPDATE destinations SET name=?,city=?,country=?,category=?,description=?,history=?,best_time=?,estimated_cost=?,image=?,attractions=?,stay=?,food=?,transport=? WHERE id=?`)
        .run(name, city, country, category, description, (d.history || "").toString().slice(0, 1000), best, cost, requiredText(d.image, "Image identifier", 100), JSON.stringify(Array.isArray(d.attractions) ? d.attractions : []), (d.stay || "").toString().slice(0, 300), (d.food || "").toString().slice(0, 300), (d.transport || "").toString().slice(0, 300), id);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "Not found" });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error(error);
    return send(res, status, { error: status === 500 ? "Something went wrong. Please try again." : error.message });
  }
});

async function seedAdmin() {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) return;
  if (process.env.ADMIN_PASSWORD.length < 12) throw new Error("ADMIN_PASSWORD must contain at least 12 characters.");
  const email = process.env.ADMIN_EMAIL.toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email=?").get(email);
  if (existing) { db.prepare("UPDATE users SET role='admin' WHERE id=?").run(existing.id); return; }
  const salt = randomBytes(16).toString("hex");
  const hash = Buffer.from(await scrypt(process.env.ADMIN_PASSWORD, salt, 64)).toString("hex");
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run("TravelMate Admin", email, `${salt}:${hash}`);
}

await seedAdmin();
const port = Number(process.env.PORT || 3001);
api.listen(port, "0.0.0.0", () => console.log(`TravelMate API ready on http://localhost:${port}`));
