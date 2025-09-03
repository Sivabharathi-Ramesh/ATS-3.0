/* utilities */
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

/* fetch helpers */
const getJSON = async (url) => (await fetch(url)).json();
const postJSON = async (url, body) =>
  (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

/* populate subject dropdown */
async function loadSubjects(selectEl) {
  const subs = await getJSON("/api/subjects");
  selectEl.innerHTML = subs.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
}

/* populate students table body */
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

/* enable save only when all chosen */
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

/* page routing by data-page attribute */
document.addEventListener("DOMContentLoaded", async () => {
  const page = document.body.dataset.page;

  // shared: fill today's date placeholder
  const todayEl = document.getElementById("todayDate");
  if (todayEl) todayEl.textContent = fmtToday();

  if (page === "store") {
    const subjSel = document.getElementById("subjectSelect");
    const bodyEl = document.getElementById("studentBody");
    const saveBtn = document.getElementById("saveBtn");
    await loadSubjects(subjSel);
    await loadStudents(bodyEl);
    wireValidation(bodyEl, saveBtn);

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
        alert("✅ Attendance stored successfully!");
        // reset selections
        bodyEl.querySelectorAll("input[type=radio]").forEach(i => i.checked = false);
        wireValidation(bodyEl, saveBtn);
      } else {
        alert("❌ Failed to store: " + (resp.error || "Unknown error"));
        console.error(resp);
      }
    });
  }

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
// Check if all statuses are "Absent" (meaning no attendance taken for any student)
const allAbsent = rows.every(r => r.status === 'Absent');
if (allAbsent) {
  area.innerHTML = `<p>No attendance found for this date.</p>`;
  return;
}
// else show table as usual

      let html = `<h3>Records for ${subjSel.options[subjSel.selectedIndex].text} on ${dmy}</h3>`;
      html += `<table class="table"><thead><tr><th>S.No</th><th>Roll No</th><th>Name</th><th>Status</th></tr></thead><tbody>`;
      rows.forEach((r, i) => {
        html += `<tr><td>${i+1}</td><td>${r.roll_no}</td><td>${r.name}</td><td>${r.status}</td></tr>`;
      });
      html += `</tbody></table>`;
      area.innerHTML = html;
    });
  }

  if (page === "individual") {
    const q = document.getElementById("searchQuery");
    const btn = document.getElementById("searchBtn");
    const info = document.getElementById("studentInfo");
    const rep = document.getElementById("studentReport");

    btn.addEventListener("click", async () => {
      const query = q.value.trim();
      if (!query) return alert("Enter a name or roll no.");
      info.innerHTML = "Searching…";
      rep.innerHTML = "";
      const data = await getJSON(`/api/student_report?query=${encodeURIComponent(query)}`);
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
