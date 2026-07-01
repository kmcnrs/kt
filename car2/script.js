// ============================================================
// CONFIG
// ============================================================
const API_URL = "https://script.google.com/macros/s/AKfycbyuwk8mX9Jd1Z8Qnrn8N3ofPyxuxwtYeRre55BGSwlnCR-2n5UznDJ_IabgNlAHK9mW_w/exec";
// ⚠️ ความปลอดภัย: รหัส admin และรหัสแผนกไม่ได้เก็บไว้ในไฟล์นี้อีกต่อไป (เคยฝัง plain text ไว้ตรงนี้
// ซึ่งใครก็เปิด view-source ดูได้) ตอนนี้ระบบ hash รหัสฝั่งเครื่อง (hashPassword) แล้วส่งไปให้ Apps Script
// เป็นคนเทียบกับค่าที่เก็บไว้ใน Script Properties ฝั่ง server แทน — ดูฟังก์ชัน adminLoginSubmit()
// และ departmentLogin() ด้านล่าง พร้อมคำแนะนำตั้งค่า Code.gs ท้ายไฟล์นี้

// ⚠️ ตำแหน่งคอลัมน์ (index เริ่มที่ 0) ของ "รหัสผ่านส่วนตัว (hash)" ในแถวข้อมูลที่ API_URL ส่งกลับมา
// ต้องตรงกับลำดับคอลัมน์จริงใน Google Sheet หลังจากที่แก้ Apps Script ให้บันทึกค่านี้แล้ว (ดูคำแนะนำท้ายไฟล์)
// ค่าเริ่มต้นนี้สมมติว่าเพิ่มเป็นคอลัมน์ใหม่ "ต่อท้าย" คอลัมน์ status (r[11]) — แก้เลขนี้ให้ตรงกับชีตจริงของคุณ
const PASSWORD_COL = 12;

// รายชื่อแผนกที่ใช้แสดงใน dropdown (ค่า "ถูกต้องหรือไม่" ของรหัสแผนกแต่ละแผนกตรวจที่ฝั่ง server เท่านั้น)
const DEPARTMENT_LIST = ["IT", "HR", "การเงิน", "พัสดุ", "วิจัย"];

// รายการรถจริงในระบบ — ต้องตรงกับ <option value="..."> ของ select#car ในฟอร์มจอง
// เพราะ "car" คือค่าที่ถูกบันทึกไว้ใน Sheet ทุกครั้งที่มีการจอง
const VEHICLES = [
  { id: "v1", name: "รถตู้ 1",   plate: "กข-1234", car: "รถตู้ 1 (กข-1234)",   icon: "🚐" },
  { id: "v2", name: "รถตู้ 2",   plate: "กข-5678", car: "รถตู้ 2 (กข-5678)",   icon: "🚐" },
  { id: "v3", name: "รถกระบะ 1", plate: "บย-1111", car: "รถกระบะ 1 (บย-1111)", icon: "🛻" },
  { id: "v4", name: "รถกระบะ 2", plate: "บย-2222", car: "รถกระบะ 2 (บย-2222)", icon: "🛻" }
];

// ============================================================
// VEHICLE MANAGEMENT STATE — สถานะรถที่ Admin จัดการ (เก็บใน localStorage)
// ============================================================
// vehicleStatus: { [vehicleId]: "active" | "maintenance" }
// vehicleList: array ของ VEHICLES ที่ Admin เพิ่มเอง (รวมกับ VEHICLES เริ่มต้น)

function getVehicleStatuses() {
  try {
    return JSON.parse(localStorage.getItem("vehicleStatuses") || "{}");
  } catch { return {}; }
}

function setVehicleStatus(vehicleId, status) {
  const statuses = getVehicleStatuses();
  statuses[vehicleId] = status;
  localStorage.setItem("vehicleStatuses", JSON.stringify(statuses));
}

function getCustomVehicles() {
  try {
    return JSON.parse(localStorage.getItem("customVehicles") || "[]");
  } catch { return []; }
}

function getAllVehicles() {
  const custom = getCustomVehicles();
  return [...VEHICLES, ...custom];
}

function isVehicleMaintenance(vehicleId) {
  const statuses = getVehicleStatuses();
  return statuses[vehicleId] === "maintenance";
}

// ============================================================
// CONFLICT DETECTION — ตรวจสอบการซ้อนทับของช่วงเวลาจอง
// ============================================================

// รับ bookings rows จาก API และช่วงเวลาที่ต้องการจอง
// คืนค่า array ของ bookings ที่ชนกัน (ซ้อนทับ)
function detectConflicts(allRows, carName, newStart, newEnd, excludeId = null) {
  const conflicts = [];
  allRows.forEach(r => {
    if (!r || !r[4]) return;
    if ((r[4] || "").trim() !== carName.trim()) return;
    if (r[11] === "ยกเลิก" || r[11] === "ไม่อนุมัติ") return;
    if (excludeId && r[0] === excludeId) return;

    const start = combineDateTime(r[5], r[6]);
    const end   = combineDateTime(r[7], r[8]);
    if (!start || !end) return;

    // ซ้อนทับถ้า: newStart < existingEnd AND newEnd > existingStart
    if (newStart < end && newEnd > start) {
      conflicts.push(r);
    }
  });
  return conflicts;
}

// แสดง conflict warning ในฟอร์มจอง
async function checkConflictOnForm() {
  const carEl       = document.getElementById("car");
  const startDateEl = document.getElementById("startDate");
  const startTimeEl = document.getElementById("startTime");
  const endDateEl   = document.getElementById("endDate");
  const endTimeEl   = document.getElementById("endTime");
  const warnEl      = document.getElementById("conflictWarning");

  if (!warnEl) return;

  const carName = carEl.value;
  if (!carName || !startDateEl.value || !startTimeEl.value || !endDateEl.value || !endTimeEl.value) {
    warnEl.classList.add("hidden");
    return;
  }

  const newStart = combineDateTime(startDateEl.value + "T00:00:00", startTimeEl.value ? `1970-01-01T${startTimeEl.value}:00` : null) ||
    new Date(startDateEl.value + "T" + startTimeEl.value);
  const newEnd   = new Date(endDateEl.value + "T" + endTimeEl.value);

  if (isNaN(newStart) || isNaN(newEnd) || newStart >= newEnd) {
    warnEl.classList.add("hidden");
    return;
  }

  // ดึงข้อมูลจาก API
  try {
    const res  = await fetch(API_URL);
    const rows = await res.json();
    const data = rows.slice(1);
    const conflicts = detectConflicts(data, carName, newStart, newEnd);

    if (conflicts.length > 0) {
      const lines = conflicts.map(r => {
        const s = r[5] ? new Date(r[5]).toLocaleDateString("th-TH") : "-";
        const t = r[6] ? new Date(r[6]).toLocaleTimeString("th-TH", {hour:"2-digit",minute:"2-digit"}) : "-";
        const e = r[7] ? new Date(r[7]).toLocaleDateString("th-TH") : "-";
        const u = r[8] ? new Date(r[8]).toLocaleTimeString("th-TH", {hour:"2-digit",minute:"2-digit"}) : "-";
        const status = r[11] || "รออนุมัติ";
        return `• ${r[2]||"?"} (${r[3]||"?"}) | ${s} ${t} → ${e} ${u} [${status}]`;
      }).join("\n");

      warnEl.innerHTML = `
        <div class="flex items-start gap-3">
          <div class="text-2xl">⚠️</div>
          <div>
            <div class="font-bold text-orange-800 mb-1">รถคันนี้มีการจองซ้อนกับช่วงเวลาที่เลือก</div>
            <pre class="text-xs font-mono text-orange-700 whitespace-pre-wrap leading-relaxed">${lines}</pre>
            <div class="text-xs text-orange-600 mt-2">Admin จะเห็น conflict นี้ในตารางจอง และอาจไม่อนุมัติ</div>
          </div>
        </div>`;
      warnEl.classList.remove("hidden");
    } else {
      warnEl.classList.add("hidden");
    }
  } catch (e) {
    warnEl.classList.add("hidden");
  }
}

// ============================================================
// BOOKING PASSWORD STRENGTH — กันตั้งรหัสส่วนตัวที่เดาง่ายเกินไป
// ============================================================

// รายชื่อรหัสที่พบบ่อย/เดาง่าย ห้ามใช้เด็ดขาด
const WEAK_PASSWORD_BLACKLIST = [
  "123456","1234567","12345678","123456789","000000","111111","222222",
  "333333","444444","555555","666666","777777","888888","999999",
  "password","passw0rd","qwerty","abcdef","abcd1234","aaaaaa",
  "123123","112233","123321","696969","112358","000001","999999"
];

// ตรวจว่าเป็นสตริงที่ตัวอักษรเรียงติดกัน (ขึ้นหรือลง) ทั้งหมด เช่น "123456", "abcdef", "654321"
function isSequentialString(s) {
  if (s.length < 4) return false;
  let asc = true, desc = true;
  for (let i = 1; i < s.length; i++) {
    if (s.charCodeAt(i) !== s.charCodeAt(i - 1) + 1) asc = false;
    if (s.charCodeAt(i) !== s.charCodeAt(i - 1) - 1) desc = false;
  }
  return asc || desc;
}

// ประเมินความปลอดภัยของรหัสส่วนตัว คืนค่า { ok, level, label, reason }
function evaluatePasswordStrength(pw) {
  if (!pw) return { ok: false, level: "empty", label: "", reason: "กรุณาตั้งรหัสส่วนตัว" };

  const len   = pw.length;
  const lower = pw.toLowerCase();

  const isAllSameChar = /^(.)\1+$/.test(pw);
  const hasLetter = /[a-zA-Zก-๙]/.test(pw);
  const hasDigit  = /[0-9]/.test(pw);
  const hasSymbol = /[^a-zA-Z0-9ก-๙]/.test(pw);
  const typeCount = [hasLetter, hasDigit, hasSymbol].filter(Boolean).length;

  if (len < 6) {
    return { ok: false, level: "weak", label: "รหัสไม่ปลอดภัย", reason: "สั้นเกินไป — ต้องมีอย่างน้อย 6 ตัวอักษร" };
  }
  if (isAllSameChar) {
    return { ok: false, level: "weak", label: "รหัสไม่ปลอดภัย", reason: "ห้ามใช้ตัวอักษร/ตัวเลขซ้ำกันทั้งหมด เช่น 111111" };
  }
  if (isSequentialString(pw)) {
    return { ok: false, level: "weak", label: "รหัสไม่ปลอดภัย", reason: "ห้ามใช้ตัวเลข/ตัวอักษรเรียงกัน เช่น 123456, abcdef" };
  }
  if (WEAK_PASSWORD_BLACKLIST.includes(lower)) {
    return { ok: false, level: "weak", label: "รหัสไม่ปลอดภัย", reason: "เป็นรหัสที่คนใช้บ่อย เดาง่ายเกินไป" };
  }
  if (typeCount < 2) {
    return { ok: false, level: "weak", label: "รหัสไม่ปลอดภัย", reason: "ควรผสมตัวเลขกับตัวอักษร ไม่ใช่ตัวเลขล้วนหรือตัวอักษรล้วน" };
  }
  if (len >= 8 && typeCount >= 2) {
    return { ok: true, level: "strong", label: "รหัสปลอดภัยดี", reason: "" };
  }
  return { ok: true, level: "medium", label: "พอใช้ได้ — เพิ่มความยาวหรือใส่อักขระพิเศษจะปลอดภัยขึ้น", reason: "" };
}

// อัปเดตข้อความบอกความปลอดภัยของรหัสแบบเรียลไทม์ใต้ช่องกรอก
function updateBookingPasswordHint() {
  const pwEl   = document.getElementById("bookingPassword");
  const hintEl = document.getElementById("bookingPasswordStrength");
  if (!pwEl || !hintEl) return;

  const pw = pwEl.value;
  if (!pw) { hintEl.textContent = ""; return; }

  const result = evaluatePasswordStrength(pw);
  const colorClass = result.level === "weak" ? "text-red-500"
    : result.level === "medium" ? "text-yellow-600"
    : "text-green-600";

  hintEl.textContent = result.ok ? `✓ ${result.label}` : `✗ ${result.reason}`;
  hintEl.className = "text-xs mt-1 text-left font-medium " + colorClass;
}


// ============================================================
// PASSWORD HASHING — แปลงรหัสส่วนตัวเป็น SHA-256 hash ก่อนส่งออกจากเครื่อง
// (ไม่ส่ง/ไม่เก็บรหัส plain text ไว้ใน Google Sheet ที่ทุกคนดึงข้อมูล public ได้)
// ============================================================
async function hashPassword(text) {
  const enc        = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================
// NAVIGATION
// ============================================================
function showUser() {
  console.log("User clicked");
  document.getElementById("loginPanel").classList.remove("hidden");
  document.getElementById("adminLoginPanel").classList.add("hidden");
  document.getElementById("adminPanel").classList.add("hidden");
  document.getElementById("homeDashboard").classList.add("hidden");
}

function showAdminLogin() {
  document.getElementById("loginPanel").classList.add("hidden");
  document.getElementById("userPanel").classList.add("hidden");
  document.getElementById("adminLoginPanel").classList.remove("hidden");
  document.getElementById("homeDashboard").classList.add("hidden");
}

// กลับไปหน้าหลัก จากหน้า login (ก่อนกรอกรหัสสำเร็จ) ของทั้ง User และ Admin
// แค่ซ่อนฟอร์ม login แล้วโชว์ dashboard หน้าหลักกลับมา ไม่กระทบ session ที่ login ไปแล้ว
function goHome() {
  document.getElementById("loginPanel").classList.add("hidden");
  document.getElementById("adminLoginPanel").classList.add("hidden");
  document.getElementById("homeDashboard").classList.remove("hidden");

  // เคลียร์ค่าที่อาจพิมพ์ไว้ในฟอร์ม login ก่อนกดกลับ
  document.getElementById("adminPassword").value      = "";
  document.getElementById("loginDepartment").value    = "";
  document.getElementById("departmentPassword").value = "";
}

// ============================================================
// ADMIN LOGIN
// ============================================================
async function adminLoginSubmit() {
  const password = document.getElementById("adminPassword").value;
  if (!password) { alert("กรุณากรอกรหัสผ่าน"); return; }

  const btn = document.querySelector('button[onclick="adminLoginSubmit()"]');
  if (btn) { btn.disabled = true; btn.textContent = "กำลังตรวจสอบ..."; }

  try {
    const passwordHash = await hashPassword(password);
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" }, // Apps Script doPost ต้องรับเป็น text/plain แล้ว parse JSON เอง
      body: JSON.stringify({ action: "adminLogin", passwordHash })
    });
    const result = await res.json();

    if (!result.success) {
      alert("รหัสผ่านไม่ถูกต้อง");
      return;
    }

    document.getElementById("adminLoginPanel").classList.add("hidden");
    document.getElementById("adminPanel").classList.remove("hidden");
    document.getElementById("roleButtons").classList.add("hidden");
    loadBookings();
    renderVehicleManagerTable();
  } catch (err) {
    console.error("adminLoginSubmit error:", err);
    alert("เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "เข้าสู่ระบบ"; }
  }
}

// ============================================================
// DEPARTMENT LOGIN / LOGOUT
// ============================================================
async function departmentLogin() {
  const dept     = document.getElementById("loginDepartment").value;
  const password = document.getElementById("departmentPassword").value;

  if (!dept)     { alert("กรุณาเลือกแผนก"); return; }
  if (!password) { alert("กรุณากรอกรหัสผ่าน"); return; }

  const btn = document.querySelector('button[onclick="departmentLogin()"]');
  if (btn) { btn.disabled = true; btn.textContent = "กำลังตรวจสอบ..."; }

  let loginOk = false;
  try {
    const passwordHash = await hashPassword(password);
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "departmentLogin", department: dept, passwordHash })
    });
    const result = await res.json();
    loginOk = !!result.success;
  } catch (err) {
    console.error("departmentLogin error:", err);
    alert("เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    if (btn) { btn.disabled = false; btn.textContent = "เข้าสู่ระบบ"; }
    return;
  }

  if (btn) { btn.disabled = false; btn.textContent = "เข้าสู่ระบบ"; }

  if (!loginOk) {
    alert("รหัสผ่านไม่ถูกต้อง");
    return;
  }

  localStorage.setItem("myDepartment", dept);

  document.getElementById("loginPanel").classList.add("hidden");
  document.getElementById("userPanel").classList.remove("hidden");
  document.getElementById("roleButtons").classList.add("hidden");

  document.getElementById("department").value    = dept;
  document.getElementById("department").disabled = true;


  // ถ้ามาจากการกด "จองรถวันนี้" ในปฏิทิน ให้เติมวันที่ที่เลือกไว้ลงฟอร์มทันที
  if (pendingCalendarDate) {
    const startDateEl = document.getElementById("startDate");
    const endDateEl   = document.getElementById("endDate");
    const carEl       = document.getElementById("car");
    if (startDateEl) startDateEl.value = pendingCalendarDate;
    if (endDateEl)   endDateEl.value   = pendingCalendarDate;

    // pre-select รถคันแรกที่ว่างในวันนั้น (ถ้ามี) — ผู้ใช้ยังเปลี่ยนเป็นคันอื่นเองได้
    const available = getAvailableVehiclesForDay(pendingCalendarDate);
    if (carEl && available.length > 0) {
      updateCarDropdown(); // ให้แน่ใจว่า option ล่าสุด (รวมสถานะซ่อมบำรุง) ถูกสร้างก่อน
      carEl.value = available[0].car;
    } else if (available.length === 0) {
      alert("วันนี้รถทุกคันถูกจองหรือปิดซ่อมบำรุงหมดแล้ว กรุณาเลือกรถที่ต้องการเองหรือเปลี่ยนวันที่");
    }

    pendingCalendarDate = null;

    // เลื่อนหน้าจอไปที่ฟอร์มจอง แล้วเช็ค conflict ของวันที่เติมให้ทันที (ถ้าฟังก์ชันมีอยู่)
    setTimeout(() => {
      if (carEl) carEl.scrollIntoView({ behavior: "smooth", block: "center" });
      if (typeof checkConflictOnForm === "function") checkConflictOnForm();
      if (typeof updateCarAvailability === "function") updateCarAvailability();
    }, 100);
  }

  await loadPublicBookings();
}

function logoutDepartment() {
  localStorage.removeItem("myDepartment");
  location.reload();
}

// ============================================================
// BOOKING — SAVE
// ============================================================
async function saveBooking() {
  if (!department.value) { alert("กรุณาเลือกแผนก"); return; }

  const emailRaw = document.getElementById("email").value.trim();
  if (!emailRaw) { alert("กรุณากรอกอีเมลผู้จอง (ใช้แจ้งผลอนุมัติ/ไม่อนุมัติ)"); return; }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(emailRaw)) { alert("รูปแบบอีเมลไม่ถูกต้อง"); return; }

  const bookingPasswordRaw = document.getElementById("bookingPassword").value;
  if (!bookingPasswordRaw) {
    alert("กรุณาตั้งรหัสส่วนตัวสำหรับการจองนี้ (ใช้ยืนยันตอนยกเลิก)");
    return;
  }

  const pwCheck = evaluatePasswordStrength(bookingPasswordRaw);
  if (!pwCheck.ok) {
    alert(`รหัสส่วนตัวไม่ปลอดภัยพอ: ${pwCheck.reason}\nกรุณาตั้งรหัสใหม่ (อย่างน้อย 6 ตัวอักษร ผสมตัวเลขกับตัวอักษร และห้ามเป็นรหัสที่เดาง่าย)`);
    document.getElementById("bookingPassword").focus();
    return;
  }

  const bookingPasswordHash = await hashPassword(bookingPasswordRaw);

  // ตรวจ conflict ก่อนส่ง
  const startDate = document.getElementById("startDate").value;
  const startTime = document.getElementById("startTime").value;
  const endDate   = document.getElementById("endDate").value;
  const endTime   = document.getElementById("endTime").value;
  const carVal    = document.getElementById("car").value;

  if (!carVal)      { alert("กรุณาเลือกรถ"); return; }
  if (!startDate || !startTime || !endDate || !endTime) { alert("กรุณากรอกวันและเวลาให้ครบ"); return; }
  if (startDate < toDateKey(new Date())) {
    alert("ไม่สามารถจองย้อนหลังได้ กรุณาเลือกวันที่ตั้งแต่วันนี้เป็นต้นไป");
    return;
  }

  const newStart = new Date(startDate + "T" + startTime);
  const newEnd   = new Date(endDate   + "T" + endTime);
  if (isNaN(newStart) || isNaN(newEnd) || newStart >= newEnd) {
    alert("วันที่/เวลาไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง");
    return;
  }

  // เช็ค maintenance
  const allVehicles = getAllVehicles();
  const selectedVehicle = allVehicles.find(v => v.car === carVal);
  if (selectedVehicle && isVehicleMaintenance(selectedVehicle.id)) {
    alert("รถคันนี้ปิดซ่อมบำรุงอยู่ กรุณาเลือกรถคันอื่น");
    return;
  }

  let pendingConflicts = [];
  try {
    const checkRes  = await fetch(API_URL);
    const checkRows = await checkRes.json();
    pendingConflicts = detectConflicts(checkRows.slice(1), carVal, newStart, newEnd);
  } catch(e) { /* ถ้าดึงข้อมูลไม่ได้ ให้ผ่านต่อ */ }

  const data = {
    action:             "create",
    name:               document.getElementById("name").value,
    email:              document.getElementById("email").value,
    department:         document.getElementById("department").value,
    car:                document.getElementById("car").value,
    startDate:          document.getElementById("startDate").value,
    startTime:          document.getElementById("startTime").value,
    endDate:            document.getElementById("endDate").value,
    endTime:            document.getElementById("endTime").value,
    purpose:            document.getElementById("purpose").value,
    passenger:          document.getElementById("passenger").value,
    bookingPasswordHash // ⚠️ ต้องแก้ Apps Script (backend) ให้บันทึกค่านี้ลง Sheet ด้วย — ดูคำแนะนำท้ายไฟล์
  };

  if (pendingConflicts.length > 0) {
    openOverlapModal(pendingConflicts, data);
    return; // หยุดรอผู้ใช้ตัดสินใจใน modal — confirmOverlapAndSubmit() จะเรียก submitBookingData ต่อเอง
  }

  await submitBookingData(data);
}

// ============================================================
// CONFLICT CONFIRM MODAL — แสดงตอนกดส่งฟอร์มแล้วพบว่ารถคันที่เลือกมีการจองซ้อนทับอยู่แล้ว
// (ปกติ updateCarAvailability() จะ disable ตัวเลือกที่ชนไว้ก่อนแล้ว เคสนี้เป็น fallback
//  เผื่อมีคนอื่นจองแทรกเข้ามาในช่วงเวลาสั้นๆ ระหว่างที่ผู้ใช้กำลังกรอกฟอร์มอยู่พอดี)
// ============================================================
let _pendingBookingData = null;

function openOverlapModal(conflicts, data) {
  _pendingBookingData = data;

  const lines = conflicts.map(r =>
    `• ${r[2]||"?"} | ${r[5]?new Date(r[5]).toLocaleDateString("th-TH"):"-"} → ${r[7]?new Date(r[7]).toLocaleDateString("th-TH"):"-"} [${r[11]||"รออนุมัติ"}]`
  ).join("\n");

  document.getElementById("overlapModalList").textContent = `พบ ${conflicts.length} รายการที่ซ้อนทับ:\n${lines}`;
  document.getElementById("overlapModal").classList.remove("hidden");
}

function closeOverlapModal() {
  document.getElementById("overlapModal").classList.add("hidden");
  _pendingBookingData = null;
}

async function confirmOverlapAndSubmit() {
  if (!_pendingBookingData) { closeOverlapModal(); return; }
  const data = _pendingBookingData;
  closeOverlapModal();
  await submitBookingData(data);
}

// ส่งข้อมูลการจองจริง (แยกออกมาเพื่อให้เรียกได้ทั้งจากเส้นทางปกติและจาก modal ยืนยัน conflict)
async function submitBookingData(data) {
  console.log("ค่าชื่อ =", document.getElementById("name").value);
  console.log("ข้อมูลที่ส่ง =", data);

  if (API_URL.includes("PUT_YOUR")) {
    alert("กรุณาตั้งค่า API_URL ใน script.js");
    return;
  }

  const res    = await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
  const result = await res.json();

  localStorage.setItem("myBookingId",  result.bookingId);
  localStorage.setItem("myDepartment", document.getElementById("department").value);

  document.getElementById("bookingPassword").value = "";
  document.getElementById("email").value = "";

  alert("ส่งคำขอจองรถเรียบร้อย กรุณาจำรหัสที่ตั้งไว้ ใช้สำหรับยกเลิกการจองนี้");
  loadPublicBookings();
  loadDashboard();
}

// ============================================================
// BOOKING — SEARCH / CLEAR
// ============================================================
async function searchBooking() {
  const name = document.getElementById("searchName").value.trim();
  const date = document.getElementById("searchDate").value;

  if (name === "") { alert("กรุณากรอกชื่อผู้จอง"); return; }

  const res    = await fetch(API_URL);
  const rows   = await res.json();
  const result = document.getElementById("searchResult");

  const bookings = rows.slice(1).filter(r => {
    const bookingDate = r[5] ? new Date(r[5]).toLocaleDateString("sv-SE") : "";
    const sameName    = (r[2] || "").trim().toLowerCase() === name.toLowerCase();
    if (date === "") return sameName;
    return sameName && bookingDate === date;
  });

  if (bookings.length === 0) {
    result.innerHTML = `<div class="bg-red-100 text-red-700 p-4 rounded-lg">ไม่พบข้อมูลการจอง</div>`;
    return;
  }

  result.innerHTML = "";
  bookings.forEach(r => {
    let color = "bg-yellow-100 text-yellow-700";
    if (r[11] === "อนุมัติ")    color = "bg-green-100 text-green-700";
    if (r[11] === "ไม่อนุมัติ") color = "bg-red-100 text-red-700";
    if (r[11] === "ยกเลิก")    color = "bg-gray-100 text-gray-700";

    result.innerHTML += `
<div class="w-full max-w-lg mx-auto border border-slate-200 rounded-xl p-5 mb-4 shadow-sm bg-white card-accent">
  <div class="flex justify-between items-center border-b pb-3 mb-4">
    <div class="font-bold text-lg">ผู้จอง : ${r[2]}</div>
    <span class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide data-mono ${color}">${r[11]}</span>
  </div>
  <div class="grid grid-cols-2 gap-y-3 text-sm">
    <div class="font-semibold">แผนก</div><div>${r[3]}</div>
    <div class="font-semibold">รถ</div><div class="data-mono">${r[4]}</div>
    <div class="font-semibold">วันที่ใช้</div>
    <div class="data-mono">${new Date(r[5]).toLocaleDateString("th-TH")}</div>
    <div class="font-semibold">เวลา</div>
    <div class="data-mono">${new Date(r[6]).toLocaleTimeString("th-TH", { hour:"2-digit", minute:"2-digit" })}</div>
  </div>
</div>`;
  });
}

function clearSearch() {
  document.getElementById("searchName").value    = "";
  document.getElementById("searchDate").value    = "";
  document.getElementById("searchResult").innerHTML = "";
}

// ============================================================
// BOOKING — CANCEL (USER SIDE) — เปิด modal ให้กรอกรหัส + เลือกเหตุผลก่อนยืนยันยกเลิก
// ============================================================
let _cancelTargetId = null;

function cancelBooking(id) {
  _cancelTargetId = id;

  // เคลียร์ค่าเดิมทุกครั้งที่เปิด modal ใหม่
  document.getElementById("cancelPasswordInput").value = "";
  document.querySelectorAll('input[name="cancelReason"]').forEach(r => r.checked = false);
  const otherText = document.getElementById("cancelReasonOtherText");
  otherText.value = "";
  otherText.disabled = true;
  document.getElementById("cancelReasonError").classList.add("hidden");

  document.getElementById("cancelModal").classList.remove("hidden");
}

function closeCancelModal() {
  document.getElementById("cancelModal").classList.add("hidden");
  _cancelTargetId = null;
}

// เปิด/ปิดช่องกรอกเองตามตัวเลือกที่กดในขณะนี้ (ใช้ event delegation ตัวเดียวกับ rejectReason ด้านล่าง)
document.addEventListener("change", (e) => {
  if (e.target.name === "cancelReason") {
    const otherText = document.getElementById("cancelReasonOtherText");
    otherText.disabled = e.target.id !== "cancelReasonOther";
    if (!otherText.disabled) otherText.focus();
  }
});

async function confirmCancel() {
  const errorEl = document.getElementById("cancelReasonError");
  const inputPw = document.getElementById("cancelPasswordInput").value;

  if (!inputPw) {
    errorEl.textContent = "กรุณากรอกรหัสส่วนตัว";
    errorEl.classList.remove("hidden");
    return;
  }

  const selected = document.querySelector('input[name="cancelReason"]:checked');
  if (!selected) {
    errorEl.textContent = "กรุณาเลือกเหตุผลที่ยกเลิก";
    errorEl.classList.remove("hidden");
    return;
  }

  let reason = selected.value;
  if (selected.id === "cancelReasonOther") {
    const customText = document.getElementById("cancelReasonOtherText").value.trim();
    if (!customText) {
      errorEl.textContent = "กรุณาระบุเหตุผลเพิ่มเติม";
      errorEl.classList.remove("hidden");
      return;
    }
    reason = customText;
  }

  errorEl.classList.add("hidden");

  const btn = document.getElementById("confirmCancelBtn");
  btn.disabled = true;
  btn.textContent = "กำลังตรวจสอบ...";

  try {
    const res  = await fetch(API_URL);
    const rows = await res.json();
    const row  = rows.find(r => r[0] === _cancelTargetId);

    if (!row) { alert("ไม่พบข้อมูลการจองนี้"); return; }

    const inputHash = await hashPassword(inputPw);
    if (inputHash !== row[PASSWORD_COL]) {
      errorEl.textContent = "รหัสผ่านไม่ถูกต้อง ไม่สามารถยกเลิกการจองนี้ได้";
      errorEl.classList.remove("hidden");
      return;
    }

    await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "update", id: _cancelTargetId, status: "ยกเลิก", reason })
    });

    closeCancelModal();
    loadPublicBookings();
    loadDashboard();

    if (!document.getElementById("adminPanel").classList.contains("hidden")) {
      loadBookings();
    }
  } catch (err) {
    console.error("confirmCancel error:", err);
    alert("เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
  } finally {
    btn.disabled = false;
    btn.textContent = "ยืนยันยกเลิกการจอง";
  }
}

// ============================================================
// ADMIN — LOAD / APPROVE / REJECT / DELETE
// ============================================================
async function loadBookings() {
  const res   = await fetch(API_URL);
  const rows  = await res.json();
  const table = document.getElementById("bookingTable");
  table.innerHTML = "";

  const data = rows.slice(1);
  const waitingCount = data.filter(r => !r[11] || r[11] === "รออนุมัติ").length;
  updateAdminNotifBadge(waitingCount);

  // อัปเดต stat cards
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl("totalBooking",   data.length);
  setEl("approveBooking", data.filter(r => r[11]==="อนุมัติ").length);
  setEl("rejectBooking",  data.filter(r => r[11]==="ไม่อนุมัติ").length);
  setEl("waitingBooking", data.filter(r => !r[11] || r[11]==="รออนุมัติ").length);
  setEl("cancelBooking",  data.filter(r => r[11]==="ยกเลิก").length);

  data.forEach(r => {
    console.log(r);

    // ตรวจ conflict สำหรับแถวนี้
    const rStart = combineDateTime(r[5], r[6]);
    const rEnd   = combineDateTime(r[7], r[8]);
    const hasConflict = (r[11] === "รออนุมัติ" || !r[11]) && rStart && rEnd
      ? detectConflicts(data, (r[4]||"").trim(), rStart, rEnd, r[0]).length > 0
      : false;

    const conflictTag = hasConflict
      ? `<span title="มีการจองซ้อนทับ" class="inline-block ml-1 bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full">⚠️ ซ้อนทับ</span>`
      : "";

    const statusBadge = `
      <span class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide data-mono
        ${r[11]==="อนุมัติ"    ? "bg-green-100 text-green-700"
        : r[11]==="ไม่อนุมัติ" ? "bg-red-100 text-red-700"
        : r[11]==="ยกเลิก"    ? "bg-gray-100 text-gray-700"
        :                        "bg-yellow-100 text-yellow-700"}">
        ${r[11]==="ยกเลิก" ? "ยกเลิกแล้ว" : (r[11] || "รออนุมัติ")}
      </span>${conflictTag}`;

    let actionBtns = "";

if (r[11] === "รออนุมัติ" || !r[11]) {

  actionBtns = `
    <button onclick="approve('${r[0]}')"
      class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md">
      ✓ อนุมัติ
    </button>

    <button onclick="reject('${r[0]}')"
      class="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md">
      ✕ ไม่อนุมัติ
    </button>

    <button onclick="deleteBooking('${r[0]}')"
      class="bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded-md">
      ลบ
    </button>
  `;

}
else if (r[11] === "อนุมัติ") {

  if (r[18] === "ยังไม่รับรถ") {

    actionBtns = `
      <button onclick="receiveCar('${r[0]}')"
        class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md">
        🚗 รับรถ
      </button>
    `;

  }
  else if (r[18] === "กำลังใช้งาน") {

    actionBtns = `
      <button onclick="returnCar('${r[0]}')"
        class="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded-md">
        ↩ คืนรถ
      </button>
    `;

  }
  else {

    actionBtns = `
      <span class="text-green-700 font-bold">
      ✅ คืนรถแล้ว
      </span>
    `;

  }

}
else{

  actionBtns = `
    <span class="text-slate-500 font-semibold">
    ดำเนินการแล้ว
    </span>
  `;

}

    table.innerHTML += `
<tr class="border-b border-slate-200 hover:bg-paper ${hasConflict ? "bg-orange-50" : ""}">
  <td class="p-3 text-center">${r[3]||"-"}</td>
  <td class="p-3 text-center">${r[2]||"-"}</td>
  <td class="p-2 text-center whitespace-nowrap data-mono">${r[4]||"-"}</td>
  <td class="p-2 text-center data-mono">${r[5] ? new Date(r[5]).toLocaleDateString("th-TH") : "-"}</td>
  <td class="p-2 text-center data-mono">${r[6] ? new Date(r[6]).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"}) : "-"}</td>
  <td class="p-2 text-center data-mono">${r[7] ? new Date(r[7]).toLocaleDateString("th-TH") : "-"}</td>
  <td class="p-2 text-center data-mono">${r[8] ? new Date(r[8]).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"}) : "-"}</td>
  <td class="p-3 text-center data-mono">${r[10]||"-"}</td>
  <td class="p-3 text-center">${statusBadge}</td>
  <td class="p-3"><div class="flex gap-2 justify-center">${actionBtns}</div></td>
</tr>`;
  });
}

async function rejectBooking(id){

    const reason = prompt(
        "กรุณาระบุเหตุผลการไม่อนุมัติ",
        ""
    );

    if(reason===null) return;

    await fetch(API_URL,{
        method:"POST",
        body:JSON.stringify({

            action:"update",

            id:id,

            status:"ไม่อนุมัติ",

            reason:reason

        })
    });

    loadBookings();

    loadDashboard();

}

async function approveBooking(id){

    await fetch(API_URL,{

        method:"POST",

        body:JSON.stringify({

            action:"update",

            id:id,

            status:"อนุมัติ"

        })

    });

    loadBookings();

    loadDashboard();

}

async function receiveCar(id){

    await fetch(API_URL,{

        method:"POST",

        body:JSON.stringify({

            action:"receive",

            id:id

        })

    });

    loadBookings();

    loadDashboard();

}

async function returnCar(id){

    await fetch(API_URL,{

        method:"POST",

        body:JSON.stringify({

            action:"return",

            id:id

        })

    });

    loadBookings();

    loadDashboard();

}

async function approve(id) {
  await fetch(API_URL, { method:"POST", body:JSON.stringify({ action:"update", id, status:"อนุมัติ" }) });
  loadBookings();
  loadDashboard();
}

async function receiveCar(id){

    await fetch(API_URL,{
        method:"POST",
        body:JSON.stringify({
            action:"receive",
            id:id
        })
    });

    loadBookings();
    loadDashboard();

}

async function returnCar(id){

    await fetch(API_URL,{
        method:"POST",
        body:JSON.stringify({
            action:"return",
            id:id
        })
    });

    loadBookings();
    loadDashboard();

}

// ============================================================
// REJECT — เปิด modal ให้เลือก/กรอกเหตุผลก่อนยืนยันไม่อนุมัติ
// ============================================================
let _rejectTargetId = null;

function reject(id) {
  _rejectTargetId = id;

  // เคลียร์ค่าเดิมทุกครั้งที่เปิด modal ใหม่
  document.querySelectorAll('input[name="rejectReason"]').forEach(r => r.checked = false);
  const otherText = document.getElementById("rejectReasonOtherText");
  otherText.value = "";
  otherText.disabled = true;
  document.getElementById("rejectReasonError").classList.add("hidden");

  document.getElementById("rejectModal").classList.remove("hidden");
}

function closeRejectModal() {
  document.getElementById("rejectModal").classList.add("hidden");
  _rejectTargetId = null;
}

// เปิด/ปิดช่องกรอกเอง ตามตัวเลือกที่กดในขณะนี้
document.addEventListener("change", (e) => {
  if (e.target.name === "rejectReason") {
    const otherText = document.getElementById("rejectReasonOtherText");
    otherText.disabled = e.target.id !== "rejectReasonOther";
    if (!otherText.disabled) otherText.focus();
  }
});

async function confirmReject() {
  const selected = document.querySelector('input[name="rejectReason"]:checked');
  const errorEl  = document.getElementById("rejectReasonError");

  if (!selected) {
    errorEl.textContent = "กรุณาเลือกเหตุผลที่ไม่อนุมัติ";
    errorEl.classList.remove("hidden");
    return;
  }

  let reason = selected.value;
  if (selected.id === "rejectReasonOther") {
    const customText = document.getElementById("rejectReasonOtherText").value.trim();
    if (!customText) {
      errorEl.textContent = "กรุณาระบุเหตุผลเพิ่มเติม";
      errorEl.classList.remove("hidden");
      return;
    }
    reason = customText;
  }

  errorEl.classList.add("hidden");

  await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ action: "update", id: _rejectTargetId, status: "ไม่อนุมัติ", reason })
  });

  closeRejectModal();
  loadBookings();
  loadDashboard();
}

async function deleteBooking(id) {
  if (!confirm("ลบรายการนี้ ?")) return;
  await fetch(API_URL, { method:"POST", body:JSON.stringify({ action:"delete", id }) });
  loadBookings();
  loadDashboard();
}

// ============================================================
// ADMIN — STATISTICS
// ============================================================
async function showStatistics() {
  document.getElementById("statisticsPanel") && document.getElementById("statisticsPanel").classList.remove("hidden");

  const res  = await fetch(API_URL);
  const rows = await res.json();
  const data = rows.slice(1);

  document.getElementById("totalBooking").innerText   = data.length;
  document.getElementById("approveBooking").innerText = data.filter(r => r[11]==="อนุมัติ").length;
  document.getElementById("rejectBooking").innerText  = data.filter(r => r[11]==="ไม่อนุมัติ").length;
  document.getElementById("waitingBooking").innerText = data.filter(r => !r[11] || r[11]==="รออนุมัติ").length;
  document.getElementById("cancelBooking").innerText  = data.filter(r => r[11]==="ยกเลิก").length;
}

// ============================================================
// ADMIN — EXPORT PDF (html2pdf — รองรับภาษาไทย)
// ============================================================
async function exportPDF() {
  const res  = await fetch(API_URL);
  const rows = await res.json();
  const data = rows.slice(1);

  const total   = data.length;
  const approve = data.filter(r => r[11] === "อนุมัติ").length;
  const reject  = data.filter(r => r[11] === "ไม่อนุมัติ").length;
  const waiting = data.filter(r => !r[11] || r[11] === "รออนุมัติ").length;
  const cancel  = data.filter(r => r[11] === "ยกเลิก").length;

  const now      = new Date();
  const reportNo = "CBR-" + Date.now();

  // สร้างแถวตาราง
  const tableRows = data.map(r => {
    const statusColor =
      r[11] === "อนุมัติ"    ? "#16a34a" :
      r[11] === "ไม่อนุมัติ" ? "#dc2626" :
      r[11] === "ยกเลิก"    ? "#6b7280" : "#d97706";


    return `
      <tr>
        <td>${r[2] || "-"}</td>
        <td>${r[3] || "-"}</td>
        <td>${r[4] || "-"}</td>
        <td style="color:${statusColor}; font-weight:600;">${r[11] || "รออนุมัติ"}</td>
      </tr>`;
  }).join("");

  // HTML ที่จะ render เป็น PDF
  const html = `
    <html>
    <head>
      <meta charset="UTF-8">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Sarabun', sans-serif; font-size: 13px; color: #1e293b; background: #fff; }

        .header {
          background: #1c3a5e;
          color: white;
          text-align: center;
          padding: 18px 0 14px;
        }
        .header h1 { font-size: 24px; font-weight: 700; letter-spacing: 1px; }
        .header p  { font-size: 12px; margin-top: 4px; opacity: 0.85; }

        .meta { padding: 16px 28px 0; font-size: 12px; line-height: 1.9; }
        .meta span { font-weight: 600; }

        .summary-box {
          margin: 16px 28px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          padding: 16px 20px;
        }
        .summary-box h2 { font-size: 16px; font-weight: 700; margin-bottom: 14px; }
        .summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
        .summary-card {
          border-radius: 8px;
          padding: 12px 8px;
          text-align: center;
        }
        .summary-card .num  { font-size: 26px; font-weight: 700; }
        .summary-card .lbl  { font-size: 11px; margin-top: 4px; color: #475569; }
        .c-blue   { background:#eff6ff; color:#2563eb; }
        .c-green  { background:#f0fdf4; color:#16a34a; }
        .c-red    { background:#fef2f2; color:#dc2626; }
        .c-yellow { background:#fffbeb; color:#d97706; }
        .c-gray   { background:#f8fafc; color:#6b7280; }

        .divider { border: none; border-top: 1px solid #e2e8f0; margin: 0 28px; }

        table { width: calc(100% - 56px); margin: 16px 28px; border-collapse: collapse; font-size: 12px; }
        thead tr { background: #1c3a5e; color: white; }
        thead th { padding: 8px 10px; text-align: center; font-weight: 600; }
        tbody tr:nth-child(even) { background: #f8fafc; }
        tbody td { padding: 7px 10px; text-align: center; border-bottom: 1px solid #e2e8f0; }

        .footer { text-align: center; font-size: 10px; color: #94a3b8; padding: 20px 0 10px; }

        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        .print-btn {
          display: block; margin: 16px auto 0; padding: 10px 32px;
          background: #1c3a5e; color: white; border: none; border-radius: 8px;
          font-family: 'Sarabun', sans-serif; font-size: 14px; cursor: pointer;
        }
        .print-btn:hover { background: #142b46; }
      </style>
    </head>
    <body>

      <div class="header">
        <h1>CAR BOOKING REPORT</h1>
        <p>Car Booking System</p>
      </div>

      <div class="meta">
        <div>Report No : <span>${reportNo}</span></div>
        <div>Export Date : <span>${now.toLocaleDateString("th-TH", {year:"numeric",month:"long",day:"numeric"})}</span></div>
        <div>Export Time : <span>${now.toLocaleTimeString("th-TH")}</span></div>
      </div>

      <div class="summary-box">
        <h2>Booking Summary</h2>
        <div class="summary-grid">
          <div class="summary-card c-blue">
            <div class="num">${total}</div>
            <div class="lbl">จำนวนการจอง</div>
          </div>
          <div class="summary-card c-green">
            <div class="num">${approve}</div>
            <div class="lbl">อนุมัติ</div>
          </div>
          <div class="summary-card c-red">
            <div class="num">${reject}</div>
            <div class="lbl">ไม่อนุมัติ</div>
          </div>
          <div class="summary-card c-yellow">
            <div class="num">${waiting}</div>
            <div class="lbl">รออนุมัติ</div>
          </div>
          <div class="summary-card c-gray">
            <div class="num">${cancel}</div>
            <div class="lbl">ยกเลิก</div>
          </div>
        </div>
      </div>

      <hr class="divider">

      <table>
        <thead>
          <tr>
            <th>ผู้จอง</th>
            <th>แผนก</th>
            <th>รถ</th>
            <th>สถานะ</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>

      <div class="footer">Generated by Car Booking System</div>
      <div class="no-print" style="text-align:center; padding-bottom:20px;">
        <button class="print-btn" onclick="window.print()">🖨️ บันทึก / พิมพ์ PDF</button>
      </div>

    </body>
    </html>`;

  // เปิด popup แล้ว print เป็น PDF
  const win = window.open("", "_blank", "width=900,height=700");
  win.document.write(html);
  win.document.close();

  // รอ font โหลดก่อน print
  win.onload = () => {
    setTimeout(() => {
      win.focus();
      win.print();
    }, 800);
  };
}

// ============================================================
// HOME DASHBOARD — สรุปสถานะ + รถในระบบ (ดึงข้อมูลจริงแบบเรียลไทม์)
// ============================================================

// รวมวันที่ (จาก r[5]/r[7]) กับเวลา (จาก r[6]/r[8]) ให้เป็น Date เดียว
// ใช้วิธีเดียวกับที่ loadBookings/loadPublicBookings ใช้แสดงผลอยู่แล้ว
// (new Date(dateVal) / new Date(timeVal)) เพื่อให้แน่ใจว่า parse ได้ตรงกับข้อมูลจริงจาก Sheet
function combineDateTime(dateVal, timeVal) {
  if (!dateVal || !timeVal) return null;
  const d = new Date(dateVal);
  const t = new Date(timeVal);
  if (isNaN(d) || isNaN(t)) return null;
  const combined = new Date(d);
  combined.setHours(t.getHours(), t.getMinutes(), t.getSeconds(), 0);
  return combined;
}

// เช็คว่ารถคันนี้ "กำลังใช้งาน" อยู่ ณ ขณะนี้หรือไม่
// เงื่อนไข: ต้องเป็นการจองที่ "อนุมัติ" แล้ว และเวลาปัจจุบันอยู่ในช่วงเริ่มใช้งาน-คืนรถ
function isVehicleInUse(bookings, vehicleCar) {
  const now = new Date();
  return bookings.some(r => {
    if ((r[4] || "").trim() !== vehicleCar) return false;
    if (r[11] !== "อนุมัติ") return false;
    const start = combineDateTime(r[5], r[6]);
    const end   = combineDateTime(r[7], r[8]);
    if (!start || !end) return false;
    return now >= start && now <= end;
  });
}

function renderVehicleCards() {
  const wrap = document.getElementById("vehicleCards");
  if (!wrap) return;
  const statuses = getVehicleStatuses();
  wrap.innerHTML = getAllVehicles().map(v => {
    const isMaint = statuses[v.id] === "maintenance";
    return `
    <div class="border ${isMaint ? "border-orange-300 bg-orange-50" : "border-slate-200"} rounded-xl p-4 hover:border-brass transition-colors">
      <div class="text-4xl text-center">${v.icon}</div>
      <div class="font-bold text-center mt-2">${v.name}</div>
      <div class="text-center text-sm text-slate-500 data-mono">${v.plate}</div>
      ${isMaint
        ? `<div class="text-center mt-2 font-semibold text-sm text-orange-600">🔧 ปิดซ่อมบำรุง</div>`
        : `<div class="text-center mt-2 font-semibold text-sm" id="vehicleStatus_${v.id}">กำลังโหลด...</div>`
      }
    </div>`;
  }).join("");
}

async function loadDashboard() {
  renderVehicleCards();

  try {
    const res  = await fetch(API_URL);
    const rows = await res.json();
    const data = rows.slice(1);
    const statuses = getVehicleStatuses();

    let inUseCount = 0;

    getAllVehicles().forEach(v => {
      const isMaint = statuses[v.id] === "maintenance";
      const inUse   = !isMaint && isVehicleInUse(data, v.car);
      if (inUse) inUseCount++;

      const statusEl = document.getElementById("vehicleStatus_" + v.id);
      if (statusEl && !isMaint) {
        statusEl.textContent = inUse ? "กำลังใช้งาน" : "ว่างใช้งาน";
        statusEl.className = "text-center mt-2 font-semibold text-sm " +
          (inUse ? "text-navy" : "text-green-600");
      }
    });

    const total    = getAllVehicles().length;
    const waiting  = data.filter(r => !r[11] || r[11] === "รออนุมัติ").length;
    const available = total - inUseCount - Object.values(statuses).filter(s => s === "maintenance").length;

    document.getElementById("dashTotal").textContent     = total;
    document.getElementById("dashAvailable").textContent = Math.max(0, available);
    document.getElementById("dashInUse").textContent     = inUseCount;
    document.getElementById("dashWaiting").textContent   = waiting;

    updateAdminNotifBadge(waiting);
    renderHomeBookingTable(data);
    renderCalendarView(data);

  } catch (err) {
    console.error("loadDashboard error:", err);
  }
}

// ตาราง "สถานะการจอง" แบบ read-only บนหน้าโฮม — ไม่ต้อง login ก็เห็นได้
// ใช้ data ที่ loadDashboard() ดึงมาแล้ว ไม่ fetch ซ้ำ และไม่มีคอลัมน์ "จัดการ"
// (ปุ่มอนุมัติ/ไม่อนุมัติยังอยู่แค่ใน Admin Panel ที่ต้อง login เท่านั้น)
function renderHomeBookingTable(data) {
  const table = document.getElementById("homeBookingTable");
  if (!table) return;

  table.innerHTML = "";

  data.forEach(r => {
    let badge = `<span class="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide data-mono whitespace-nowrap">รออนุมัติ</span>`;
    if (r[11]==="อนุมัติ")    badge = `<span class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide data-mono whitespace-nowrap">อนุมัติ</span>`;
    if (r[11]==="ไม่อนุมัติ") badge = `<span class="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide data-mono whitespace-nowrap">ไม่อนุมัติ</span>`;
    if (r[11]==="ยกเลิก")    badge = `<span class="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide data-mono whitespace-nowrap">ยกเลิก</span>`;

    table.innerHTML += `
<tr class="border-b border-slate-200 hover:bg-paper">
  <td class="p-3 text-center">${r[3]||"-"}</td>
  <td class="p-3 text-center">${r[2]||"-"}</td>
  <td class="p-2 text-center break-words data-mono">${r[4]||"-"}</td>
  <td class="p-2 text-center data-mono">${r[5] ? new Date(r[5]).toLocaleDateString("th-TH") : "-"}</td>
  <td class="p-3 text-center">${badge}</td>
</tr>`;
  });
}

// ============================================================
// CALENDAR VIEW — ปฏิทินมุมมองรวมการจองรถ
// ============================================================
let calendarCurrentDate  = new Date();
let calendarBookingsData = [];
let calendarSelectedDay  = null; // "YYYY-MM-DD" ของวันที่กำลังเปิดดูรายละเอียด
let pendingCalendarDate  = null; // "YYYY-MM-DD" ที่ผู้ใช้กดเลือกจากปฏิทินไว้ ก่อนจะเข้าสู่ระบบแผนก

const CAL_WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const CAL_MONTHS = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"
];

// เรียกจาก loadDashboard() ทุกครั้งที่ดึงข้อมูลใหม่ — เก็บ data ไว้ใช้ re-render ตอนเปลี่ยนเดือน/ตัวกรอง
function renderCalendarView(data) {
  calendarBookingsData = data || [];
  populateCalendarVehicleFilter();
  renderCalendarGrid();
}

function populateCalendarVehicleFilter() {
  const sel = document.getElementById("calendarVehicleFilter");
  if (!sel) return;
  const current = sel.value;
  const vehicles = getAllVehicles();
  sel.innerHTML = `<option value="">ทุกคัน</option>` +
    vehicles.map(v => `<option value="${v.car}">${v.icon} ${v.name}</option>`).join("");
  sel.value = current && vehicles.some(v => v.car === current) ? current : "";
}

function calendarFilterChange() {
  renderCalendarGrid();
}

function calendarPrevMonth() {
  calendarCurrentDate = new Date(calendarCurrentDate.getFullYear(), calendarCurrentDate.getMonth() - 1, 1);
  calendarSelectedDay = null;
  renderCalendarGrid();
}

function calendarNextMonth() {
  calendarCurrentDate = new Date(calendarCurrentDate.getFullYear(), calendarCurrentDate.getMonth() + 1, 1);
  calendarSelectedDay = null;
  renderCalendarGrid();
}

function calendarGoToday() {
  calendarCurrentDate = new Date();
  calendarSelectedDay = toDateKey(calendarCurrentDate);
  renderCalendarGrid();
  showCalendarDayDetail(calendarSelectedDay);
}

function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// เทียบเฉพาะวันที่ (ตัดเวลาออก) ว่า dateKey อยู่ก่อนวันนี้หรือไม่ — ใช้ปิดกั้นการจองย้อนหลัง
function isPastDate(dateKey) {
  return dateKey < toDateKey(new Date());
}

// คืนค่ารายการจองที่ "คาบเกี่ยว" กับวันที่ dateKey (YYYY-MM-DD) โดยตัด ยกเลิก/ไม่อนุมัติ ออก
// และกรองตามรถที่เลือกไว้ในตัวกรอง (ถ้ามี)
function getBookingsForDay(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dayStart = new Date(y, m - 1, d, 0, 0, 0);
  const dayEnd   = new Date(y, m - 1, d, 23, 59, 59);
  const filterCar = (document.getElementById("calendarVehicleFilter") || {}).value || "";

  return calendarBookingsData.filter(r => {
    if (!r || !r[4]) return false;
    if (r[11] === "ยกเลิก" || r[11] === "ไม่อนุมัติ") return false;
    if (filterCar && (r[4] || "").trim() !== filterCar.trim()) return false;

    const bStart = combineDateTime(r[5], r[6]);
    const bEnd   = combineDateTime(r[7], r[8]);
    if (!bStart || !bEnd) return false;

    return bStart <= dayEnd && bEnd >= dayStart;
  });
}

function renderCalendarGrid() {
  const grid       = document.getElementById("calendarGrid");
  const weekHeader = document.getElementById("calendarWeekHeader");
  const label      = document.getElementById("calendarMonthLabel");
  if (!grid || !label) return;

  const year  = calendarCurrentDate.getFullYear();
  const month = calendarCurrentDate.getMonth(); // 0-11
  label.textContent = `${CAL_MONTHS[month]} ${year + 543}`;

  if (weekHeader && !weekHeader.dataset.built) {
    weekHeader.innerHTML = CAL_WEEKDAYS.map(w => `<div>${w}</div>`).join("");
    weekHeader.dataset.built = "1";
  }

  const firstDayOfMonth = new Date(year, month, 1);
  const startOffset     = firstDayOfMonth.getDay(); // 0 = อาทิตย์
  const daysInMonth     = new Date(year, month + 1, 0).getDate();
  const todayKey        = toDateKey(new Date());

  let html = "";

  for (let i = 0; i < startOffset; i++) {
    html += `<div class="cal-day cal-day--empty"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey  = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const bookings = getBookingsForDay(dateKey);

    const approved = bookings.filter(r => r[11] === "อนุมัติ").length;
    const pending  = bookings.filter(r => !r[11] || r[11] === "รออนุมัติ").length;

    let dots = "";
    for (let i = 0; i < Math.min(approved, 4); i++) dots += `<span class="cal-dot cal-dot--approved"></span>`;
    for (let i = 0; i < Math.min(pending, 4); i++)  dots += `<span class="cal-dot cal-dot--pending"></span>`;

    const extra = (approved + pending) > 8 ? `<div class="cal-more">+${(approved+pending)-8}</div>` : "";

    const classes = [
      "cal-day",
      dateKey === todayKey ? "cal-day--today" : "",
      dateKey === calendarSelectedDay ? "cal-day--selected" : "",
      isPastDate(dateKey) ? "cal-day--past" : ""
    ].filter(Boolean).join(" ");

    const clickAttr = isPastDate(dateKey) ? "" : `onclick="showCalendarDayDetail('${dateKey}')"`;

    html += `
      <button type="button" class="${classes}" ${clickAttr} ${isPastDate(dateKey) ? "disabled" : ""}>
        <div class="cal-day-num">${d}</div>
        <div class="cal-dots">${dots}</div>
        ${extra}
      </button>`;
  }

  grid.innerHTML = html;
}

// คืนรายชื่อรถ (จาก getAllVehicles) ที่ "ว่าง" ในวันที่ dateKey — ไม่ติดซ่อมบำรุง และไม่มีการจองคาบเกี่ยววันนั้น
function getAvailableVehiclesForDay(dateKey) {
  const statuses     = getVehicleStatuses();
  const bookedCarsOnDay = new Set(
    getBookingsForDayAllCars(dateKey).map(r => (r[4] || "").trim())
  );
  return getAllVehicles().filter(v =>
    statuses[v.id] !== "maintenance" && !bookedCarsOnDay.has(v.car.trim())
  );
}

// เหมือน getBookingsForDay แต่ไม่กรองตามตัวกรองรถในปฏิทิน — ใช้เช็คว่าวันนั้นรถคันไหนถูกจองไปแล้วบ้าง
function getBookingsForDayAllCars(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dayStart = new Date(y, m - 1, d, 0, 0, 0);
  const dayEnd   = new Date(y, m - 1, d, 23, 59, 59);

  return calendarBookingsData.filter(r => {
    if (!r || !r[4]) return false;
    if (r[11] === "ยกเลิก" || r[11] === "ไม่อนุมัติ") return false;
    const bStart = combineDateTime(r[5], r[6]);
    const bEnd   = combineDateTime(r[7], r[8]);
    if (!bStart || !bEnd) return false;
    return bStart <= dayEnd && bEnd >= dayStart;
  });
}

// ผู้ใช้กด "จองรถวันนี้" จากใต้ปฏิทิน — จำวันที่ไว้ก่อน แล้วพาไปหน้าเข้าสู่ระบบแผนก
// (ฟอร์มจองอยู่หลัง login แผนกเสมอ เพราะต้องผูกกับรหัสแผนกที่จองไว้)
// วันที่ที่จำไว้จะถูกเติมลงฟอร์มอัตโนมัติทันทีหลัง login สำเร็จ ดู departmentLogin()
function calendarBookThisDay(dateKey) {
  pendingCalendarDate = dateKey;
  showUser();
}


// แสดงรายละเอียดการจองทั้งหมดของวันที่เลือก ใต้ตัวปฏิทิน
function showCalendarDayDetail(dateKey) {
  if (isPastDate(dateKey)) return; // กันไว้อีกชั้น — ปุ่ม/คลิกของวันย้อนหลังถูกปิดไว้แล้วในกริด
  calendarSelectedDay = dateKey;
  renderCalendarGrid();

  const panel = document.getElementById("calendarDayDetail");
  if (!panel) return;

  const bookings = getBookingsForDay(dateKey);
  const [y, m, d] = dateKey.split("-").map(Number);
  const niceDate = new Date(y, m - 1, d).toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });

  if (bookings.length === 0) {
    panel.innerHTML = `
      <div class="font-bold text-slate-700 mb-2">${niceDate}</div>
      <p class="text-sm text-slate-400 mb-3">ไม่มีการจองรถในวันนี้ — ว่างทุกคัน</p>
      <button onclick="calendarBookThisDay('${dateKey}')"
        class="bg-navy hover:bg-navyDark text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow">
        📅 จองรถวันนี้
      </button>`;
    panel.classList.remove("hidden");
    return;
  }

  const rows = bookings.map(r => {
    const badgeClass = r[11] === "อนุมัติ"
      ? "bg-green-100 text-green-700"
      : "bg-yellow-100 text-yellow-700";
    const statusText = r[11] === "อนุมัติ" ? "อนุมัติ" : "รออนุมัติ";

    const sTime = r[6] ? new Date(r[6]).toLocaleTimeString("th-TH", {hour:"2-digit", minute:"2-digit"}) : "-";
    const eTime = r[8] ? new Date(r[8]).toLocaleTimeString("th-TH", {hour:"2-digit", minute:"2-digit"}) : "-";
    const sDate = r[5] ? new Date(r[5]).toLocaleDateString("th-TH") : "-";
    const eDate = r[7] ? new Date(r[7]).toLocaleDateString("th-TH") : "-";

    return `
      <div class="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
        <div>
          <div class="font-semibold text-slate-800 data-mono">${r[4] || "-"}</div>
          <div class="text-xs text-slate-500 mt-0.5">${r[2] || "-"} · ${r[3] || "-"}</div>
          <div class="text-xs text-slate-400 data-mono mt-0.5">${sDate} ${sTime} → ${eDate} ${eTime}</div>
        </div>
        <span class="${badgeClass} text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap">${statusText}</span>
      </div>`;
  }).join("");

  panel.innerHTML = `
    <div class="font-bold text-slate-700 mb-2">${niceDate} <span class="text-slate-400 font-normal text-sm">(${bookings.length} รายการ)</span></div>
    ${rows}
    <button onclick="calendarBookThisDay('${dateKey}')"
      class="mt-3 bg-navy hover:bg-navyDark text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow">
      📅 จองรถวันนี้ (เลือกคันที่ว่าง)
    </button>`;
  panel.classList.remove("hidden");
}

// ============================================================
// NOTIFICATION BADGES
// ============================================================

// แสดง/ซ่อน badge แจ้งเตือนฝั่ง Admin (จำนวนรายการ "รออนุมัติ")
// อัปเดตทั้งปุ่ม Admin ที่หน้า home และหัวข้อในตัว Admin Panel
function updateAdminNotifBadge(waitingCount) {
  [
    { id: "adminNotifBadge",      text: `🔔 ${waitingCount}` },
    { id: "adminPanelNotifBadge", text: `🔔 ${waitingCount} รออนุมัติ` }
  ].forEach(({ id, text }) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (waitingCount > 0) {
      el.textContent = text;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
}

// แสดง/ซ่อน badge แจ้งเตือนฝั่ง User (จำนวนรายการของ "แผนกที่ login อยู่"
// ที่เพิ่งได้รับผลอนุมัติ/ไม่อนุมัติ นับตั้งแต่ครั้งล่าสุดที่เปิดดูตารางจองของแผนกนี้)
// ใช้ localStorage เก็บ timestamp ล่าสุดที่ดู เทียบกับเวลาที่สถานะถูกเปลี่ยน (คอลัมน์ index 14)
function updateUserNotifBadge(rows, department) {
  if (!department) {
    ["userNotifBadge", "userPanelNotifBadge"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
    return;
  }

  const lastSeenKey = "lastSeenNotif_" + department;
  const lastSeen     = Number(localStorage.getItem(lastSeenKey) || 0);

  const newlyResolved = rows.filter(r => {
    if ((r[3] || "").trim() !== department) return false;
    if (r[11] !== "อนุมัติ" && r[11] !== "ไม่อนุมัติ") return false;
    const updatedAt = r[14] ? new Date(r[14]).getTime() : 0;
    return updatedAt > lastSeen;
  });

  const count = newlyResolved.length;

  [
    { id: "userNotifBadge",      text: `🔔 ${count}` },
    { id: "userPanelNotifBadge", text: `🔔 ${count} รายการใหม่` }
  ].forEach(({ id, text }) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) {
      el.textContent = text;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
}

// เรียกตอนผู้ใช้เปิดดูตารางจองของแผนกตัวเอง (ถือว่า "อ่านแล้ว") เพื่อเคลียร์ badge
function markUserNotifSeen(department) {
  if (!department) return;
  localStorage.setItem("lastSeenNotif_" + department, String(Date.now()));
  updateUserNotifBadge([], department); // ซ่อน badge ทันทีหลังอ่านแล้ว (เคลียร์ค่าเก่า)
}

// เรียกเมื่อผู้ใช้กดที่ badge เอง (ยืนยันว่า "อ่านแล้ว") — ใช้ทั้ง 2 badge (ปุ่มหน้า home + ในตัว panel)
function dismissUserNotifBadge() {
  const department = localStorage.getItem("myDepartment");
  markUserNotifSeen(department);
}

// ============================================================
// USER PANEL — PUBLIC BOOKING TABLE
// ============================================================
async function loadPublicBookings() {
  const res          = await fetch(API_URL);
  const rows         = await res.json();
  const table        = document.getElementById("publicBookingTable");
  const myDepartment = localStorage.getItem("myDepartment");

  updateUserNotifBadge(rows.slice(1), myDepartment);

  table.innerHTML = "";

  rows.slice(1).forEach(r => {
    console.log(r);

    let badge = `<span class="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide data-mono whitespace-nowrap">รออนุมัติ</span>`;
    if (r[11]==="อนุมัติ")    badge = `<span class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide data-mono whitespace-nowrap">อนุมัติ</span>`;
    if (r[11]==="ไม่อนุมัติ") badge = `<span class="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide data-mono whitespace-nowrap">ไม่อนุมัติ</span>`;
    if (r[11]==="ยกเลิก")    badge = `<span class="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide data-mono whitespace-nowrap">ยกเลิก</span>`;

    const cancelBtn =
      r[3]===myDepartment && r[11]!=="ยกเลิก" && r[11]!=="ไม่อนุมัติ" && r[11]!=="อนุมัติ"
      ? `<button onclick="cancelBooking('${r[0]}')"
           class="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded-md">ยกเลิก</button>`
      : r[11]==="อนุมัติ"
        ? `<span class="text-green-600 font-semibold text-xs">อนุมัติแล้ว</span>`
        : "-";

    table.innerHTML += `
<tr class="border-b border-slate-200 hover:bg-paper">
  <td class="p-3 text-center">${r[3]||"-"}</td>
  <td class="p-3 text-center">${r[2]||"-"}</td>
  <td class="p-2 text-center break-words data-mono">${r[4]||"-"}</td>
  <td class="p-2 text-center data-mono">${r[5] ? new Date(r[5]).toLocaleDateString("th-TH") : "-"}</td>
  <td class="p-2 text-center data-mono">${r[6] ? new Date(r[6]).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"}) : "-"}</td>
  <td class="p-2 text-center data-mono">${r[7] ? new Date(r[7]).toLocaleDateString("th-TH") : "-"}</td>
  <td class="p-2 text-center data-mono">${r[8] ? new Date(r[8]).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"}) : "-"}</td>
  <td class="p-3 text-center data-mono">${r[10]||"-"}</td>
  <td class="p-3 text-center">${badge}</td>
  <td class="p-3 text-center">${cancelBtn}</td>
</tr>`;
  });
}

// ============================================================
// CHECK STATUS (by bookingId)
// ============================================================
async function checkStatus() {
  const res     = await fetch(API_URL);
  const rows    = await res.json();
  const booking = rows.find(row => row[0] === bookingId);
  const result  = document.getElementById("statusResult");

  if (!booking) {
    result.innerHTML = `<div class="bg-red-100 text-red-700 p-3 rounded">ไม่พบข้อมูลการจอง</div>`;
    return;
  }

  let color = "bg-yellow-100 text-yellow-700";
  if (booking[11]==="อนุมัติ")    color = "bg-green-100 text-green-700";
  if (booking[11]==="ไม่อนุมัติ") color = "bg-red-100 text-red-700";

  result.innerHTML = `
<div class="border border-slate-200 rounded-lg p-4 card-accent bg-white">
  <div><b>เลขที่จอง :</b> <span class="data-mono">${booking[0]}</span></div>
  <div><b>ผู้จอง :</b> ${booking[2]}</div>
  <div><b>รถ :</b> <span class="data-mono">${booking[5]}</span></div>
  <div><b>วันที่ใช้ :</b> <span class="data-mono">${booking[6]}</span></div>
  <div class="mt-3">
    <span class="px-3 py-1 rounded-full font-bold uppercase tracking-wide text-xs data-mono ${color}">${booking[10]}</span>
  </div>
</div>`;
}

// ============================================================
// ADMIN — VEHICLE MANAGEMENT (จัดการรถ: เพิ่ม / ปิดซ่อมบำรุง / เปิดใช้งาน)
// ============================================================

function showVehicleManager() { /* ไม่ใช้แล้ว — ตารางแสดงตลอดเวลา */ }
function hideVehicleManager() { /* ไม่ใช้แล้ว */ }

function renderVehicleManagerTable() {
  const tbody    = document.getElementById("vehicleManagerTable");
  const statuses = getVehicleStatuses();
  if (!tbody) return;

  tbody.innerHTML = getAllVehicles().map(v => {
    const isMaint = statuses[v.id] === "maintenance";
    const isCustom = !VEHICLES.find(bv => bv.id === v.id);
    return `
<tr class="border-b border-slate-200 hover:bg-slate-50 ${isMaint ? "bg-orange-50" : ""}">
  <td class="p-3 text-center text-2xl">${v.icon}</td>
  <td class="p-3 font-medium">${v.name}</td>
  <td class="p-3 text-center data-mono text-slate-600">${v.plate}</td>
  <td class="p-3 text-center">
    ${isMaint
      ? `<span class="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-xs font-bold">🔧 ซ่อมบำรุง</span>`
      : `<span class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold">✅ พร้อมใช้งาน</span>`
    }
  </td>
  <td class="p-3 text-center">
    <div class="flex gap-2 justify-center">
      ${isMaint
        ? `<button onclick="toggleVehicleMaintenance('${v.id}', false)"
             class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md text-sm">
             เปิดใช้งาน</button>`
        : `<button onclick="toggleVehicleMaintenance('${v.id}', true)"
             class="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded-md text-sm">
             ปิดซ่อม</button>`
      }
      ${isCustom
        ? `<button onclick="removeCustomVehicle('${v.id}')"
             class="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1 rounded-md text-sm">
             ลบ</button>`
        : ""}
    </div>
  </td>
</tr>`;
  }).join("");
}

function toggleVehicleMaintenance(vehicleId, isMaint) {
  setVehicleStatus(vehicleId, isMaint ? "maintenance" : "active");
  renderVehicleManagerTable();
  loadDashboard();
  // อัปเดต dropdown ฟอร์มจอง
  updateCarDropdown();
}

function removeCustomVehicle(vehicleId) {
  if (!confirm("ลบรถนี้ออกจากระบบ?")) return;
  const customs = getCustomVehicles().filter(v => v.id !== vehicleId);
  localStorage.setItem("customVehicles", JSON.stringify(customs));
  renderVehicleManagerTable();
  loadDashboard();
  updateCarDropdown();
}

function addNewVehicle() {
  const nameEl  = document.getElementById("newVehicleName");
  const plateEl = document.getElementById("newVehiclePlate");
  const typeEl  = document.getElementById("newVehicleType");

  const name  = nameEl.value.trim();
  const plate = plateEl.value.trim();
  const type  = typeEl.value;

  if (!name || !plate) { alert("กรุณากรอกชื่อรถและทะเบียน"); return; }
  if (plate.length < 4) { alert("ทะเบียนรถไม่ถูกต้อง"); return; }

  // ตรวจ ทะเบียนซ้ำ
  const allExisting = getAllVehicles();
  if (allExisting.some(v => v.plate.toLowerCase() === plate.toLowerCase())) {
    alert("ทะเบียนรถนี้มีในระบบแล้ว");
    return;
  }

  const icon = type === "van" ? "🚐" : type === "sedan" ? "🚗" : "🛻";
  const id   = "cv_" + Date.now();
  const carLabel = `${name} (${plate})`;

  const customs = getCustomVehicles();
  customs.push({ id, name, plate, car: carLabel, icon });
  localStorage.setItem("customVehicles", JSON.stringify(customs));

  nameEl.value  = "";
  plateEl.value = "";

  renderVehicleManagerTable();
  loadDashboard();
  updateCarDropdown();
  alert(`เพิ่มรถ "${name}" (${plate}) เรียบร้อยแล้ว`);
}

// อัปเดต dropdown รถในฟอร์มจอง ให้ตรงกับรถที่มีอยู่และไม่ได้ปิดซ่อม
// ตั้งค่า min ของช่องวันที่ในฟอร์มจองให้เป็น "วันนี้" — กันไม่ให้พิมพ์/เลือกวันที่ย้อนหลังจาก date picker ของเบราว์เซอร์
function setBookingDateMin() {
  const todayKey = toDateKey(new Date());
  const startDateEl = document.getElementById("startDate");
  const endDateEl   = document.getElementById("endDate");
  if (startDateEl) startDateEl.min = todayKey;
  if (endDateEl)   endDateEl.min   = todayKey;
}

function updateCarDropdown() {
  const carSel = document.getElementById("car");
  if (!carSel) return;
  const statuses = getVehicleStatuses();
  const prev = carSel.value;
  carSel.innerHTML = `<option value="">เลือกรถ</option>`;
  getAllVehicles().forEach(v => {
    const isMaint = statuses[v.id] === "maintenance";
    const opt = document.createElement("option");
    opt.value = v.car;
    opt.textContent = isMaint ? `${v.car} 🔧 (ซ่อมบำรุง)` : v.car;
    if (isMaint) opt.disabled = true;
    if (v.car === prev) opt.selected = true;
    carSel.appendChild(opt);
  });
  // หลังสร้าง dropdown ใหม่ ให้เช็คทันทีว่าช่วงเวลาที่กรอกไว้ (ถ้ามี) ทำให้บางคันไม่ว่างหรือเปล่า
  updateCarAvailability();
}

// ปิดกั้น (disable) ตัวเลือกรถในฟอร์มจองที่ "ไม่ว่าง" ในช่วงเวลาที่เลือกไว้ — ก่อนผู้ใช้กดเลือกคันด้วยซ้ำ
// ทำงานคู่กับ checkConflictOnForm() ซึ่งยังเตือนซ้ำอีกทีหลังเลือกคันแล้ว (เผื่อข้อมูลเปลี่ยนระหว่างนั้น)
async function updateCarAvailability() {
  const carEl       = document.getElementById("car");
  const startDateEl = document.getElementById("startDate");
  const startTimeEl = document.getElementById("startTime");
  const endDateEl   = document.getElementById("endDate");
  const endTimeEl   = document.getElementById("endTime");
  if (!carEl || !startDateEl || !startTimeEl || !endDateEl || !endTimeEl) return;

  const options = Array.from(carEl.options).filter(o => o.value); // ข้าม "เลือกรถ"
  const statuses = getVehicleStatuses();

  // ยังกรอกวันเวลาไม่ครบ — คืนสถานะ option ให้เป็นไปตามสถานะซ่อมบำรุงอย่างเดียว (ไม่เกี่ยวกับการจอง)
  if (!startDateEl.value || !startTimeEl.value || !endDateEl.value || !endTimeEl.value) {
    options.forEach(opt => {
      const v = getAllVehicles().find(x => x.car === opt.value);
      const isMaint = v && statuses[v.id] === "maintenance";
      opt.disabled = !!isMaint;
      opt.textContent = isMaint ? `${opt.value} 🔧 (ซ่อมบำรุง)` : opt.value;
    });
    return;
  }

  const newStart = new Date(startDateEl.value + "T" + startTimeEl.value);
  const newEnd   = new Date(endDateEl.value + "T" + endTimeEl.value);
  if (isNaN(newStart) || isNaN(newEnd) || newStart >= newEnd) return;

  let rows = [];
  try {
    const res  = await fetch(API_URL);
    const data = await res.json();
    rows = data.slice(1);
  } catch (e) {
    return; // โหลดข้อมูลไม่สำเร็จ — ปล่อยตัวเลือกเดิมไว้ ไม่บล็อกผู้ใช้
  }

  let selectedNowDisabled = false;

  options.forEach(opt => {
    const v = getAllVehicles().find(x => x.car === opt.value);
    const isMaint = v && statuses[v.id] === "maintenance";
    const conflicts = detectConflicts(rows, opt.value, newStart, newEnd);
    const isBooked = conflicts.length > 0;

    opt.disabled = isMaint || isBooked;
    opt.textContent = isMaint
      ? `${opt.value} 🔧 (ซ่อมบำรุง)`
      : isBooked
        ? `${opt.value} ❌ (ไม่ว่างช่วงนี้)`
        : opt.value;

    if (opt.disabled && opt.value === carEl.value) selectedNowDisabled = true;
  });

  // ถ้าคันที่เลือกไว้อยู่กลายเป็นไม่ว่างหลังเปลี่ยนวันเวลา ให้เคลียร์การเลือกทิ้งเพื่อไม่ให้ค้างค่าที่จองไม่ได้จริง
  if (selectedNowDisabled) {
    carEl.value = "";
    const warnEl = document.getElementById("conflictWarning");
    if (warnEl) warnEl.classList.add("hidden");
  }
}

// ============================================================
// ON LOAD
// ============================================================
window.onload = async () => {
  const dept = localStorage.getItem("myDepartment");

  if (dept) {
    document.getElementById("loginPanel").classList.add("hidden");
    document.getElementById("userPanel").classList.remove("hidden");
    document.getElementById("homeDashboard").classList.add("hidden");
    document.getElementById("roleButtons").classList.add("hidden");
    document.getElementById("department").value    = dept;
    document.getElementById("department").disabled = true;
  }

  updateCarDropdown();

  // ผูก event ตรวจ conflict เมื่อกรอกฟอร์ม
  ["car","startDate","startTime","endDate","endTime"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", checkConflictOnForm);
  });
  // ผูก event ปิดกั้นตัวเลือกรถที่ไม่ว่างทันทีที่กรอกวันเวลาครบ (ก่อนเลือกคันด้วยซ้ำ)
  ["startDate","startTime","endDate","endTime"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", updateCarAvailability);
  });

  // ผูก event แสดงความปลอดภัยของรหัสส่วนตัวแบบเรียลไทม์
  const bookingPasswordEl = document.getElementById("bookingPassword");
  if (bookingPasswordEl) bookingPasswordEl.addEventListener("input", updateBookingPasswordHint);

  await loadPublicBookings();
  loadDashboard();
  setBookingDateMin();
};