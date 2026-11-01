// =====================================================================
// Jadwal & Jurnal Harian  --  JavaScript murni + Firebase Auth + Firestore
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ---------- Data & konstanta ---------- */
const HARI = [
  { id: "senin", label: "Senin" },
  { id: "selasa", label: "Selasa" },
  { id: "rabu", label: "Rabu" },
  { id: "kamis", label: "Kamis" },
  { id: "jumat", label: "Jumat" },
];
// getDay(): 0 = Minggu ... 6 = Sabtu
const HARI_DARI_ANGKA = { 1: "senin", 2: "selasa", 3: "rabu", 4: "kamis", 5: "jumat" };

// Jadwal awal, diisi otomatis ke Firestore hanya jika koleksi masih kosong
const JADWAL_AWAL = {
  senin: ["MTK", "Sejarah", "KIK", "PJOK"],
  selasa: ["Keamanan Jaringan", "Koding", "PPKN"],
  rabu: ["Bahasa Inggris", "Bahasa Indonesia", "TJKN"],
  kamis: ["PAI", "Bahasa Jawa", "PKPJ"],
  jumat: ["ASJ"],
};

const ICON = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
};
const ikon = (n) => `<span class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg></span>`;

/* ---------- State aplikasi ---------- */
const state = {
  uid: null,               // id pengguna yang sedang login (null = belum login)
  jadwal: Object.fromEntries(HARI.map((h) => [h.id, []])),
  jurnal: [],
  nama: "",
  hariAktif: "senin",
  hariIni: null,           // id hari ini (null saat akhir pekan)
  editJurnalId: null,
  dlg: { hari: null, index: null }, // null index = tambah baru
  muat: { jadwal: true, jurnal: true },
  gagal: { jadwal: "", jurnal: "" },
};
let db = null;
let auth = null;

const $ = (s) => document.querySelector(s);
const el = {
  viewMuat: $("#viewMuat"), viewLogin: $("#viewLogin"), app: $("#app"),
  formLogin: $("#formLogin"), inEmail: $("#inEmail"), inPassword: $("#inPassword"),
  pesanLogin: $("#pesanLogin"), btnLogin: $("#btnLogin"), btnKeluar: $("#btnKeluar"),
  banner: $("#banner"), toast: $("#toast"),
  sapaan: $("#sapaan"), tanggalHariIni: $("#tanggalHariIni"), ajakNama: $("#ajakNama"),
  tabsHari: $("#tabsHari"), judulHari: $("#judulHari"), infoHari: $("#infoHari"),
  btnTambahMapel: $("#btnTambahMapel"), listPelajaran: $("#listPelajaran"),
  formJurnal: $("#formJurnal"), judulFormJurnal: $("#judulFormJurnal"),
  inTanggal: $("#inTanggal"), selMapel: $("#selMapel"), inGuru: $("#inGuru"),
  inJam: $("#inJam"), inTopik: $("#inTopik"), pesanForm: $("#pesanForm"),
  btnSimpanJurnal: $("#btnSimpanJurnal"), btnBatalEdit: $("#btnBatalEdit"),
  inFilterTanggal: $("#inFilterTanggal"), selFilterMapel: $("#selFilterMapel"),
  btnResetFilter: $("#btnResetFilter"), listJurnal: $("#listJurnal"), jumlahJurnal: $("#jumlahJurnal"),
  formProfil: $("#formProfil"), inNama: $("#inNama"), pesanProfil: $("#pesanProfil"), btnSimpanProfil: $("#btnSimpanProfil"),
  dlg: $("#dlgMapel"), formMapel: $("#formMapel"), dlgJudul: $("#dlgJudul"),
  inMapel: $("#inMapel"), dlgError: $("#dlgError"), dlgBatal: $("#dlgBatal"),
};

/* ---------- Fungsi bantu ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const tanggalLokal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseTanggal = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const hariIdDariTanggal = (s) => (s ? HARI_DARI_ANGKA[parseTanggal(s).getDay()] || null : null);
const formatTanggal = (s, panjang = true) =>
  new Intl.DateTimeFormat("id-ID", { weekday: panjang ? "long" : "short", day: "numeric", month: panjang ? "long" : "short", year: "numeric" }).format(parseTanggal(s));
const labelHari = (id) => HARI.find((h) => h.id === id)?.label || "";

function toast(pesan) {
  el.toast.textContent = pesan;
  el.toast.classList.add("tampil");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.toast.classList.remove("tampil"), 2600);
}
function tampilBanner(pesan) { el.banner.textContent = pesan; el.banner.hidden = !pesan; }
function setPesan(node, pesan) { node.textContent = pesan || ""; node.hidden = !pesan; }

// Ubah error Firestore menjadi pesan ramah
function pesanError(err, aksi) {
  const kode = err?.code || "";
  if (kode === "permission-denied") return `Gagal ${aksi}: akses ditolak. Pastikan Firestore Rules sudah benar dan kamu masuk dengan akun pemilik.`;
  if (kode === "unavailable" || !navigator.onLine) return `Gagal ${aksi}: koneksi internet bermasalah. Coba lagi sebentar lagi.`;
  if (kode === "not-found" || kode === "failed-precondition") return `Gagal ${aksi}: database Firestore belum dibuat/aktif di proyek Firebase.`;
  return `Gagal ${aksi}. ${err?.message || "Terjadi kesalahan tak terduga."}`;
}
// Ubah error Authentication menjadi pesan ramah
function pesanAuth(err) {
  switch (err?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "Email atau kata sandi salah. Coba periksa lagi.";
    case "auth/invalid-email": return "Format email tidak valid.";
    case "auth/too-many-requests": return "Terlalu banyak percobaan masuk. Tunggu beberapa menit lalu coba lagi.";
    case "auth/network-request-failed": return "Koneksi internet bermasalah. Coba lagi sebentar lagi.";
    case "auth/user-disabled": return "Akun ini dinonaktifkan.";
    case "auth/operation-not-allowed": return "Login Email/Kata sandi belum diaktifkan di Firebase Console.";
    case "auth/unauthorized-domain": return "Domain situs ini belum diizinkan di Firebase (Authentication → Settings → Authorized domains).";
    default: return `Gagal masuk. ${err?.message || "Terjadi kesalahan tak terduga."}`;
  }
}
function pastikanDb() {
  if (!db) throw new Error("Firebase belum dikonfigurasi. Isi firebase-config.js terlebih dulu.");
}
const loadingHTML = (t) => `<li class="loading"><span class="spinner"></span>${t}</li>`;
const kosongHTML = (emoji, t) => `<li class="kosong"><span class="emoji">${emoji}</span>${t}</li>`;

/* ---------- Navigasi halaman ---------- */
function tampilkanHalaman(nama) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  void document.body.offsetWidth; // paksa animasi mulai ulang
  $(`#page-${nama}`).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach((b) => {
    const aktif = b.dataset.page === nama;
    b.classList.toggle("active", aktif);
    aktif ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* =====================================================================
   LOGIN & KELUAR
   ===================================================================== */
// Tampilkan aplikasi (sudah login) atau layar login (belum login)
function tampilApp(masuk) {
  el.viewMuat.hidden = true;
  el.viewLogin.hidden = masuk;
  el.app.hidden = !masuk;
  document.body.classList.toggle("mode-login", !masuk);
}

async function prosesLogin(e) {
  e.preventDefault();
  const email = el.inEmail.value.trim();
  const sandi = el.inPassword.value;
  if (!email || !sandi) { setPesan(el.pesanLogin, "Isi email dan kata sandi dulu ya."); return; }
  if (!auth) { setPesan(el.pesanLogin, "Firebase belum dikonfigurasi. Isi firebase-config.js terlebih dulu."); return; }
  setPesan(el.pesanLogin, "");
  el.btnLogin.disabled = true;
  el.btnLogin.textContent = "Memproses...";
  try {
    await signInWithEmailAndPassword(auth, email, sandi);
    el.inPassword.value = ""; // tampilan berpindah lewat onAuthStateChanged
  } catch (err) {
    console.error(err);
    setPesan(el.pesanLogin, pesanAuth(err));
  } finally {
    el.btnLogin.disabled = false;
    el.btnLogin.textContent = "Masuk";
  }
}

async function prosesKeluar() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error(err);
    toast("Gagal keluar. Coba lagi.");
  }
}

// Kosongkan semua data di layar saat keluar
function bersihkanData() {
  state.uid = null;
  state.jadwal = Object.fromEntries(HARI.map((h) => [h.id, []]));
  state.jurnal = [];
  state.nama = "";
  state.muat = { jadwal: true, jurnal: true };
  state.gagal = { jadwal: "", jurnal: "" };
  el.inNama.value = "";
  el.inFilterTanggal.value = "";
  tampilBanner("");
  resetFormJurnal();
  renderSapaan(); renderPanel(); renderJurnal(); isiOpsiFilter();
  tampilkanHalaman("jadwal");
}

// Dipanggil tiap status login berubah (termasuk saat halaman dibuka ulang)
async function saatStatusLoginBerubah(user) {
  if (user) {
    if (state.uid === user.uid) return;
    state.uid = user.uid;
    tampilApp(true);
    await Promise.all([muatJadwal(), muatJurnal(), muatProfil()]);
    isiJamOtomatis();
  } else {
    bersihkanData();
    tampilApp(false);
  }
}

/* =====================================================================
   JADWAL
   ===================================================================== */
function renderSapaan() {
  const hariIni = new Date();
  el.tanggalHariIni.textContent = formatTanggal(tanggalLokal(hariIni));
  el.sapaan.textContent = state.nama ? `Halo, ${state.nama}!` : "Halo!";
  el.ajakNama.hidden = !!state.nama; // ajakan mengisi nama jika kosong
}

function renderTabs() {
  el.tabsHari.innerHTML = HARI.map((h) => {
    const aktif = h.id === state.hariAktif;
    const today = h.id === state.hariIni;
    return `<button class="tab ${aktif ? "active" : ""}" role="tab" aria-selected="${aktif}" data-hari="${h.id}">
      ${h.label}${today ? '<span class="dot" title="Hari ini"></span>' : ""}</button>`;
  }).join("");
}

function renderPanel() {
  const id = state.hariAktif;
  const daftar = state.jadwal[id] || [];
  el.judulHari.textContent = labelHari(id);
  el.infoHari.textContent = id === state.hariIni ? "Hari ini ✨" : state.hariIni ? "" : "Akhir pekan: menampilkan jadwal Senin";
  if (state.muat.jadwal) { el.listPelajaran.innerHTML = loadingHTML("Memuat jadwal..."); return; }
  if (state.gagal.jadwal) { el.listPelajaran.innerHTML = kosongHTML("😕", esc(state.gagal.jadwal)); return; }
  if (!daftar.length) { el.listPelajaran.innerHTML = kosongHTML("🌿", "Belum ada pelajaran di hari ini.<br>Tekan “Tambah” untuk menambahkan."); return; }
  el.listPelajaran.innerHTML = daftar.map((m, i) => `
    <li class="item" style="--i:${i}">
      <span class="jam" title="Jam ke-${i + 1}">${i + 1}</span>
      <div class="item-isi"><div class="item-judul">${esc(m)}</div></div>
      <div class="aksi">
        <button class="icon-btn" data-aksi="ubah" data-index="${i}" aria-label="Ubah ${esc(m)}">${ikon("edit")}</button>
        <button class="icon-btn hapus" data-aksi="hapus" data-index="${i}" aria-label="Hapus ${esc(m)}">${ikon("trash")}</button>
      </div>
    </li>`).join("");
}

// Simpan satu hari ke Firestore (satu dokumen per hari)
async function simpanHari(id, pelajaran) {
  pastikanDb();
  const urutan = HARI.findIndex((h) => h.id === id) + 1;
  await setDoc(doc(db, "jadwal", id), { hari: labelHari(id), urutan, pelajaran });
}

async function muatJadwal() {
  state.muat.jadwal = true; renderPanel();
  try {
    pastikanDb();
    let snap = await getDocs(collection(db, "jadwal"));
    if (snap.empty) {
      // Database kosong: isi jadwal awal sekali saja
      const batch = writeBatch(db);
      HARI.forEach((h, i) => batch.set(doc(db, "jadwal", h.id), { hari: h.label, urutan: i + 1, pelajaran: JADWAL_AWAL[h.id] }));
      await batch.commit();
      snap = await getDocs(collection(db, "jadwal"));
    }
    const data = Object.fromEntries(HARI.map((h) => [h.id, []]));
    snap.forEach((d) => { if (d.id in data) data[d.id] = Array.isArray(d.data().pelajaran) ? d.data().pelajaran : []; });
    state.jadwal = data;
    state.gagal.jadwal = "";
  } catch (err) {
    console.error(err);
    state.gagal.jadwal = pesanError(err, "memuat jadwal");
  } finally {
    state.muat.jadwal = false;
    renderPanel(); isiOpsiMapel(el.selMapel.value); isiOpsiFilter();
  }
}

function bukaDialogMapel(index = null) {
  state.dlg = { hari: state.hariAktif, index };
  el.dlgJudul.textContent = index === null ? `Tambah Pelajaran (${labelHari(state.hariAktif)})` : "Ubah Mata Pelajaran";
  el.inMapel.value = index === null ? "" : state.jadwal[state.hariAktif][index];
  setPesan(el.dlgError, "");
  el.dlg.showModal();
  el.inMapel.focus();
}

async function simpanMapel(e) {
  e.preventDefault();
  const nama = el.inMapel.value.trim();
  if (!nama) { setPesan(el.dlgError, "Nama pelajaran tidak boleh kosong."); return; }
  const { hari, index } = state.dlg;
  const baru = [...state.jadwal[hari]];
  index === null ? baru.push(nama) : (baru[index] = nama);
  try {
    await simpanHari(hari, baru);
    state.jadwal[hari] = baru;
    el.dlg.close();
    renderPanel(); isiOpsiMapel(el.selMapel.value); isiOpsiFilter();
    toast("Jadwal diperbarui ✨");
  } catch (err) {
    console.error(err);
    setPesan(el.dlgError, pesanError(err, "menyimpan pelajaran"));
  }
}

async function hapusMapel(index) {
  const hari = state.hariAktif;
  const nama = state.jadwal[hari][index];
  if (!confirm(`Hapus “${nama}” dari jadwal ${labelHari(hari)}?`)) return;
  const baru = state.jadwal[hari].filter((_, i) => i !== index);
  try {
    await simpanHari(hari, baru);
    state.jadwal[hari] = baru;
    renderPanel(); isiOpsiMapel(el.selMapel.value); isiOpsiFilter();
    toast("Pelajaran dihapus");
  } catch (err) {
    console.error(err);
    tampilBanner(pesanError(err, "menghapus pelajaran"));
  }
}

/* =====================================================================
   JURNAL
   ===================================================================== */
// Isi dropdown pelajaran: pelajaran hari yang dipilih ditaruh paling atas
function isiOpsiMapel(pilih = "") {
  const hariId = hariIdDariTanggal(el.inTanggal.value);
  const hariItu = [...new Set(hariId ? state.jadwal[hariId] : [])];
  const semua = [...new Set(HARI.flatMap((h) => state.jadwal[h.id]))];
  const lainnya = semua.filter((m) => !hariItu.includes(m));
  if (pilih && !semua.includes(pilih)) lainnya.push(pilih); // pelajaran lama yang sudah dihapus dari jadwal
  const opsi = (arr) => arr.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
  let html = "";
  if (hariItu.length) html += `<optgroup label="Pelajaran hari ini">${opsi(hariItu)}</optgroup>`;
  if (lainnya.length) html += `<optgroup label="Pelajaran lainnya">${opsi(lainnya)}</optgroup>`;
  el.selMapel.innerHTML = html || '<option value="" disabled selected>Belum ada pelajaran di jadwal</option>';
  const valid = [...hariItu, ...lainnya];
  el.selMapel.value = valid.includes(pilih) ? pilih : hariItu[0] || "";
}

// Jam ke- otomatis sesuai urutan di jadwal (masih bisa diubah manual)
function isiJamOtomatis() {
  const hariId = hariIdDariTanggal(el.inTanggal.value);
  if (!hariId) return;
  const idx = state.jadwal[hariId].indexOf(el.selMapel.value);
  if (idx >= 0) el.inJam.value = idx + 1;
}

function isiOpsiFilter() {
  const semua = [...new Set([...HARI.flatMap((h) => state.jadwal[h.id]), ...state.jurnal.map((j) => j.pelajaran)])];
  const sekarang = el.selFilterMapel.value;
  el.selFilterMapel.innerHTML = '<option value="">Semua pelajaran</option>' + semua.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
  el.selFilterMapel.value = semua.includes(sekarang) ? sekarang : "";
}

function renderJurnal() {
  if (state.muat.jurnal) { el.listJurnal.innerHTML = loadingHTML("Memuat jurnal..."); return; }
  if (state.gagal.jurnal) { el.listJurnal.innerHTML = kosongHTML("😕", esc(state.gagal.jurnal)); el.jumlahJurnal.textContent = "0"; return; }
  const fTgl = el.inFilterTanggal.value, fMapel = el.selFilterMapel.value;
  const daftar = state.jurnal
    .filter((j) => (!fTgl || j.tanggal === fTgl) && (!fMapel || j.pelajaran === fMapel))
    .sort((a, b) => b.tanggal.localeCompare(a.tanggal) || a.jam - b.jam); // terbaru dulu
  el.jumlahJurnal.textContent = daftar.length;
  if (!state.jurnal.length) { el.listJurnal.innerHTML = kosongHTML("📓", "Belum ada jurnal.<br>Yuk catat pelajaran pertamamu!"); return; }
  if (!daftar.length) { el.listJurnal.innerHTML = kosongHTML("🔍", "Tidak ada jurnal yang cocok dengan filter."); return; }
  el.listJurnal.innerHTML = daftar.map((j, i) => `
    <li class="item" style="--i:${Math.min(i, 8)}">
      <div class="item-isi">
        <div><span class="badge pelajaran">${esc(j.pelajaran)}</span><span class="badge">Jam ke-${esc(j.jam)}</span></div>
        <div class="item-meta">${formatTanggal(j.tanggal, false)} · ${esc(j.guru)}</div>
        <div class="item-topik">${esc(j.topik)}</div>
      </div>
      <div class="aksi">
        <button class="icon-btn" data-aksi="ubah" data-id="${esc(j.id)}" aria-label="Ubah jurnal">${ikon("edit")}</button>
        <button class="icon-btn hapus" data-aksi="hapus" data-id="${esc(j.id)}" aria-label="Hapus jurnal">${ikon("trash")}</button>
      </div>
    </li>`).join("");
}

async function muatJurnal() {
  state.muat.jurnal = true; renderJurnal();
  try {
    pastikanDb();
    const snap = await getDocs(collection(db, "jurnal"));
    state.jurnal = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((j) => j.tanggal);
    state.gagal.jurnal = "";
  } catch (err) {
    console.error(err);
    state.gagal.jurnal = pesanError(err, "memuat jurnal");
  } finally {
    state.muat.jurnal = false;
    renderJurnal(); isiOpsiFilter();
  }
}

function resetFormJurnal() {
  state.editJurnalId = null;
  el.formJurnal.reset();
  el.inTanggal.value = tanggalLokal();
  isiOpsiMapel(); isiJamOtomatis();
  el.judulFormJurnal.textContent = "Catat Jurnal Belajar";
  el.btnSimpanJurnal.textContent = "Simpan Jurnal";
  el.btnBatalEdit.hidden = true;
  setPesan(el.pesanForm, "");
}

async function simpanJurnal(e) {
  e.preventDefault();
  const data = {
    tanggal: el.inTanggal.value, pelajaran: el.selMapel.value,
    guru: el.inGuru.value.trim(), jam: Number(el.inJam.value), topik: el.inTopik.value.trim(),
  };
  if (!data.tanggal || !data.pelajaran || !data.guru || !data.jam || !data.topik) {
    setPesan(el.pesanForm, "Lengkapi semua kolom dulu ya."); return;
  }
  setPesan(el.pesanForm, "");
  el.btnSimpanJurnal.disabled = true;
  try {
    pastikanDb();
    if (state.editJurnalId) await updateDoc(doc(db, "jurnal", state.editJurnalId), { ...data, diubah: serverTimestamp() });
    else await addDoc(collection(db, "jurnal"), { ...data, dibuat: serverTimestamp() });
    const edit = !!state.editJurnalId;
    await muatJurnal();
    resetFormJurnal();
    toast(edit ? "Jurnal diperbarui ✨" : "Jurnal tersimpan ✨");
  } catch (err) {
    console.error(err);
    setPesan(el.pesanForm, pesanError(err, "menyimpan jurnal"));
  } finally {
    el.btnSimpanJurnal.disabled = false;
  }
}

function ubahJurnal(id) {
  const j = state.jurnal.find((x) => x.id === id);
  if (!j) return;
  state.editJurnalId = id;
  el.inTanggal.value = j.tanggal;
  isiOpsiMapel(j.pelajaran); // jangan timpa jam: pakai data tersimpan
  el.inGuru.value = j.guru; el.inJam.value = j.jam; el.inTopik.value = j.topik;
  el.judulFormJurnal.textContent = "Ubah Jurnal";
  el.btnSimpanJurnal.textContent = "Simpan Perubahan";
  el.btnBatalEdit.hidden = false;
  setPesan(el.pesanForm, "");
  el.formJurnal.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function hapusJurnal(id) {
  if (!confirm("Hapus jurnal ini?")) return;
  try {
    pastikanDb();
    await deleteDoc(doc(db, "jurnal", id));
    state.jurnal = state.jurnal.filter((j) => j.id !== id);
    if (state.editJurnalId === id) resetFormJurnal();
    renderJurnal(); isiOpsiFilter();
    toast("Jurnal dihapus");
  } catch (err) {
    console.error(err);
    tampilBanner(pesanError(err, "menghapus jurnal"));
  }
}

/* =====================================================================
   PROFIL
   ===================================================================== */
async function muatProfil() {
  try {
    pastikanDb();
    const snap = await getDoc(doc(db, "profil", "utama"));
    state.nama = snap.exists() ? snap.data().nama || "" : "";
    el.inNama.value = state.nama;
  } catch (err) {
    console.error(err);
    tampilBanner(pesanError(err, "memuat profil"));
  } finally {
    renderSapaan();
  }
}

async function simpanProfil(e) {
  e.preventDefault();
  const nama = el.inNama.value.trim();
  if (!nama) { setPesan(el.pesanProfil, "Nama tidak boleh kosong."); return; }
  setPesan(el.pesanProfil, "");
  el.btnSimpanProfil.disabled = true;
  try {
    pastikanDb();
    await setDoc(doc(db, "profil", "utama"), { nama }, { merge: true });
    state.nama = nama;
    renderSapaan();
    toast(`Tersimpan. Halo, ${nama}!`);
  } catch (err) {
    console.error(err);
    setPesan(el.pesanProfil, pesanError(err, "menyimpan nama"));
  } finally {
    el.btnSimpanProfil.disabled = false;
  }
}

/* =====================================================================
   INISIALISASI
   ===================================================================== */
function pasangEvent() {
  document.querySelectorAll(".ico[data-icon]").forEach((n) => { n.outerHTML = ikon(n.dataset.icon); });

  // Login & keluar
  el.formLogin.addEventListener("submit", prosesLogin);
  el.btnKeluar.addEventListener("click", prosesKeluar);

  // Navigasi
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-page]");
    if (nav) tampilkanHalaman(nav.dataset.page);
    const goto = e.target.closest("[data-goto]");
    if (goto) tampilkanHalaman(goto.dataset.goto);
  });

  // Jadwal
  el.tabsHari.addEventListener("click", (e) => {
    const t = e.target.closest("[data-hari]");
    if (!t) return;
    state.hariAktif = t.dataset.hari;
    renderTabs(); renderPanel();
  });
  el.btnTambahMapel.addEventListener("click", () => bukaDialogMapel());
  el.listPelajaran.addEventListener("click", (e) => {
    const b = e.target.closest("[data-aksi]");
    if (!b) return;
    const i = Number(b.dataset.index);
    b.dataset.aksi === "ubah" ? bukaDialogMapel(i) : hapusMapel(i);
  });
  el.formMapel.addEventListener("submit", simpanMapel);
  el.dlgBatal.addEventListener("click", () => el.dlg.close());

  // Jurnal
  el.inTanggal.addEventListener("change", () => { isiOpsiMapel(); isiJamOtomatis(); });
  el.selMapel.addEventListener("change", isiJamOtomatis);
  el.formJurnal.addEventListener("submit", simpanJurnal);
  el.btnBatalEdit.addEventListener("click", resetFormJurnal);
  el.inFilterTanggal.addEventListener("change", renderJurnal);
  el.selFilterMapel.addEventListener("change", renderJurnal);
  el.btnResetFilter.addEventListener("click", () => { el.inFilterTanggal.value = ""; el.selFilterMapel.value = ""; renderJurnal(); });
  el.listJurnal.addEventListener("click", (e) => {
    const b = e.target.closest("[data-aksi]");
    if (!b) return;
    b.dataset.aksi === "ubah" ? ubahJurnal(b.dataset.id) : hapusJurnal(b.dataset.id);
  });

  // Profil
  el.formProfil.addEventListener("submit", simpanProfil);
}

function init() {
  pasangEvent();

  // Tentukan hari awal: hari ini (Senin-Jumat), akhir pekan -> Senin
  state.hariIni = HARI_DARI_ANGKA[new Date().getDay()] || null;
  state.hariAktif = state.hariIni || "senin";
  renderSapaan(); renderTabs(); renderPanel(); renderJurnal();
  el.inTanggal.value = tanggalLokal();
  isiOpsiMapel(); isiOpsiFilter();

  // Cek konfigurasi Firebase sudah diisi atau belum
  const belumDiisi = !firebaseConfig.apiKey || String(firebaseConfig.apiKey).startsWith("ISI_");
  if (belumDiisi) {
    tampilApp(false);
    setPesan(el.pesanLogin, "Firebase belum dikonfigurasi. Buka firebase-config.js dan isi dengan konfigurasi proyek Firebase-mu.");
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
  } catch (err) {
    console.error(err);
    tampilApp(false);
    setPesan(el.pesanLogin, pesanError(err, "menyambung ke Firebase"));
    return;
  }

  // Sesi login tersimpan di browser, jadi buka ulang situs tidak perlu login lagi
  onAuthStateChanged(auth, saatStatusLoginBerubah, (err) => {
    console.error(err);
    tampilApp(false);
    setPesan(el.pesanLogin, pesanAuth(err));
  });
}

init();
