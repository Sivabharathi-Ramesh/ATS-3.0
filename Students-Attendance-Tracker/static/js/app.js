const fmtToday = () => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
};

const ymdToDmy = (ymd) => {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}-${m}-${y}`;
};

const getJSON = async (url) => (await fetch(url)).json();
const postJSON = async (url, body) =>
  (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

async function loadSubjects(selectEl) {
  const subs = await getJSON("/api/subjects");
  selectEl.innerHTML = '<option value="">All</option>' +
    subs.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
}

async function loadStudents(tbodyEl) {
  const sts = await getJSON("/api/students");
  tbodyEl.innerHTML = sts.map((s, idx) => `
    <tr data-student-id="${s.id}">
      <td>${idx + 1}</td>
      <td>${s.roll_no}</td>
      <td>${s.name}</td>
      <td><input type="radio" name="st_${s.id}" value="Present"></td>
      <td><input type="radio" name="st_${s.id}" value="Absent"></td>
    </tr>
  `).join("");
}

function wireValidation(tbodyEl, saveBtn) {
  const update = () => {
    const rows = [...tbodyEl.querySelectorAll("tr")];
    const allChosen = rows.every(r => {
      const gid = r.getAttribute("data-student-id");
      return !!r.querySelector(`input[name="st_${gid}"]:checked`);
    });
    saveBtn.disabled = !allChosen;
    saveBtn.classList.toggle("disabled", !allChosen);
    saveBtn.classList.toggle("ready", allChosen);
  };
  tbodyEl.addEventListener("change", update);
  update();
}

document.addEventListener("DOMContentLoaded", async () => {
  const page = document.body.dataset.page;
  const todayEl = document.getElementById("todayDate");
  if (todayEl) todayEl.textContent = fmtToday();

  // --- Store Attendance ---
  if (page === "store") {
    const subjSel = document.getElementById("subjectSelect");
    const bodyEl = document.getElementById("studentBody");
    const saveBtn = document.getElementById("saveBtn");
    const todayDate = fmtToday();

    await loadSubjects(subjSel);
    await loadStudents(bodyEl);
    wireValidation(bodyEl, saveBtn);

    // Add attendance status div
    const statusDiv = document.createElement("div");
    statusDiv.id = "attendanceStatus";
    statusDiv.style.marginBottom = "14px";
    document.querySelector("section.panel").insertBefore(statusDiv, document.getElementById("attendanceForm"));

    // Callback to check if attendance exists for selected subject/date
    async function checkAttendance() {
      const subject_id = subjSel.value;
      if (!subject_id) { statusDiv.textContent = ""; return; }
      const resp = await getJSON(`/api/attendance_exists?subject_id=${subject_id}&date=${todayDate}`);
      if (resp.exists) {
        statusDiv.innerHTML = "<b>Attendance already marked for this subject today! You can edit below.</b>";
        // Pre-fill with existing
        const data = await getJSON(`/api/get_attendance?subject_id=${subject_id}&date=${encodeURIComponent(todayDate)}`);
        if (data.ok) {
          bodyEl.querySelectorAll("tr").forEach(row => {
            const rollNo = row.children[1].textContent;
            const record = data.records.find(r => r.roll_no == rollNo);
            if (record) {
              row.querySelector(`input[value="${record.status}"]`).checked = true;
            }
          });
          wireValidation(bodyEl, saveBtn);
        }
      } else {
        statusDiv.innerHTML = "<b>No attendance marked yet. Please choose present/absent and save.</b>";
        bodyEl.querySelectorAll("input[type=radio]").forEach(i => i.checked = false);
        wireValidation(bodyEl, saveBtn);
      }
    }

    subjSel.addEventListener("change", checkAttendance);
    checkAttendance();

    document.getElementById("attendanceForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const date = fmtToday();
      const subject_id = parseInt(subjSel.value, 10);
      const marks = [...bodyEl.querySelectorAll("tr")].map(r => {
        const sid = parseInt(r.getAttribute("data-student-id"), 10);
        const status = r.querySelector(`input[name="st_${sid}"]:checked`).value;
        return { student_id: sid, status };
      });
      const resp = await postJSON("/api/save_attendance", { date, subject_id, marks });
      if (resp.ok) {
        alert("✅ Attendance saved successfully!");
        await checkAttendance();
      } else {
        alert("❌ Failed to store: " + (resp.error || "Unknown error"));
        console.error(resp);
      }
    });
  }

  // --- View Attendance ---
  if (page === "view") {
    const subjSel = document.getElementById("viewSubject");
    const dateInp = document.getElementById("viewDate");
    const showBtn = document.getElementById("showRecords");
    const area = document.getElementById("recordsArea");

    await loadSubjects(subjSel);

    showBtn.addEventListener("click", async () => {
      const dmy = ymdToDmy(dateInp.value);
      if (!dmy) { alert("Please pick a date."); return; }
      const subject_id = parseInt(subjSel.value, 10);

      area.innerHTML = "<p>Loading...</p>";
      const data = await getJSON(`/api/get_attendance?subject_id=${subject_id}&date=${encodeURIComponent(dmy)}`);
      if (!data.ok) {
        area.innerHTML = `<p>Error: ${data.error || "failed"}</p>`;
        return;
      }
      const rows = data.records;
      if (!rows || rows.length === 0) {
        area.innerHTML = `<p>No records found.</p>`;
        return;
      }
      const allAbsent = rows.every(r => r.status === 'Absent');
      if (allAbsent) {
        area.innerHTML = `<p>No attendance found for this date.</p>`;
        return;
      }
      let html = `<h3>Records for ${subjSel.options[subjSel.selectedIndex].text} on ${dmy}</h3>`;
      html += `<table class="table"><thead><tr><th>S.No</th><th>Roll No</th><th>Name</th><th>Status</th></tr></thead><tbody>`;
      rows.forEach((r, i) => {
        html += `<tr><td>${i+1}</td><td>${r.roll_no}</td><td>${r.name}</td><td>${r.status}</td></tr>`;
      });
      html += `</tbody></table>`;
      area.innerHTML = html;
    });
  }

  // --- Individual Report ---
  if (page === "individual") {
    await loadSubjects(document.getElementById("subjectSelect"));

    const dateType = document.getElementById("dateType");
    const yearInput = document.getElementById("yearInput");
    const monthInput = document.getElementById("monthInput");
    const dateInput = document.getElementById("dateInput");

    dateType.addEventListener("change", function() {
      yearInput.style.display = monthInput.style.display = dateInput.style.display = "none";
      if (this.value === "year") yearInput.style.display = "";
      if (this.value === "month") monthInput.style.display = "";
      if (this.value === "date") dateInput.style.display = "";
    });

    const q = document.getElementById("searchQuery");
    const btn = document.getElementById("searchBtn");
    const info = document.getElementById("studentInfo");
    const rep = document.getElementById("studentReport");

    btn.addEventListener("click", async () => {
      const query = q.value.trim();
      const subject_id = document.getElementById("subjectSelect").value;
      const dateTypeVal = dateType.value;
      let year = yearInput.value;
      let month = monthInput.value;
      let date = dateInput.value;
      const params = new URLSearchParams({ query, subject_id, dateType: dateTypeVal, year, month, date });

      info.innerHTML = "Searching…";
      rep.innerHTML = "";
      const data = await getJSON(`/api/student_report?${params.toString()}`);
      if (!data.ok) {
        info.innerHTML = `<p>Error: ${data.error || "failed"}</p>`;
        return;
      }
      if (!data.student) {
        info.innerHTML = `<p>No matching student found.</p>`;
        return;
      }
      const s = data.student;
      info.innerHTML = `<div class="card-lite"><strong>${s.name}</strong> — Roll No: <strong>${s.roll_no}</strong></div>`;
      const rows = data.rows;
      if (rows.length === 0) {
        rep.innerHTML = "<p>No attendance records yet.</p>";
        return;
      }
      let html = `<table class="table"><thead><tr><th>S.No</th><th>Date</th><th>Subject</th><th>Status</th></tr></thead><tbody>`;
      rows.forEach((r, i) => {
        html += `<tr><td>${i+1}</td><td>${r.date}</td><td>${r.subject}</td><td>${r.status}</td></tr>`;
      });
      html += `</tbody></table>`;
      rep.innerHTML = html;
    });
  }
});
