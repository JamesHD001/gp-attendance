import { db } from '../firebase-config.js';
import { AuthService } from './auth.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";
import {
  getStudentsByClass, addStudent, deleteStudent,
  getSessionsByClass, createSession, deleteSession,
  getAttendanceBySession, getClassById,
  getPerformanceRatingsByClass, savePerformanceRating
} from './firestore.js';
import {
  formatDate, createTable, createTableSkeleton,
  clearElement, showNotification
} from './ui-utils.js';
import { renderAnalyticsTab } from './analytics-utils.js';
import { renderGraduationTab } from './graduation-utils.js';

export class InstructorDashboard {
  constructor() {
    this.currentUser = null;
    this.userData = null;
    this.assignedClass = null;
    this.assignedClassName = '';
    this.students = [];
    this.sessions = [];
    this.performanceRatings = [];
    this.isDemoMode = false;
    this.isLoading = true;
    this.currentTab = 'students';
    this.eventListenersInitialized = false;
  }

  async init() {
    const isLocal = typeof window !== 'undefined' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

    if (isLocal) {
      this.isDemoMode = true;
      this.currentUser = AuthService.getCurrentUser();
      this.userData = { name: 'Local Instructor', assignedClassId: 'local-class' };
      this.assignedClass = 'local-class';
      this.assignedClassName = 'Demo Class';
      this.renderDashboard();
      this.attachFreshEventListeners();
      try {
        await this.loadStudents();
        await this.loadSessions();
        await this.loadPerformanceRatings();
      } catch (error) {
        console.warn('Instructor local-mode data load failed:', error);
      } finally {
        this.isLoading = false;
        this.renderDashboard();
        this.attachFreshEventListeners();
      }
      return;
    }

    AuthService.onAuthStateChanged(async (user) => {
      if (!user) { window.location.href = "../index.html"; return; }
      const allowed = await AuthService.requireRole("instructor");
      if (!allowed) return;
      this.currentUser = user;
      this.isLoading = true;
      await this.loadInstructorData();
      this.renderDashboard();
      this.attachFreshEventListeners();
      try {
        await this.loadStudents();
        await this.loadSessions();
        await this.loadPerformanceRatings();
      } finally {
        this.isLoading = false;
        this.renderDashboard();
        this.attachFreshEventListeners();
      }
    });
  }

  attachFreshEventListeners() {
    this.eventListenersInitialized = false;
    this.attachEventListeners();
  }

  async loadInstructorData() {
    const userDoc = await getDoc(doc(db, "users", this.currentUser.uid));
    this.userData = userDoc.data() || {};
    // FIX Bug 5: prefer assignedClassId, fall back for legacy docs
    this.assignedClass = this.userData.assignedClassId || this.userData.assignedClass || null;
    if (this.assignedClass) {
      const classDoc = await getClassById(this.assignedClass);
      this.assignedClassName = classDoc?.name || this.assignedClass;
    } else {
      this.assignedClassName = 'Unassigned';
    }
  }

  async loadStudents() {
    if (!this.assignedClass) {
      this.students = [];
      return;
    }
    this.students = await getStudentsByClass(this.assignedClass);
  }

  async loadSessions() {
    if (!this.assignedClass) {
      this.sessions = [];
      return;
    }
    this.sessions = await getSessionsByClass(this.assignedClass);
    for (const session of this.sessions) {
      try { session.records = await getAttendanceBySession(session.id); }
      catch { session.records = []; }
    }
  }

  async loadPerformanceRatings() {
    if (!this.assignedClass) {
      this.performanceRatings = [];
      return;
    }

    this.performanceRatings = await getPerformanceRatingsByClass(this.assignedClass);
  }

  renderDashboard() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;
    mainContent.innerHTML = `
      <header class="dashboard-header">
        <div>
          <h1>Instructor Dashboard</h1>
          <p>${this.userData.name || 'Instructor'} — ${this.assignedClassName} Class</p>
        </div>
        <button id="logoutBtn" class="btn btn-secondary">Logout</button>
      </header>
      <nav class="dashboard-nav">
        <button class="tab-btn active" data-tab="students">Students</button>
        <button class="tab-btn" data-tab="attendance">Attendance</button>
        <button class="tab-btn" data-tab="performance">Performance</button>
        <button class="tab-btn" data-tab="graduation">Graduation</button>
        <button class="tab-btn" data-tab="stats">Statistics</button>
      </nav>
      <div id="studentsTab" class="tab-content"></div>
      <div id="attendanceTab" class="tab-content hidden"></div>
      <div id="performanceTab" class="tab-content hidden"></div>
      <div id="graduationTab" class="tab-content hidden"></div>
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
    const mapHash = h => ({ overview:'students',students:'students',attendance:'attendance',performance:'performance',graduation:'graduation',analytics:'stats' })[(h||'').replace('#','')] || (h||'').replace('#','');
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
      await AuthService.logout();
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
    if (tabName === 'performance') this.renderPerformanceTab();
    if (tabName === 'graduation') this.renderGraduationTab();
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
        const email = (emailInput.value || '').trim();
        await addStudent(name, this.assignedClass, email || null);
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

    if (this.isLoading) {
      container.appendChild(createTableSkeleton(6, 3));
      return;
    }

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
    if (this.isLoading) {
      clearElement(container);
      container.innerHTML = '<h2>Attendance</h2>';
      container.appendChild(createTableSkeleton(5, 3));
      return;
    }
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
        await createSession({ class: this.assignedClass, date: new Date().toISOString().split("T")[0], records, createdBy: this.currentUser?.uid || 'local-instructor' });
        await this.loadSessions();
        this.renderAttendanceTab();
        showNotification('Attendance saved', 'success');
      } catch (err) { console.error(err); showNotification('Failed to save attendance', 'error'); btn.disabled = false; }
    });
  }

  /* ---- PERFORMANCE TAB ---- */
  renderPerformanceTab() {
    const container = document.getElementById("performanceTab");
    clearElement(container);

    container.innerHTML = `
      <h2>Performance</h2>
      <p class="text-muted">Record a rating from 1 to 5 and add recommendations for each student in your class.</p>
    `;

    if (this.isLoading) {
      container.appendChild(createTableSkeleton(6, 4));
      return;
    }

    if (this.students.length === 0) {
      container.innerHTML += '<p class="text-muted">No students available for rating yet.</p>';
      return;
    }

    const ratingsByStudent = this.performanceRatings.reduce((acc, item) => {
      acc[item.studentId] = item;
      return acc;
    }, {});

    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Student</th>
          <th>Rating</th>
          <th>Recommendation</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    this.students.forEach(student => {
      const existing = ratingsByStudent[student.id] || {};
      const row = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.textContent = student.name;

      const ratingCell = document.createElement('td');
      const ratingSelect = document.createElement('select');
      ratingSelect.className = 'form-select';
      ratingSelect.innerHTML = `
        <option value="">Select rating</option>
        <option value="1">1 - Poor</option>
        <option value="2">2 - Fair</option>
        <option value="3">3 - Good</option>
        <option value="4">4 - Very Good</option>
        <option value="5">5 - Excellent</option>
      `;
      ratingSelect.value = existing.rating ? String(existing.rating) : '';
      ratingCell.appendChild(ratingSelect);

      const recommendationCell = document.createElement('td');
      const recommendationInput = document.createElement('textarea');
      recommendationInput.className = 'form-input';
      recommendationInput.rows = 2;
      recommendationInput.placeholder = 'Add instructor recommendation';
      recommendationInput.value = existing.recommendation || '';
      recommendationCell.appendChild(recommendationInput);

      const actionsCell = document.createElement('td');
      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn-primary btn-small';
      saveBtn.textContent = existing.rating ? 'Update' : 'Save';
      saveBtn.addEventListener('click', async () => {
        const rating = Number(ratingSelect.value);
        if (!rating) {
          showNotification('Select a rating before saving', 'warning');
          return;
        }

        saveBtn.disabled = true;
        try {
          await savePerformanceRating({
            classId: this.assignedClass,
            studentId: student.id,
            instructorId: this.currentUser?.uid || 'local-instructor',
            rating,
            recommendation: recommendationInput.value || '',
            studentName: student.name
          });
          await this.loadPerformanceRatings();
          this.renderPerformanceTab();
          showNotification(`Performance saved for ${student.name}`, 'success');
        } catch (error) {
          console.error(error);
          showNotification('Failed to save performance rating', 'error');
        } finally {
          saveBtn.disabled = false;
        }
      });
      actionsCell.appendChild(saveBtn);

      row.append(nameCell, ratingCell, recommendationCell, actionsCell);
      tbody.appendChild(row);
    });

    container.appendChild(table);
  }

  /* ---- STATISTICS TAB ---- */
  // FIX Bug 1: was missing `async` — used await without it, causing SyntaxError
  async renderStatsTab() {
    const tab = document.getElementById("statsTab");
    clearElement(tab);

    await renderAnalyticsTab(tab, [{ id: this.assignedClass, name: this.assignedClassName }], {
      assignedClassId: this.assignedClass,
      requireAuth: true,
      isDemoMode: this.isDemoMode,
      emptyStateMessage: 'Attendance analytics loads only for authenticated instructors assigned to a real class.'
    });
  }

  async renderGraduationTab() {
    const tab = document.getElementById("graduationTab");
    clearElement(tab);

    await renderGraduationTab(tab, [{ id: this.assignedClass, name: this.assignedClassName }], {
      assignedClassId: this.assignedClass,
      requireAuth: true,
      isDemoMode: this.isDemoMode,
      emptyStateMessage: 'Graduation readiness loads only for authenticated instructors assigned to a real class.',
      noClassMessage: 'No class is assigned to this instructor yet, so graduation readiness cannot be calculated.'
    });
  }
}
