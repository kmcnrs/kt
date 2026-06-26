// ============================================================
// CONFIG
// ============================================================
const API_URL = "https://script.google.com/macros/s/AKfycbyLCBz3BT9KtJrzwdNflqAkpGClzBDhMcflPItGX4eO6YCqZ3EwN6Wy2JnPGJA3Cigjgg/exec";
const ADMIN_PASSWORD = "admin2026";

const DEPARTMENT_ACCOUNTS = {
  "IT":      "it2026",
  "HR":      "hr2026",
  "การเงิน": "fin2026",
  "พัสดุ":   "store2026",
  "วิจัย":   "research2026"
};

// รายการรถจริงในระบบ — ต้องตรงกับ <option value="..."> ของ select#car ในฟอร์มจอง
// เพราะ "car" คือค่าที่ถูกบันทึกไว้ใน Sheet ทุกครั้งที่มีการจอง
const VEHICLES = [
  { id: "v1", name: "รถตู้ 1",   plate: "กข-1234", car: "รถตู้ 1 (กข-1234)",   icon: "🚐" },
  { id: "v2", name: "รถตู้ 2",   plate: "กข-5678", car: "รถตู้ 2 (กข-5678)",   icon: "🚐" },
  { id: "v3", name: "รถกระบะ 1", plate: "บย-1111", car: "รถกระบะ 1 (บย-1111)", icon: "🛻" },
  { id: "v4", name: "รถกระบะ 2", plate: "บย-2222", car: "รถกระบะ 2 (บย-2222)", icon: "🛻" }
];

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

// ============================================================
// ADMIN LOGIN
// ============================================================
function adminLoginSubmit() {
  const password = document.getElementById("adminPassword").value;
  if (password !== ADMIN_PASSWORD) {
    alert("รหัสผ่านไม่ถูกต้อง");
    return;
  }
  document.getElementById("adminLoginPanel").classList.add("hidden");
  document.getElementById("adminPanel").classList.remove("hidden");
  document.getElementById("roleButtons").classList.add("hidden");
  loadBookings();
}

// ============================================================
// DEPARTMENT LOGIN / LOGOUT
// ============================================================
function departmentLogin() {
  const dept     = document.getElementById("loginDepartment").value;
  const password = document.getElementById("departmentPassword").value;

  if (!dept)                              { alert("กรุณาเลือกแผนก"); return; }
  if (DEPARTMENT_ACCOUNTS[dept] !== password) { alert("รหัสผ่านไม่ถูกต้อง"); return; }

  localStorage.setItem("myDepartment", dept);

  document.getElementById("loginPanel").classList.add("hidden");
  document.getElementById("userPanel").classList.remove("hidden");
  document.getElementById("roleButtons").classList.add("hidden");

  document.getElementById("department").value    = dept;
  document.getElementById("department").disabled = true;

  loadPublicBookings();
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

  const data = {
    action:     "create",
    name:       document.getElementById("name").value,
    department: document.getElementById("department").value,
    car:        document.getElementById("car").value,
    startDate:  document.getElementById("startDate").value,
    startTime:  document.getElementById("startTime").value,
    endDate:    document.getElementById("endDate").value,
    endTime:    document.getElementById("endTime").value,
    purpose:    document.getElementById("purpose").value,
    passenger:  document.getElementById("passenger").value
  };

  console.log("ค่าชื่อ =", document.getElementById("name").value);
  console.log("ข้อมูลที่ส่ง =", data);

  if (API_URL.includes("PUT_YOUR")) {
    alert("กรุณาตั้งค่า API_URL ใน script.js");
    return;
  }

  const res    = await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
  const result = await res.json();

  localStorage.setItem("myBookingId",  result.bookingId);
  localStorage.setItem("myDepartment", department.value);

  alert("ส่งคำขอจองรถเรียบร้อย");
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
// BOOKING — CANCEL (USER SIDE)
// ============================================================
async function cancelBooking(id) {
  if (!confirm("ต้องการยกเลิกการจองนี้หรือไม่ ?")) return;

  await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ action: "update", id, status: "ยกเลิก" })
  });

  loadPublicBookings();
  loadDashboard();

  if (!document.getElementById("adminPanel").classList.contains("hidden")) {
    loadBookings();
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

  rows.slice(1).forEach(r => {
    console.log(r);

    const statusBadge = `
      <span class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide data-mono
        ${r[11]==="อนุมัติ"    ? "bg-green-100 text-green-700"
        : r[11]==="ไม่อนุมัติ" ? "bg-red-100 text-red-700"
        : r[11]==="ยกเลิก"    ? "bg-gray-100 text-gray-700"
        :                        "bg-yellow-100 text-yellow-700"}">
        ${r[11]==="ยกเลิก" ? "ยกเลิกแล้ว" : (r[11] || "รออนุมัติ")}
      </span>`;

    const actionBtns = r[11] === "รออนุมัติ" ? `
      <button onclick="approve('${r[0]}')"
        class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md">✓ อนุมัติ</button>
      <button onclick="reject('${r[0]}')"
        class="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md">✕ ไม่อนุมัติ</button>
      <button onclick="deleteBooking('${r[0]}')"
        class="bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded-md">ลบ</button>`
      : `<span class="text-slate-500 font-semibold">ดำเนินการแล้ว</span>`;

    table.innerHTML += `
<tr class="border-b border-slate-200 hover:bg-paper">
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

async function approve(id) {
  await fetch(API_URL, { method:"POST", body:JSON.stringify({ action:"update", id, status:"อนุมัติ" }) });
  loadBookings();
  loadDashboard();
}

async function reject(id) {
  await fetch(API_URL, { method:"POST", body:JSON.stringify({ action:"update", id, status:"ไม่อนุมัติ" }) });
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
  document.getElementById("statisticsPanel").classList.remove("hidden");

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
  wrap.innerHTML = VEHICLES.map(v => `
    <div class="border border-slate-200 rounded-xl p-4 hover:border-brass transition-colors">
      <div class="text-4xl text-center">${v.icon}</div>
      <div class="font-bold text-center mt-2">${v.name}</div>
      <div class="text-center text-sm text-slate-500 data-mono">${v.plate}</div>
      <div class="text-center mt-2 font-semibold text-sm" id="vehicleStatus_${v.id}">กำลังโหลด...</div>
    </div>`).join("");
}

async function loadDashboard() {
  renderVehicleCards();

  try {
    const res  = await fetch(API_URL);
    const rows = await res.json();
    const data = rows.slice(1);

    let inUseCount = 0;

    VEHICLES.forEach(v => {
      const inUse = isVehicleInUse(data, v.car);
      if (inUse) inUseCount++;

      const statusEl = document.getElementById("vehicleStatus_" + v.id);
      if (statusEl) {
        statusEl.textContent = inUse ? "กำลังใช้งาน" : "ว่างใช้งาน";
        statusEl.className = "text-center mt-2 font-semibold text-sm " +
          (inUse ? "text-navy" : "text-green-600");
      }
    });

    const total    = VEHICLES.length;
    const waiting  = data.filter(r => !r[11] || r[11] === "รออนุมัติ").length;
    const available = total - inUseCount;

    document.getElementById("dashTotal").textContent     = total;
    document.getElementById("dashAvailable").textContent = available;
    document.getElementById("dashInUse").textContent     = inUseCount;
    document.getElementById("dashWaiting").textContent   = waiting;

  } catch (err) {
    console.error("loadDashboard error:", err);
  }
}

// ============================================================
// USER PANEL — PUBLIC BOOKING TABLE
// ============================================================
async function loadPublicBookings() {
  const res          = await fetch(API_URL);
  const rows         = await res.json();
  const table        = document.getElementById("publicBookingTable");
  const myDepartment = localStorage.getItem("myDepartment");

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
  <td class="p-2 text-center whitespace-nowrap data-mono">${r[4]||"-"}</td>
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
// ON LOAD
// ============================================================
window.onload = () => {
  const dept = localStorage.getItem("myDepartment");

  if (dept) {
    document.getElementById("loginPanel").classList.add("hidden");
    document.getElementById("userPanel").classList.remove("hidden");
    document.getElementById("department").value    = dept;
    document.getElementById("department").disabled = true;
  }

  loadPublicBookings();
  loadDashboard();
};