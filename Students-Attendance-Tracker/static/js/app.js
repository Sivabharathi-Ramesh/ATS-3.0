// Utilities
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


// Use one version of loadSubjects
async function loadSubjects(selectEl) {
  const subs = await getJSON("/api/subjects");
  // The first option's text is changed based on context later
  selectEl.innerHTML = '<option value="">Select Subject</option>' + 
    subs.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
}


// Student table loader
async function loadStudents(tbodyEl) {
  const sts = await getJSON("/api/students");
  tbodyEl.innerHTML = sts.map((s, idx) => `
    <tr data-student-id="${s.id}">
      <td>${idx + 1}</td>
      <td>${s.roll_no}</td>
      <td>${s.name}</td>
      <td><input type="radio" name="st_${s.id}" value="Present"></td>
      <td><input type="radio" name="st_${s.id}" value="Absent Informed"></td>
      <td><input type="radio" name="st_${s.id}" value="Absent Uninformed"></td>
    </tr>
  `).join("");
}


// Attendance button enabler
function wireValidation(tbodyEl, saveBtn) {
  const update = () => {
    const rows = [...tbodyEl.querySelectorAll("tr")];
    if (rows.length === 0) {
        saveBtn.disabled = true;
        saveBtn.classList.add("disabled");
        saveBtn.classList.remove("ready");
        return;
    }
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


// Only ONE DOMContentLoaded
document.addEventListener("DOMContentLoaded", async () => {
  const page = document.body.dataset.page;


  // Shared: today's date
  const todayEl = document.getElementById("todayDate");
  if (todayEl) todayEl.textContent = fmtToday();


  // Store page logic
  if (page === "store") {
    const subjSel = document.getElementById("subjectSelect");
    const dateInp = document.getElementById("attendanceDate");
    const bodyEl = document.getElementById("studentBody");
    const saveBtn = document.getElementById("saveBtn");
    const statusMsg = document.getElementById("statusMessage");

    // Helper to format today's date as YYYY-MM-DD for the input
    const fmtTodayForInput = () => new Date().toISOString().split('T')[0];
    dateInp.value = fmtTodayForInput(); // Set default date to today

    await loadSubjects(subjSel);
    wireValidation(bodyEl, saveBtn);

    const checkExistingAttendance = async () => {
        const subject_id = subjSel.value;
        const selectedDate = dateInp.value;

        // If either subject or date is not selected, clear the table
        if (!subject_id || !selectedDate) {
            bodyEl.innerHTML = "";
            statusMsg.innerHTML = "Please select a subject and a date.";
            wireValidation(bodyEl, saveBtn);
            return;
        }

        // Load students first
        await loadStudents(bodyEl);

        // Convert date to dd-mm-yyyy for the API
        const date = ymdToDmy(selectedDate);
        const data = await getJSON(`/api/get_attendance_for_store?subject_id=${subject_id}&date=${date}`);
        
        if (data.ok && data.records) {
            let attendanceTaken = false;
            data.records.forEach(record => {
                if (record.status !== 'none') {
                    attendanceTaken = true;
                    const radio = document.querySelector(`tr[data-student-id="${record.student_id}"] input[value="${record.status}"]`);
                    if (radio) {
                        radio.checked = true;
                    }
                }
            });

            if (attendanceTaken) {
                statusMsg.innerHTML = `✅ Attendance for ${date} already exists. You can edit it.`;
                statusMsg.style.color = "green";
            } else {
                statusMsg.innerHTML = `ℹ️ No attendance found for ${date}. Please mark it below.`;
                statusMsg.style.color = "#333";
            }
            wireValidation(bodyEl, saveBtn); // Re-validate after checking radios
        }
    };
    
    // Add event listeners for BOTH subject and date changes
    subjSel.addEventListener("change", checkExistingAttendance);
    dateInp.addEventListener("change", checkExistingAttendance);

    document.getElementById("attendanceForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const date = ymdToDmy(dateInp.value); // Use selected date on submit
      const subject_id = parseInt(subjSel.value, 10);
      if (!subject_id || !date) {
        alert("Please select a subject and a date first.");
        return;
      }

      const marks = [...bodyEl.querySelectorAll("tr")].map(r => {
        const sid = parseInt(r.getAttribute("data-student-id"), 10);
        const status = r.querySelector(`input[name="st_${sid}"]:checked`).value;
        return { student_id: sid, status };
      });

      const resp = await postJSON("/api/save_attendance", { date, subject_id, marks });
      if (resp.ok) {
        alert("✅ Attendance stored successfully!");
        statusMsg.innerHTML = `✅ Attendance for ${date} already exists. You can edit it.`;
        statusMsg.style.color = "green";
      } else {
        alert("❌ Failed to store: " + (resp.error || "Unknown error"));
        console.error(resp);
      }
    });
  }


  // View Attendance
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
      if (!subject_id) { alert("Please select a subject."); return; }


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
      const allAbsent = rows.every(r => r.status === 'Absent Uninformed');
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


  // Individual report logic
  if (page === "individual") {
    const subjectSelect = document.getElementById("subjectSelect");
    await loadSubjects(subjectSelect);
    // Change the default option text
    subjectSelect.options[0].textContent = 'All Subjects';


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
    const totalDaysInput = document.getElementById("totalDays");


    btn.addEventListener("click", async () => {
      const query = q.value.trim();
      const totalDays = parseInt(totalDaysInput.value, 10);

      if (!query) {
        info.innerHTML = "<p>Please enter a name or roll number to search.</p>";
        rep.innerHTML = "";
        return;
      }

      if (!totalDays || totalDays <= 0) {
        info.innerHTML = "<p>Please enter a valid number for Total Working Days.</p>";
        rep.innerHTML = "";
        return;
      }

      const subject_id = subjectSelect.value;
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
      const daysPresent = data.days_present;
      const percentage = (daysPresent / totalDays) * 100;
      const percentageColor = percentage >= 75 ? 'green' : 'red';

      info.innerHTML = `
        <div class="card-lite" style="text-align:left; padding:15px;">
            <strong>${s.name}</strong> — Roll No: <strong>${s.roll_no}</strong>
            <hr style="border:0; border-top:1px solid #ddd; margin: 8px 0;">
            Days Present: <strong>${daysPresent}</strong> out of <strong>${totalDays}</strong> working days.
            <br>
            Attendance Percentage: <strong style="color: ${percentageColor}; font-size: 1.1em;">${percentage.toFixed(2)}%</strong>
        </div>
      `;

      const rows = data.rows;
      if (rows.length === 0) {
        rep.innerHTML = "<p>No attendance records found for the selected criteria.</p>";
        return;
      }

      let html = `<h4>Detailed Records</h4><table class="table"><thead><tr><th>S.No</th><th>Date</th><th>Subject</th><th>Status</th></tr></thead><tbody>`;
      rows.forEach((r, i) => {
        html += `<tr><td>${i+1}</td><td>${r.date}</td><td>${r.subject}</td><td>${r.status}</td></tr>`;
      });
      html += `</tbody></table>`;
      rep.innerHTML = html;
    });
  }
});