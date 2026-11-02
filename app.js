const $ = (selector) => document.querySelector(selector);
let authMode = "login";
let currentUser = null;
let adminCourses = [];
let adminMaterials = [];

async function api(url, options) {
  const response = await fetch(url, Object.assign({ headers: { "Content-Type": "application/json" } }, options || {}));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Permintaan gagal.");
  return data;
}

function renderTeacherApplications(items) {
  if (!items.length) return '<div class="card"><p>Belum ada pengajuan akun guru.</p></div>';
  return items.map((item) => `<article class="card user-admin-card"><div><h3>${item.name}</h3><small>${item.email} · Menunggu persetujuan</small></div><div class="action-group"><button class="button button-primary" data-approve-teacher="${item.id}">Setujui</button><button class="button button-danger" data-reject-teacher="${item.id}">Tolak</button></div></article>`).join("");
}

async function loadRegistrationCourses() {
  const select = $("#studentCourse");
  select.disabled = true;
  select.innerHTML = '<option value="">Memuat daftar kelas...</option>';
  try {
    const result = await api("/api/courses");
    if (!result.courses.length) {
      select.innerHTML = '<option value="">Belum ada kelas tersedia</option>';
      $("#authError").textContent = "Belum ada kelas yang dapat dipilih.";
      return;
    }
    select.innerHTML = '<option value="">Pilih kelas siswa</option>' + courseOptions(result.courses);
    select.disabled = false;
    $("#authError").textContent = "";
  } catch (error) {
    select.innerHTML = '<option value="">Kelas gagal dimuat</option>';
    $("#authError").textContent = `Daftar kelas tidak dapat dimuat: ${error.message}`;
  }
}

async function reviewTeacherApplication(applicationId, action) {
  const prompt = action === "approve" ? "Setujui pengajuan akun guru ini?" : "Tolak pengajuan akun guru ini?";
  if (!confirm(prompt)) return;
  try {
    await api(`/api/admin/teacher-applications/${encodeURIComponent(applicationId)}/${action}`, { method: "POST" });
    await loadAdmin();
    toast(action === "approve" ? "Akun guru berhasil disetujui." : "Pengajuan guru ditolak.");
  } catch (error) { toast(error.message); }
}

function renderAdminMaterials(items) {
  if (!items.length) return '<div class="card"><p>Belum ada materi. Tambahkan materi baru untuk memulai.</p></div>';
  return items.map((item) => `${renderCards([item], "material").replace("</article>", `<button class="button button-danger" data-delete-material="${item.id}">Hapus materi</button></article>`)}`).join("");
}

function renderAdminCourses(items) {
  if (!items.length) return '<div class="card"><p>Belum ada kelas.</p></div>';
  return items.map((item) => `<article class="card admin-course-card" data-open-course="${item.id}"><div><h3>${item.title}</h3><p>${item.description}</p><small>${item.category} · ${item.level}</small><small class="course-action">Klik untuk melihat materi kelas</small></div><div class="action-group">${currentUser.role === "admin" ? `<button class="button button-danger" data-delete-course="${item.id}">Hapus kelas</button>` : ""}<button class="button button-outline" data-open-course="${item.id}">Lihat materi</button></div></article>`).join("");
}

function renderAdminCourseDetail(courseId) {
  const course = adminCourses.find((item) => item.id === courseId);
  if (!course) return;
  const materials = adminMaterials.filter((item) => item.courseId === courseId);
  $("#adminCourseDetail").classList.remove("hidden");
  $("#adminCourseDetail").innerHTML = `<div class="section-heading"><div><p class="eyebrow">MATERI KELAS</p><h2>${course.title}</h2><p>${course.description}</p></div><button class="button button-outline" data-close-course-detail>Tutup</button></div>${materials.length ? `<div class="card-grid">${renderCards(materials, "material")}</div>` : '<div class="card"><p>Belum ada materi untuk kelas ini.</p></div>'}`;
  $("#adminCourseDetail").scrollIntoView({ behavior: "smooth", block: "start" });
}

function educationLevel(course) {
  if (course.educationLevel) return course.educationLevel;
  const number = Number((course.title.match(/\d+/) || [0])[0]);
  return number <= 6 ? "SD/MI" : number <= 9 ? "SMP/MTs" : number <= 12 ? "SMA/MA" : "Lainnya";
}

function courseOptions(courses) {
  const groups = ["SD/MI", "SMP/MTs", "SMA/MA", "Lainnya"];
  return groups.map((group) => {
    const options = courses.filter((course) => educationLevel(course) === group)
      .sort((a, b) => Number((a.title.match(/\d+/) || [999])[0]) - Number((b.title.match(/\d+/) || [999])[0]))
      .map((course) => `<option value="${course.id}">${course.title}</option>`).join("");
    return options ? `<optgroup label="${group}">${options}</optgroup>` : "";
  }).join("");
}

function renderCourseMaterials(items) {
  if (!items.length) return '<p class="empty-note">Belum ada materi untuk kelas ini.</p>';
  return `<div class="course-materials">${renderCards(items, "material")}</div>`;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2800);
}

async function deleteCourse(courseId) {
  if (!confirm("Hapus kelas ini? Data pendaftaran kelas tersebut juga akan dihapus.")) return;
  try {
    await api(`/api/admin/courses/${encodeURIComponent(courseId)}`, { method: "DELETE" });
    await loadAdmin();
    toast("Kelas berhasil dihapus.");
  } catch (error) { toast(error.message); }
}

async function deleteMaterial(materialId) {
  if (!confirm("Hapus materi ini?")) return;
  try {
    await api(`/api/admin/materials/${encodeURIComponent(materialId)}`, { method: "DELETE" });
    await loadAdmin();
    toast("Materi berhasil dihapus.");
  } catch (error) { toast(error.message); }
}

function setAuthMode(mode) {
  authMode = mode;
  $("#authTitle").textContent = mode === "login" ? "Masuk ke akun" : "Buat akun";
  $("#nameField").classList.toggle("hidden", mode === "login");
  $("#roleField").classList.toggle("hidden", mode === "login");
  updateStudentCourseField();
  $("#authToggle").textContent = mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk";
  $("#authForm").reset();
  $("#authError").textContent = "";
  updateStudentCourseField();
  if (mode === "register" && $("#roleSelect").value === "siswa") loadRegistrationCourses();
}

function updateStudentCourseField() {
  const visible = authMode === "register" && $("#roleSelect").value === "siswa";
  $("#studentCourseField").classList.toggle("hidden", !visible);
  $("#studentCourse").required = visible;
  $("#studentCourse").disabled = !visible;
}

function openAuth(mode) {
  setAuthMode(mode);
  $("#authModal").classList.remove("hidden");
}

function closeModals() {
  $("#authModal").classList.add("hidden");
  $("#materialModal").classList.add("hidden");
  $("#meetingModal").classList.add("hidden");
  $("#userModal").classList.add("hidden");
  $("#courseModal").classList.add("hidden");
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function showDashboard(user) {
  currentUser = user;
  $("#landingView").classList.add("hidden");
  $("#dashboardView").classList.remove("hidden");
  $("#userName").textContent = user.name;
  $("#headerUser").textContent = user.email;
  $("#welcomeName").textContent = `Halo, ${user.name}`;
  $("#userRole").textContent = roleLabel(user.role);
  $("#userInitials").textContent = initials(user.name);
  document.querySelectorAll(".student-only").forEach((item) => item.classList.toggle("hidden", user.role !== "siswa"));
  document.querySelectorAll(".staff-only").forEach((item) => item.classList.toggle("hidden", user.role !== "admin" && user.role !== "guru"));
  document.querySelectorAll(".admin-only").forEach((item) => item.classList.toggle("hidden", user.role !== "admin"));
  document.querySelectorAll(".page").forEach((item) => item.classList.remove("active"));
  document.querySelectorAll(".nav-button").forEach((item) => item.classList.remove("active"));
  const firstView = user.role === "admin" || user.role === "guru" ? "admin" : "home";
  showPage(firstView);
  closeModals();
}

function showPage(view) {
  document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
  document.querySelectorAll(".nav-button[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const page = $("#" + view + "Page");
  if (!page) return;
  page.classList.add("active");
  $("#pageTitle").textContent = view === "admin" ? (currentUser.role === "guru" ? "Panel guru" : "Admin panel") : view === "home" ? "Ringkasan" : view === "courses" ? "Kelas" : "Materi";
  if (view === "courses") loadCourses();
  if (view === "materials") loadMaterials();
  if (view === "admin") loadAdmin();
}

function roleLabel(role) {
  return { admin: "Administrator", guru: "Guru", siswa: "Siswa" }[role] || "Pengguna";
}

function userCourseLabel(user, courses) {
  if (user.role !== "siswa") return "";
  const course = courses.find((item) => item.id === user.courseId);
  return course ? `Kelas: ${course.title} · ${course.educationLevel || course.category}` : "Kelas belum dipilih";
}

function renderCards(items, kind) {
  if (!items.length) return '<div class="card"><p>Belum ada data.</p></div>';
  return items.map((item) => {
    if (kind === "course") return `<article class="card"><h3>${item.title}</h3><p>${item.description}</p><small>${item.category} · ${item.level}</small></article>`;
    if (kind === "meeting") {
      const start = new Date(item.startAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
      return `<article class="card"><h3>${item.title}</h3><p>${item.subject} · ${start}</p><small>${item.duration} menit</small><a class="card-link" href="${item.url}" target="_blank" rel="noopener">Buka Zoom meeting</a></article>`;
    }
    const link = item.fileUrl || item.url;
    return `<article class="card"><h3>${item.title}</h3><p>${item.description || "Materi pembelajaran RuangKelas."}</p><small>${item.subject} · ${item.type}</small>${link ? `<a class="card-link" href="${link}" target="_blank" rel="noopener">${item.fileUrl ? "Buka file materi" : "Buka link materi"}</a>` : ""}</article>`;
  }).join("");
}

async function loadCourses() {
  try {
    const result = await api("/api/courses");
    const courses = currentUser && currentUser.role === "siswa" ? result.courses.filter((course) => course.id === currentUser.courseId) : result.courses;
    $("#courseList").innerHTML = courses.length ? courses.map((course) => `<article class="card course-card"><h3>${course.title}</h3><p>${course.description}</p><small>${course.category} · ${course.level}</small><h4>Materi kelas</h4>${renderCourseMaterials(course.materials)}</article>`).join("") : '<div class="card"><p>Kelas belum dipilih.</p></div>';
  }
  catch (error) { $("#courseList").innerHTML = `<div class="card"><p class="error">${error.message}</p></div>`; }
}

async function loadMaterials() {
  try {
    const result = await api("/api/materials");
    const materials = currentUser && currentUser.role === "siswa" ? result.materials.filter((material) => material.courseId === currentUser.courseId) : result.materials;
    $("#materialList").innerHTML = renderCards(materials, "material");
    $("#meetingList").innerHTML = renderCards(result.meetings, "meeting");
  }
  catch (error) { $("#materialList").innerHTML = `<div class="card"><p class="error">${error.message}</p></div>`; }
}

async function loadAdmin() {
  try {
    const result = await api("/api/admin/summary");
    adminCourses = result.courses;
    adminMaterials = result.materials;
    const students = result.users.filter((item) => item.role === "siswa").length;
    const teachers = result.users.filter((item) => item.role === "guru").length;
    $("#adminSummary").innerHTML = `<div class="stat"><span>Siswa</span><strong>${students}</strong></div><div class="stat"><span>Guru</span><strong>${teachers}</strong></div><div class="stat"><span>Kelas</span><strong>${result.courses.length}</strong></div><div class="stat"><span>Materi</span><strong>${result.materials.length}</strong></div><div class="stat"><span>Zoom meeting</span><strong>${result.meetings.length}</strong></div>`;
    $("#adminCourseList").innerHTML = renderAdminCourses(result.courses);
    $("#adminMaterialList").innerHTML = renderAdminMaterials(result.materials);
    $("#adminMeetingList").innerHTML = renderCards(result.meetings, "meeting");
    $("#adminUserList").innerHTML = result.users.map((item) => `<article class="card user-admin-card"><div><h3>${item.name}</h3><small>${item.email} · ${roleLabel(item.role)}</small>${userCourseLabel(item, result.courses) ? `<strong class="account-course">${userCourseLabel(item, result.courses)}</strong>` : ""}</div>${item.id === currentUser.id ? "<small>Akun aktif</small>" : currentUser.role === "admin" ? `<button class="button button-danger" data-delete-user="${item.id}">Hapus</button>` : ""}</article>`).join("");
    $("#teacherApplicationList").innerHTML = currentUser.role === "admin" ? renderTeacherApplications(result.teacherApplications || []) : "";
    $("#materialCourse").innerHTML = result.courses.length ? courseOptions(result.courses) : '<option value="">Buat kelas terlebih dahulu</option>';
    $("#materialCourse").disabled = !result.courses.length;
  } catch (error) {
    $("#adminSummary").innerHTML = `<div class="card"><p class="error">${error.message}</p></div>`;
  }
}

async function submitAuth(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  $("#authError").textContent = "";
  try {
    const result = await api(authMode === "login" ? "/api/auth/login" : "/api/auth/register", { method: "POST", body: JSON.stringify(Object.fromEntries(form.entries())) });
    if (result.pending) {
      form.reset();
      closeModals();
      toast(result.message);
      return;
    }
    showDashboard(result.user);
    toast("Login berhasil.");
  } catch (error) { $("#authError").textContent = error.message; }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  currentUser = null;
  $("#dashboardView").classList.add("hidden");
  $("#landingView").classList.remove("hidden");
  toast("Kamu sudah keluar.");
}

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]");
  const nav = event.target.closest("[data-view]");
  if (action) {
    if (action.dataset.action === "open-login") openAuth("login");
    if (action.dataset.action === "open-register") openAuth("register");
    if (action.dataset.action === "close-auth" || action.dataset.action === "close-material" || action.dataset.action === "close-meeting" || action.dataset.action === "close-user" || action.dataset.action === "close-course") closeModals();
    if (action.dataset.action === "open-material") $("#materialModal").classList.remove("hidden");
    if (action.dataset.action === "open-meeting") $("#meetingModal").classList.remove("hidden");
    if (action.dataset.action === "open-user") $("#userModal").classList.remove("hidden");
    if (action.dataset.action === "open-course") $("#courseModal").classList.remove("hidden");
  }
  if (nav) showPage(nav.dataset.view);
  const deleteButton = event.target.closest("[data-delete-user]");
  if (deleteButton) deleteUser(deleteButton.dataset.deleteUser);
  const deleteCourseButton = event.target.closest("[data-delete-course]");
  if (deleteCourseButton) deleteCourse(deleteCourseButton.dataset.deleteCourse);
  const deleteMaterialButton = event.target.closest("[data-delete-material]");
  if (deleteMaterialButton) deleteMaterial(deleteMaterialButton.dataset.deleteMaterial);
  const openCourseButton = event.target.closest("[data-open-course]");
  if (openCourseButton && !event.target.closest("[data-delete-course]")) renderAdminCourseDetail(openCourseButton.dataset.openCourse);
  const closeCourseDetailButton = event.target.closest("[data-close-course-detail]");
  if (closeCourseDetailButton) $("#adminCourseDetail").classList.add("hidden");
  const approveTeacherButton = event.target.closest("[data-approve-teacher]");
  if (approveTeacherButton) reviewTeacherApplication(approveTeacherButton.dataset.approveTeacher, "approve");
  const rejectTeacherButton = event.target.closest("[data-reject-teacher]");
  if (rejectTeacherButton) reviewTeacherApplication(rejectTeacherButton.dataset.rejectTeacher, "reject");
});
$("#courseForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/api/admin/courses", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    form.reset();
    closeModals();
    await loadAdmin();
    toast("Kelas berhasil ditambahkan.");
  } catch (error) { $("#courseError").textContent = error.message; }
});

async function deleteUser(userId) {
  if (!confirm("Hapus akun ini? Data pendaftaran kelas akun tersebut juga akan dihapus.")) return;
  try {
    await api(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    await loadAdmin();
    toast("Akun berhasil dihapus.");
  } catch (error) { toast(error.message); }
}

$("#authToggle").addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
$("#roleSelect").addEventListener("change", () => {
  updateStudentCourseField();
  if (authMode === "register" && $("#roleSelect").value === "siswa") loadRegistrationCourses();
});
$("#authForm").addEventListener("submit", submitAuth);
$("#logoutButton").addEventListener("click", logout);
$("#materialForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const formData = new FormData(form);
    const file = formData.get("file");
    const input = Object.fromEntries(formData.entries());
    delete input.file;
    if (file && file.size) {
      if (file.size > 25 * 1024 * 1024) throw new Error("Ukuran file maksimal 25 MB.");
      input.fileName = file.name;
      input.fileType = file.type || "application/octet-stream";
      input.fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("File tidak dapat dibaca."));
        reader.readAsDataURL(file);
      });
    }
    await api("/api/admin/materials", { method: "POST", body: JSON.stringify(input) });
    form.reset();
    closeModals();
    await loadAdmin();
    toast("Materi berhasil disimpan.");
  } catch (error) { $("#materialError").textContent = error.message; }
});
$("#meetingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/api/admin/meetings", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    form.reset();
    closeModals();
    await loadAdmin();
    toast("Zoom meeting berhasil dibuat.");
  } catch (error) { $("#meetingError").textContent = error.message; }
});
$("#userForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/api/admin/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    form.reset();
    closeModals();
    toast("Akun berhasil dibuat.");
  } catch (error) { $("#userError").textContent = error.message; }
});

async function init() {
  try {
    const result = await api("/api/me");
    if (result.user) showDashboard(result.user);
  } catch (error) { console.error(error); }
}
init();
