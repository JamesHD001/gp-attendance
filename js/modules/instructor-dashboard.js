import { auth, db, firebaseSignOut } from '../firebase-config.js';
import { AuthService } from './auth.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";
import {
  getStudentsByClass, addStudent, deleteStudent,
  getSessionsByClass, createSession, deleteSession,
  getAttendanceBySession
} from './firestore.js';
import {
  formatDate, createTable, createButton,
  clearElement, showNotification, renderAnalyticsSection
} from './ui-utils.js';

export class InstructorDashboard {
  constructor() {
    this.currentUser = null;
    this.userData = null;
    this.assignedClass = null;
    this.students = [];
    this.sessions = [];
    this.currentTab = 'students';
    this.eventListenersInitialized = false;
  }

  async init() {
    AuthService.onAuthStateChanged(async (user) => {
      if (!user) { window.location.href = "../index.html"; return; }
      const allowed = await AuthService.requireRole("instructor");
      if (!allowed) return;
      this.currentUser = user;
      await this.loadInstructorData();
      await this.loadStudents();
      await this.loadSessions();
      this.renderDashboard();
      this.attachEventListeners();
    });
  }

  async loadInstructorData() {
    const userDoc = await getDoc(doc(db, "users", this.currentUser.uid));
    this.userData = userDoc.data();
    // FIX Bug 5: prefer assignedClassId, fall back for legacy docs
    this.assignedClass = this.userData.assignedClassId || this.userData.assignedClass || null;
  }

  async loadStudents() { this.students = await getStudentsByClass(this.assignedClass); }

  async loadSessions() {
    this.sessions = await getSessionsByClass(this.assignedClass);
    for (const session of this.sessions) {
      try { session.records = await getAttendanceBySession(session.id); }
      catch { session.records = []; }
    }
  }

  renderDashboard() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;
    mainContent.innerHTML = `
      <header class="dashboard-header">
        <div>
          <h1>Instructor Dashboard</h1>
          <p>${this.userData.name} — ${String(this.assignedClass || '').toUpperCase()} Class</p>
        </div>
        <button id="logoutBtn" class="btn btn-secondary">Logout</button>
      </header>
      <nav class="dashboard-nav">
        <button class="tab-btn active" data-tab="students">Students</button>
        <button class="tab-btn" data-tab="attendance">Attendance</button>
        <button class="tab-btn" data-tab="stats">Statistics</button>
      </nav>
      <div id="studentsTab" class="tab-content"></div>
      <div id="attendanceTab" class="tab-content hidden"></div>
      <div id="statsTab" class="tab-content hidden"></div>
    `;
    this.renderStudentsTab();
  }

  attachEventListeners() {
    if (this.eventListenersInitialized) return;
    this.eventListenersInitialized = true;
    document.querySelectorAll(".tab-btn").forEach(btn =>
      btn.addEventListener("click", (e) => this.switchTab(e.target.dataset.tab, e)));
    const navLinks = document.querySelectorAll('.nav-link');
    const mapHash = h => ({ overview:'students',students:'students',attendance:'attendance',analytics:'stats' })[(h||'').replace('#','')] || (h||'').replace('#','');
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const t = mapHash(link.getAttribute('href')||''); if(!t) return;
        navLinks.forEach(n=>n.classList.remove('active')); link.classList.add('active');
        const btn = document.querySelector(`.tab-btn[data-tab="${t}"]`);
        if(btn) btn.click(); else this.switchTab(t, null);
      });
    });
    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
      await firebaseSignOut(auth); window.location.href = "../index.html";
    });
  }

  switchTab(tabName, event) {
    if (this.currentTab === tabName) return;
    this.currentTab = tabName;
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`${tabName}Tab`)?.classList.remove('hidden');
    // FIX: guard against null event (hash/sidebar navigation)
    if (event?.target) event.target.classList.add('active');
    if (tabName === 'students') this.renderStudentsTab();
    if (tabName === 'attendance') this.renderAttendanceTab();
    if (tabName === 'stats') this.renderStatsTab();
  }

  /* ---- STUDENTS TAB ---- */
  renderStudentsTab() {
    const container = document.getElementById("studentsTab");
    clearElement(container);

    const heading = document.createElement('h2');
    heading.textContent = 'Students';
    container.appendChild(heading);

    // FIX Bug 9: proper validation + notifications, no silent failures
    const formWrap = document.createElement('div');
    formWrap.className = 'flex gap-md mb-lg';
    formWrap.style.flexWrap = 'wrap';

    const nameInput = document.createElement('input');
    nameInput.type = 'text'; nameInput.placeholder = 'Student Name'; nameInput.className = 'form-input'; nameInput.style.flex = '1';

    const emailInput = document.createElement('input');
    emailInput.type = 'email'; emailInput.placeholder = 'Email (optional)'; emailInput.className = 'form-input'; emailInput.style.flex = '1';

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add Student'; addBtn.className = 'btn btn-primary';
    addBtn.addEventListener('click', async () => {
      const name = (nameInput.value || '').trim();
      if (!name) { showNotification('Student name is required', 'warning'); return; }
      addBtn.disabled = true;
      try {
        await addStudent(name, this.assignedClass);
        nameInput.value = ''; emailInput.value = '';
        await this.loadStudents();
        this.renderStudentsTab();
        showNotification('Student added successfully', 'success');
      } catch (err) {
        console.error(err);
        showNotification('Failed to add student', 'error');
      } finally { addBtn.disabled = false; }
    });

    formWrap.append(nameInput, emailInput, addBtn);
    container.appendChild(formWrap);

    if (this.students.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-muted';
      empty.textContent = 'No students yet. Add one above.';
      container.appendChild(empty);
      return;
    }

    const rows = this.students.map(s => ({
      'Name': s.name,
      'Email': s.email || '—',
      'Actions': () => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-danger btn-small'; btn.textContent = 'Delete';
        btn.addEventListener('click', async () => {
          if (!confirm(`Delete ${s.name}?`)) return;
          try {
            await deleteStudent(s.id);
            await this.loadStudents();
            this.renderStudentsTab();
            showNotification('Student removed', 'success');
          } catch (err) { console.error(err); showNotification('Failed to delete student', 'error'); }
        });
        return btn;
      }
    }));
    container.appendChild(createTable(['Name', 'Email', 'Actions'], rows));
  }

  /* ---- ATTENDANCE TAB ---- */
  renderAttendanceTab() {
    const container = document.getElementById("attendanceTab");
    // FIX Bug 10: formatDate correctly handles Firestore Timestamps via its toDate() guard
    const sessionsHTML = this.sessions.map(session => `
      <tr>
        <td>${formatDate(session.date)}</td>
        <td>${session.records.filter(r => r.status === "present").length} / ${session.records.length}</td>
        <td>
          <button class="btn btn-small btn-danger delete-session" data-id="${session.id}">Delete</button>
        </td>
      </tr>
    `).join("");

    container.innerHTML = `
      <h2>Attendance</h2>
      <button id="newSessionBtn" class="btn btn-primary mb-lg">New Attendance Session</button>
      <table class="data-table">
        <thead><tr><th>Date</th><th>Attendance</th><th>Actions</th></tr></thead>
        <tbody>${sessionsHTML}</tbody>
      </table>
    `;

    document.getElementById("newSessionBtn")?.addEventListener("click", () => this.renderNewSessionForm());
    container.querySelectorAll(".delete-session").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        if (!confirm('Delete this session?')) return;
        try {
          await deleteSession(e.target.dataset.id);
          await this.loadSessions();
          this.renderAttendanceTab();
          showNotification('Session deleted', 'success');
        } catch (err) { console.error(err); showNotification('Failed to delete session', 'error'); }
      });
    });
  }

  /* ---- NEW SESSION FORM ---- */
  renderNewSessionForm() {
    const container = document.getElementById("attendanceTab");
    const studentsHTML = this.students.map(s => `
      <tr>
        <td>${s.name}</td>
        <td><select class="form-select" data-id="${s.id}"><option value="present">Present</option><option value="absent">Absent</option></select></td>
      </tr>
    `).join("");

    container.innerHTML = `
      <h2>New Attendance Session</h2>
      <table class="data-table">
        <thead><tr><th>Student</th><th>Status</th></tr></thead>
        <tbody>${studentsHTML}</tbody>
      </table>
      <div class="flex gap-md mt-lg">
        <button id="saveAttendance" class="btn btn-primary">Save Attendance</button>
        <button id="cancelSession" class="btn btn-secondary">Cancel</button>
      </div>
    `;

    document.getElementById("cancelSession")?.addEventListener("click", () => this.renderAttendanceTab());
    document.getElementById("saveAttendance")?.addEventListener("click", async () => {
      const btn = document.getElementById("saveAttendance");
      btn.disabled = true;
      try {
        const records = [];
        container.querySelectorAll("select[data-id]").forEach(sel => {
          const student = this.students.find(s => s.id === sel.dataset.id);
          records.push({ studentId: sel.dataset.id, name: student?.name || '', status: sel.value });
        });
        await createSession({ class: this.assignedClass, date: new Date().toISOString().split("T")[0], records, createdBy: this.currentUser.uid });
        await this.loadSessions();
        this.renderAttendanceTab();
        showNotification('Attendance saved', 'success');
      } catch (err) { console.error(err); showNotification('Failed to save attendance', 'error'); btn.disabled = false; }
    });
  }

  /* ---- STATISTICS TAB ---- */
  // FIX Bug 1: was missing `async` — used await without it, causing SyntaxError
  async renderStatsTab() {
    const tab = document.getElementById("statsTab");
    clearElement(tab);

    const printBtn = createButton('Print Report', () => window.print());
    printBtn.className = 'btn btn-secondary mb-lg';
    tab.appendChild(printBtn);

    // FIX Bug 4: this.assignedClass is a string ID, NOT an object.
    // The original code wrongly used `this.assignedClass?.id` which always gave undefined.
    // FIX Bugs 12/13: shared analytics renderer — no more duplicated code
    await renderAnalyticsSection(tab, {
      classes: [{ id: this.assignedClass, name: 'Your Class' }],
      role: 'instructor',
      defaultClassId: this.assignedClass
    });
  }
}