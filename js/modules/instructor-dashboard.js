import { auth, db, firebaseSignOut } from '../firebase-config.js';
import { AuthService } from './auth.js';

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

import {
  getStudentsByClass,
  addStudent,
  deleteStudent,
  getSessionsByClass,
  createSession,
  updateAttendance,
  deleteSession,
  getAttendanceBySession
} from './firestore.js';

import { formatDate } from './ui-utils.js';


export class InstructorDashboard {

  constructor() {

    this.currentUser = null;
    this.userData = null;
    this.assignedClass = null;

    this.students = [];
    this.sessions = [];

    // initialization is performed by the page using `new InstructorDashboard().init()`
  }

  async init() {

    AuthService.onAuthStateChanged(async (user) => {

      if (!user) {
        window.location.href = "../index.html";
        return;
      }
    
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
    this.assignedClass = this.userData.assignedClassId || this.userData.assignedClass || this.userData.class;

  }

  async loadStudents() {

    this.students = await getStudentsByClass(this.assignedClass);

  }

  async loadSessions() {
    // Fetch sessions and attach their attendance records so the UI
    // can access `session.records` and `session.date` consistently.
    this.sessions = await getSessionsByClass(this.assignedClass);

    for (const session of this.sessions) {
      try {
        const records = await getAttendanceBySession(session.id);
        session.records = Array.isArray(records) ? records : [];
      } catch (err) {
        session.records = [];
      }
    }

  }

  renderDashboard() {

    const mainContent = document.querySelector('.main-content');

    if (!mainContent) {
      console.error('Main content container not found');
      return;
    }

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

    document.querySelectorAll(".tab-btn").forEach(btn => {

      btn.addEventListener("click", (e) => {

        const tabName = e.target.dataset.tab;

        this.switchTab(tabName, e);

      });

    });

    // Sidebar nav links -> map hash to internal tabs
    const navLinks = document.querySelectorAll('.nav-link');
    const mapHashToTab = (hash) => {
      if (!hash) return '';
      const key = hash.replace('#','');
      const map = {
        overview: 'students',
        students: 'students',
        attendance: 'attendance',
        analytics: 'stats'
      };
      return map[key] || key;
    };

    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const tabName = mapHashToTab(link.getAttribute('href') || '');
        if (!tabName) return;
        navLinks.forEach(n => n.classList.remove('active'));
        link.classList.add('active');
        const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
        if (btn) btn.click();
        else this.switchTab(tabName, null);
        try { history.replaceState(null, '', '#' + (link.getAttribute('href') || '').replace('#','')); } catch (e) {}
      });
    });

    window.addEventListener('hashchange', () => {
      const tabName = mapHashToTab(location.hash);
      if (!tabName) return;
      const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
      if (btn) btn.click();
      else this.switchTab(tabName, null);
      navLinks.forEach(n => n.classList.toggle('active', n.getAttribute('href') === ('#' + (location.hash.replace('#','')))));
    });

    if (location.hash) {
      const initialTab = mapHashToTab(location.hash);
      if (initialTab) {
        const btn = document.querySelector(`.tab-btn[data-tab="${initialTab}"]`);
        if (btn) btn.click();
        else this.switchTab(initialTab, null);
      }
    }

    document.getElementById("logoutBtn").addEventListener("click", async () => {

      await firebaseSignOut(auth);
      window.location.href = "../index.html";

    });

  }

  switchTab(tabName, event) {

    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    const selectedTab = document.getElementById(`${tabName}Tab`);
    if (selectedTab) selectedTab.classList.remove('hidden');

    if (event && event.target) event.target.classList.add('active');

    if (tabName === 'students') this.renderStudentsTab();
    if (tabName === 'attendance') this.renderAttendanceTab();
    if (tabName === 'stats') this.renderStatsTab();

  }

  /* ---------------- STUDENTS TAB ---------------- */

  renderStudentsTab() {

    const container = document.getElementById("studentsTab");

    const studentsHTML = this.students.map(student => `
      <tr>
        <td>${student.name}</td>
        <td>${student.email || ""}</td>
        <td>
          <button class="delete-student" data-id="${student.id}">
          Delete
          </button>
        </td>
      </tr>
    `).join("");

    container.innerHTML = `

      <h2>Students</h2>

      <form id="addStudentForm">
        <input type="text" id="studentName" placeholder="Student Name" required>
        <input type="email" id="studentEmail" placeholder="Email">
        <button type="submit">Add Student</button>
      </form>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>${studentsHTML}</tbody>
      </table>
    `;

    document.getElementById("addStudentForm")
      .addEventListener("submit", async (e) => {

        e.preventDefault();

        const name = document.getElementById("studentName").value;
        const email = document.getElementById("studentEmail").value;

        await addStudent(name, this.assignedClass);

        await this.loadStudents();
        this.renderStudentsTab();

      });

    document.querySelectorAll(".delete-student")
      .forEach(btn => {

        btn.addEventListener("click", async (e) => {

          const id = e.target.dataset.id;

          await deleteStudent(id);

          await this.loadStudents();
          this.renderStudentsTab();

        });

      });

  }


  /* ---------------- ATTENDANCE TAB ---------------- */

  renderAttendanceTab() {

    const container = document.getElementById("attendanceTab");

    const sessionsHTML = this.sessions.map(session => `
      <tr>
        <td>${formatDate(session.date)}</td>

        <td>
          ${session.records.filter(r => r.status === "present").length}
          /
          ${session.records.length}
        </td>

        <td>
          <button class="view-session" data-id="${session.id}">View</button>
          <button class="delete-session" data-id="${session.id}">Delete</button>
        </td>
      </tr>
    `).join("");

    container.innerHTML = `

      <h2>Attendance</h2>

      <button id="newSessionBtn">New Attendance Session</button>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Attendance</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>${sessionsHTML}</tbody>

      </table>
    `;

    document.getElementById("newSessionBtn")
      .addEventListener("click", () => {

        this.renderNewSessionForm();

      });

    document.querySelectorAll(".delete-session")
      .forEach(btn => {

        btn.addEventListener("click", async (e) => {

          const id = e.target.dataset.id;

          await deleteSession(id);

          await this.loadSessions();
          this.renderAttendanceTab();

        });

      });

  }


  /* ---------------- CREATE SESSION ---------------- */

  renderNewSessionForm() {

    const container = document.getElementById("attendanceTab");

    const studentsHTML = this.students.map(student => `
      <tr>
        <td>${student.name}</td>

        <td>
          <select data-id="${student.id}">
            <option value="present">Present</option>
            <option value="absent">Absent</option>
          </select>
        </td>
      </tr>
    `).join("");

    container.innerHTML = `

      <h2>New Attendance Session</h2>

      <table>
        <thead>
          <tr>
            <th>Student</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>${studentsHTML}</tbody>
      </table>

      <button id="saveAttendance">Save Attendance</button>
      <button id="cancelSession">Cancel</button>

    `;

    document.getElementById("cancelSession")
      .addEventListener("click", () => {

        this.renderAttendanceTab();

      });

    document.getElementById("saveAttendance")
      .addEventListener("click", async () => {

        const records = [];

        document.querySelectorAll("select").forEach(select => {

          const studentId = select.dataset.id;
          const status = select.value;

          const student = this.students.find(s => s.id === studentId);

          records.push({
            studentId,
            name: student.name,
            status
          });

        });

        await createSession({
          class: this.assignedClass,
          date: new Date().toISOString().split("T")[0],
          records,
          createdBy: this.currentUser.uid
        });

        await this.loadSessions();
        this.renderAttendanceTab();

      });

  }


  /* ---------------- STATISTICS ---------------- */

  renderStatsTab() {

    const container = document.getElementById("statsTab");

    const totalAttendance = this.sessions.reduce((total, session) => {

      return total + session.records.filter(r => r.status === "present").length;

    }, 0);

    const totalPossible = this.sessions.reduce((total, session) => {

      return total + session.records.length;

    }, 0);

    const percent = totalPossible === 0
      ? 0
      : Math.round((totalAttendance / totalPossible) * 100);

    container.innerHTML = `

      <h2>Statistics</h2>

      <p>Total Students: ${this.students.length}</p>
      <p>Total Sessions: ${this.sessions.length}</p>
      <p>Average Attendance: ${percent}%</p>

      <button onclick="window.print()">Print Report</button>

    `;

  }

}
