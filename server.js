const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 5500;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "database.json");
const UPLOADS_DIR = path.join(ROOT, "uploads");
const sessions = new Map();
const seed = {
  users: [],
  courses: [
    { id: "math-basic", title: "Matematika Dasar", category: "Matematika", level: "Pemula", description: "Bangun fondasi matematika dengan latihan yang mudah dipahami." },
    { id: "english-talk", title: "Daily Conversation", category: "Bahasa Inggris", level: "Semua level", description: "Berani berbicara bahasa Inggris dalam situasi sehari-hari." },
    { id: "web-dev", title: "Membuat Website", category: "Pemrograman", level: "Pemula", description: "Mulai membuat website dari HTML, CSS, hingga JavaScript." }
  ],
  materials: [],
  meetings: [],
  enrollments: [],
  teacherApplications: []
};
const ROLES = ["admin", "guru", "siswa"];
const STANDARD_COURSES = [
  ...Array.from({ length: 6 }, (_, index) => ({ number: index + 1, educationLevel: "SD/MI", level: "Dasar" })),
  ...Array.from({ length: 3 }, (_, index) => ({ number: index + 7, educationLevel: "SMP/MTs", level: "Menengah" })),
  ...Array.from({ length: 3 }, (_, index) => ({ number: index + 10, educationLevel: "SMA/MA", level: "Atas" }))
];

function hash(password, salt) {
  const actualSalt = salt || crypto.randomBytes(16).toString("hex");
  return `${actualSalt}:${crypto.scryptSync(password, actualSalt, 64).toString("hex")}`;
}
function matches(password, stored) {
  const parts = stored.split(":");
  return parts.length === 2 && hash(password, parts[0]).split(":")[1] === parts[1];
}
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, role: user.role, courseId: user.courseId || null }; }
function publicTeacherApplication(application) {
  return { id: application.id, name: application.name, email: application.email, createdAt: application.createdAt };
}
function loadDatabase() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  let database = seed;
  try { if (fs.existsSync(DATA_FILE)) database = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { database = seed; }
  database.users = Array.isArray(database.users) ? database.users : [];
  database.users.forEach((user) => {
    if (user.role === "student") user.role = "siswa";
    if (!ROLES.includes(user.role)) user.role = "siswa";
  });
  database.courses = Array.isArray(database.courses) ? database.courses : [];
  for (const standard of STANDARD_COURSES) {
    let course = database.courses.find((item) => item.title === `Kelas ${standard.number}` || item.title.startsWith(`Kelas ${standard.number} `));
    if (!course) {
      course = {
        id: crypto.randomUUID(),
        title: `Kelas ${standard.number}`,
        category: standard.educationLevel,
        level: standard.level,
        educationLevel: standard.educationLevel,
        description: `Materi pembelajaran untuk ${standard.educationLevel} kelas ${standard.number}.`
      };
      database.courses.push(course);
    } else {
      course.educationLevel = course.educationLevel || standard.educationLevel;
    }
  }
  database.materials = Array.isArray(database.materials) ? database.materials : seed.materials;
  database.meetings = Array.isArray(database.meetings) ? database.meetings : [];
  database.enrollments = Array.isArray(database.enrollments) ? database.enrollments : [];
  database.teacherApplications = Array.isArray(database.teacherApplications) ? database.teacherApplications : [];
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!database.users.some((user) => user.email === "admin@ruangkelas.local")) database.users.push({ id: crypto.randomUUID(), name: "Admin RuangKelas", email: "admin@ruangkelas.local", password: hash("admin12345"), role: "admin" });
  if (!database.users.some((user) => user.email === "guru@ruangkelas.local")) database.users.push({ id: crypto.randomUUID(), name: "Guru RuangKelas", email: "guru@ruangkelas.local", password: hash("guru12345"), role: "guru" });
  fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2));
  return database;
}
const database = loadDatabase();
function send(response, status, body) { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); response.end(JSON.stringify(body)); }
function token(request) { const match = (request.headers.cookie || "").match(/ruangkelas_session=([^;]+)/); return match ? match[1] : null; }
function userFrom(request) { const id = sessions.get(token(request)); return database.users.find((user) => user.id === id) || null; }
async function readBody(request) { let text = ""; for await (const chunk of request) text += chunk; return text ? JSON.parse(text) : {}; }
function session(response, user) { const value = crypto.randomBytes(32).toString("hex"); sessions.set(value, user.id); response.setHeader("Set-Cookie", `ruangkelas_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`); }
function roleOnly(user, response, roles) {
  if (!user) { send(response, 401, { error: "Silakan masuk terlebih dahulu." }); return false; }
  if (!roles.includes(user.role)) { send(response, 403, { error: "Kamu tidak memiliki izin untuk mengakses fitur ini." }); return false; }
  return true;
}
function adminOnly(user, response) { return roleOnly(user, response, ["admin"]); }
function staffOnly(user, response) { return roleOnly(user, response, ["admin", "guru"]); }
async function api(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const user = userFrom(request);
  if (request.method === "GET" && url.pathname === "/api/me") return send(response, 200, { user: user ? publicUser(user) : null });
  if (request.method === "GET" && url.pathname === "/api/courses") {
    const courses = database.courses.map((course) => ({ ...course, materials: database.materials.filter((material) => material.courseId === course.id) }));
    return send(response, 200, { courses });
  }
  if (request.method === "GET" && url.pathname === "/api/materials") return send(response, 200, { materials: database.materials, meetings: database.meetings });
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const input = await readBody(request); const found = database.users.find((item) => item.email === String(input.email || "").trim().toLowerCase());
    const pending = database.teacherApplications.find((item) => item.email === String(input.email || "").trim().toLowerCase());
    if (!found && pending) return send(response, 403, { error: "Pengajuan akun guru masih menunggu persetujuan admin." });
    if (!found || !matches(String(input.password || ""), found.password)) return send(response, 401, { error: "Email atau password salah." });
    session(response, found); return send(response, 200, { user: publicUser(found) });
  }
  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    const input = await readBody(request); const email = String(input.email || "").trim().toLowerCase();
    const role = String(input.role || "siswa").trim();
    const courseId = String(input.courseId || "").trim();
    if (!input.name || !email || !input.password || String(input.password).length < 6 || !["guru", "siswa"].includes(role) || (role === "siswa" && !courseId)) return send(response, 400, { error: "Nama, email, password minimal 6 karakter, role, dan kelas siswa wajib diisi." });
    if (role === "siswa" && !database.courses.some((course) => course.id === courseId)) return send(response, 400, { error: "Kelas siswa tidak ditemukan." });
    if (database.users.some((item) => item.email === email) || database.teacherApplications.some((item) => item.email === email)) return send(response, 409, { error: "Email sudah terdaftar atau sedang menunggu persetujuan." });
    if (role === "guru") {
      database.teacherApplications.push({ id: crypto.randomUUID(), name: String(input.name).trim(), email, password: hash(String(input.password)), createdAt: new Date().toISOString() });
      fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2));
      return send(response, 202, { pending: true, message: "Pengajuan akun guru berhasil dikirim dan menunggu persetujuan admin." });
    }
    const created = { id: crypto.randomUUID(), name: String(input.name).trim(), email, password: hash(String(input.password)), role, courseId };
    database.users.push(created); fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2)); session(response, created); return send(response, 201, { user: publicUser(created) });
  }
  if (request.method === "POST" && url.pathname === "/api/auth/logout") { sessions.delete(token(request)); response.setHeader("Set-Cookie", "ruangkelas_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"); return send(response, 200, { ok: true }); }
  if (request.method === "GET" && url.pathname === "/api/admin/summary") { if (!staffOnly(user, response)) return; return send(response, 200, { users: database.users.map(publicUser), courses: database.courses, materials: database.materials, meetings: database.meetings, teacherApplications: database.teacherApplications.map(publicTeacherApplication) }); }
  if (request.method === "POST" && url.pathname.startsWith("/api/admin/teacher-applications/")) {
    if (!adminOnly(user, response)) return;
    const parts = url.pathname.split("/");
    const applicationId = decodeURIComponent(parts[4] || "");
    const action = parts[5];
    const index = database.teacherApplications.findIndex((item) => item.id === applicationId);
    if (index === -1) return send(response, 404, { error: "Pengajuan guru tidak ditemukan." });
    const application = database.teacherApplications[index];
    if (action === "approve") {
      const created = { id: crypto.randomUUID(), name: application.name, email: application.email, password: application.password, role: "guru" };
      database.users.push(created);
      database.teacherApplications.splice(index, 1);
      fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2));
      return send(response, 200, { user: publicUser(created) });
    }
    if (action === "reject") {
      database.teacherApplications.splice(index, 1);
      fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2));
      return send(response, 200, { ok: true });
    }
    return send(response, 400, { error: "Aksi pengajuan tidak valid." });
  }
  if (request.method === "POST" && url.pathname === "/api/admin/users") {
    if (!adminOnly(user, response)) return;
    const input = await readBody(request);
    const email = String(input.email || "").trim().toLowerCase();
    const role = String(input.role || "").trim();
    if (!input.name || !email || !input.password || String(input.password).length < 6 || !ROLES.includes(role) || role === "admin") return send(response, 400, { error: "Nama, email, password minimal 6 karakter, dan role guru atau siswa wajib diisi." });
    const courseId = String(input.courseId || "").trim();
    if (role === "siswa" && courseId && !database.courses.some((course) => course.id === courseId)) return send(response, 400, { error: "Kelas siswa tidak ditemukan." });
    if (database.users.some((item) => item.email === email)) return send(response, 409, { error: "Email sudah terdaftar." });
    const created = { id: crypto.randomUUID(), name: String(input.name).trim(), email, password: hash(String(input.password)), role, ...(role === "siswa" && courseId ? { courseId } : {}) };
    database.users.push(created); fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2)); return send(response, 201, { user: publicUser(created) });
  }
  if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/users/")) {
    if (!adminOnly(user, response)) return;
    const userId = decodeURIComponent(url.pathname.slice("/api/admin/users/".length));
    if (!userId || userId === user.id) return send(response, 400, { error: "Akun yang sedang digunakan tidak dapat dihapus." });
    const index = database.users.findIndex((item) => item.id === userId);
    if (index === -1) return send(response, 404, { error: "Akun tidak ditemukan." });
    const deleted = database.users.splice(index, 1)[0];
    database.enrollments = database.enrollments.filter((item) => item.userId !== userId && item.studentId !== userId && item.teacherId !== userId);
    fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2));
    for (const [sessionId, sessionUserId] of sessions) if (sessionUserId === userId) sessions.delete(sessionId);
    return send(response, 200, { user: publicUser(deleted) });
  }
  if (request.method === "POST" && url.pathname === "/api/admin/courses") {
    if (!adminOnly(user, response)) return;
    const input = await readBody(request);
    if (!input.title || !input.category || !input.level || !input.description) return send(response, 400, { error: "Nama kelas, kategori, level, dan deskripsi wajib diisi." });
    const course = { id: crypto.randomUUID(), title: String(input.title).trim(), category: String(input.category).trim(), level: String(input.level).trim(), description: String(input.description).trim() };
    database.courses.push(course);
    fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2));
    return send(response, 201, { course });
  }
  if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/courses/")) {
    if (!adminOnly(user, response)) return;
    const courseId = decodeURIComponent(url.pathname.slice("/api/admin/courses/".length));
    const index = database.courses.findIndex((item) => item.id === courseId);
    if (index === -1) return send(response, 404, { error: "Kelas tidak ditemukan." });
    database.courses.splice(index, 1);
    database.enrollments = database.enrollments.filter((item) => item.courseId !== courseId);
    fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2));
    return send(response, 200, { ok: true });
  }
  if (request.method === "POST" && url.pathname === "/api/admin/materials") {
    if (!staffOnly(user, response)) return; const input = await readBody(request);
    if (!input.title || !input.subject || !input.type || !input.courseId) return send(response, 400, { error: "Kelas, judul, mata pelajaran, dan tipe wajib diisi." });
    if (!database.courses.some((course) => course.id === String(input.courseId))) return send(response, 400, { error: "Kelas materi tidak ditemukan." });
    const material = { id: crypto.randomUUID(), courseId: String(input.courseId), title: String(input.title).trim(), subject: String(input.subject).trim(), type: String(input.type).trim(), url: String(input.url || "").trim(), description: "Materi pembelajaran RuangKelas." };
    if (input.fileData) {
      const match = String(input.fileData).match(/^data:([^;]+);base64,(.+)$/);
      if (!match || !input.fileName) return send(response, 400, { error: "Format file upload tidak valid." });
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length > 25 * 1024 * 1024) return send(response, 413, { error: "Ukuran file maksimal 25 MB." });
      const extension = path.extname(String(input.fileName)).toLowerCase().replace(/[^a-z0-9.]/g, "") || ".bin";
      const storedName = `${material.id}${extension}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, storedName), buffer);
      material.fileName = String(input.fileName);
      material.fileUrl = `/uploads/${storedName}`;
      material.fileType = String(input.fileType || match[1]);
    }
    database.materials.push(material); fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2)); return send(response, 201, { material });
  }
  if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/materials/")) {
    if (!staffOnly(user, response)) return;
    const materialId = decodeURIComponent(url.pathname.slice("/api/admin/materials/".length));
    const index = database.materials.findIndex((item) => item.id === materialId);
    if (index === -1) return send(response, 404, { error: "Materi tidak ditemukan." });
    const deleted = database.materials.splice(index, 1)[0];
    if (deleted.fileUrl) {
      const filePath = path.join(ROOT, deleted.fileUrl.replace(/^\/uploads\//, ""));
      if (filePath.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2));
    return send(response, 200, { ok: true });
  }
  if (request.method === "POST" && url.pathname === "/api/admin/meetings") {
    if (!staffOnly(user, response)) return;
    const input = await readBody(request);
    if (!input.title || !input.subject || !input.startAt || !input.duration || !input.url) return send(response, 400, { error: "Judul, mata pelajaran, waktu, durasi, dan link Zoom wajib diisi." });
    try { new URL(String(input.url)); } catch { return send(response, 400, { error: "Link Zoom tidak valid." }); }
    const duration = Number(input.duration);
    const startAt = new Date(String(input.startAt));
    if (!Number.isFinite(duration) || duration < 15 || Number.isNaN(startAt.getTime())) return send(response, 400, { error: "Waktu atau durasi meeting tidak valid." });
    const meeting = { id: crypto.randomUUID(), title: String(input.title).trim(), subject: String(input.subject).trim(), startAt: startAt.toISOString(), duration, url: String(input.url).trim() };
    database.meetings.push(meeting); fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2)); return send(response, 201, { meeting });
  }
  return send(response, 404, { error: "Endpoint tidak ditemukan." });
}
function staticFile(request, response) {
  const relative = new URL(request.url, "http://localhost").pathname === "/" ? "index.html" : new URL(request.url, "http://localhost").pathname.slice(1);
  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(ROOT + path.sep)) return send(response, 403, { error: "Akses ditolak." });
  fs.readFile(file, (error, content) => { if (error) return send(response, 404, { error: "File tidak ditemukan." }); const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" }; response.writeHead(200, { "Content-Type": `${types[path.extname(file)] || "application/octet-stream"}; charset=utf-8`, "Cache-Control": "no-store" }); response.end(content); });
}
http.createServer(async (request, response) => { try { if (request.url.startsWith("/api/")) return await api(request, response); if (request.method !== "GET") return send(response, 405, { error: "Method tidak diizinkan." }); staticFile(request, response); } catch (error) { console.error(error); send(response, 400, { error: "Permintaan tidak valid." }); } }).listen(PORT, process.env.HOST || "0.0.0.0", () => console.log(`RuangKelas berjalan di port ${PORT}`));
