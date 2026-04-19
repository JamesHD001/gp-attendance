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
  getAttendanceBySession,
  calculateAttendanceStats,
  getAttendanceByTimePeriod,
  getGatheringPlaceStats,
  getNextClassDates
} from './firestore.js';

import { formatDate, createTable, createSelect, createButton, clearElement } from './ui-utils.js';

// Inspirational and spiritual quotes
const INSPIRATIONAL_QUOTES = [
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "Everything you want is on the other side of fear.", author: "George Addair" },
  { text: "Believe in yourself. You are braver than you think, more talented than you know, and capable of more than you imagine.", author: "Roy T. Bennett" },
  { text: "I learned that courage was not the absence of fear, but the triumph over it.", author: "Nelson Mandela" },
  { text: "The only impossible journey is the one you never begin.", author: "Tony Robbins" },
  { text: "Success is not about the destination, it's about the journey and the person you become.", author: "Unknown" },
  { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb" },
  { text: "Your potential is endless. Your growth is optional.", author: "Unknown" },
  { text: "Push yourself, because no one else is going to do it for you.", author: "Unknown" },
  { text: "Sometimes we're tested not to show our weaknesses, but to discover our strengths.", author: "Unknown" },
  { text: "The only way out is through.", author: "Robert Frost" },
  { text: "Your potential is endless. Your growth is optional.", author: "Unknown" },
  { text: "Great things never come from comfort zones.", author: "Unknown" },
  { text: "Dream it. Believe it. Build it.", author: "Unknown" },
  { text: "Do something today that your future self will thank you for.", author: "Sean Patrick Flanery" }
];

export class InstructorDashboard {

  constructor() {

    this.currentUser = null;
    this.userData = null;
    this.assignedClass = null;

    this.students = [];
    this.sessions = [];
    this.quoteInterval = null;
    this.currentQuoteIndex = 0;
    this.currentTab = 'students';
    this.eventListenersInitialized = false;

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

    if (this.eventListenersInitialized) return;
    this.eventListenersInitialized = true;

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

    if (this.currentTab === tabName) return;
    this.currentTab = tabName;

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
    const tab = document.getElementById("statsTab");
    clearElement(tab);

    // Create main container with sections
    const mainContainer = document.createElement('div');
    mainContainer.className = 'analytics-container';

    // 1. QUOTE SECTION
    const quoteSection = document.createElement('div');
    quoteSection.className = 'quote-section';
    const quoteBox = document.createElement('div');
    quoteBox.className = 'quote-box';
    quoteBox.id = 'quoteBox';
    this.displayRandomQuote(quoteBox);
    quoteSection.appendChild(quoteBox);
    mainContainer.appendChild(quoteSection);

    // Start quote rotation (change every 5 minutes)
    if (this.quoteInterval) clearInterval(this.quoteInterval);
    this.quoteInterval = setInterval(() => {
      const quoteBox = document.getElementById('quoteBox');
      if (quoteBox) this.displayRandomQuote(quoteBox);
    }, 300000); // 5 minutes

    // 2. GENERAL GP STATS SECTION
    const gpStatsSection = document.createElement('div');
    gpStatsSection.className = 'analytics-section';
    const gpStatsTitle = document.createElement('h2');
    gpStatsTitle.textContent = 'Gathering Place Overall Statistics';
    gpStatsSection.appendChild(gpStatsTitle);

    try {
      const gpStats = await getGatheringPlaceStats();
      const gpStatsGrid = document.createElement('div');
      gpStatsGrid.className = 'stats-grid';

      const stats = [
        { label: 'Total Classes', value: gpStats.totalClasses },
        { label: 'Total Students', value: gpStats.totalStudents },
        { label: 'Total Sessions', value: gpStats.totalSessions },
        { label: 'Present', value: gpStats.totalPresent },
        { label: 'Absent', value: gpStats.totalAbsent },
        { label: 'Overall Attendance Rate', value: gpStats.overallRate + '%' }
      ];

      stats.forEach(stat => {
        const statCard = document.createElement('div');
        statCard.className = 'stat-card';
        statCard.innerHTML = `
          <div class="stat-label">${stat.label}</div>
          <div class="stat-value">${stat.value}</div>
        `;
        gpStatsGrid.appendChild(statCard);
      });

      gpStatsSection.appendChild(gpStatsGrid);
    } catch (error) {
      console.error('Error loading GP stats:', error);
      gpStatsSection.innerHTML += '<p class="text-muted">No attendance data available yet.</p>';
    }

    mainContainer.appendChild(gpStatsSection);

    // 3. CLASS-SPECIFIC ATTENDANCE STATS SECTION
    const classStatsSection = document.createElement('div');
    classStatsSection.className = 'analytics-section';
    const classStatsTitle = document.createElement('h2');
    classStatsTitle.textContent = 'Attendance Statistics by Class';
    classStatsSection.appendChild(classStatsTitle);

    // Class selector with period filter
    const filterRow = document.createElement('div');
    filterRow.className = 'filter-row';

    const classSelect = createSelect(
      [{ label: 'Select Class...', value: '' },
        { label: 'Your Class', value: this.assignedClass?.id }],
      'analyticsClassSelect'
    );

    const periodSelect = createSelect(
      [
        { label: 'All Time', value: 'all' },
        { label: 'Weekly', value: 'weekly' },
        { label: 'Monthly', value: 'monthly' },
        { label: 'Annually', value: 'annually' }
      ],
      'analyticsPeriodSelect'
    );

    filterRow.appendChild(classSelect);
    filterRow.appendChild(periodSelect);
    classStatsSection.appendChild(filterRow);

    const classStatsContainer = document.createElement('div');
    classStatsContainer.id = 'classStatsContainer';
    classStatsSection.appendChild(classStatsContainer);

    // Event listener for class/period selection
    const updateClassStats = async () => {
      const classId = classSelect.value;
      const period = periodSelect.value;
      clearElement(classStatsContainer);

      if (!classId) {
        classStatsContainer.innerHTML = '<p class="text-muted">Select a class to view statistics.</p>';
        return;
      }

      try {
        let stats;
        if (period === 'all') {
          stats = await calculateAttendanceStats(classId);
        } else {
          stats = await getAttendanceByTimePeriod(classId, period);
        }

        if (stats.totalSessions === 0) {
          classStatsContainer.innerHTML = '<p class="text-muted">No attendance sessions recorded for this class.</p>';
          return;
        }

        // Summary cards
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'stats-grid';
        summaryDiv.innerHTML = `
          <div class="stat-card">
            <div class="stat-label">Total Students</div>
            <div class="stat-value">${stats.totalStudents}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Sessions Recorded</div>
            <div class="stat-value">${stats.totalSessions}</div>
          </div>
        `;
        classStatsContainer.appendChild(summaryDiv);

        // Attendance table
        if (Object.keys(stats.studentStats).length > 0) {
          const rows = Object.values(stats.studentStats).map(stat => ({
            'Student': stat.name,
            'Present': stat.present,
            'Absent': stat.absent,
            'Total': stat.total,
            'Rate': stat.attendanceRate + '%'
          }));

          const table = createTable(
            ['Student', 'Present', 'Absent', 'Total', 'Rate'],
            rows
          );
          classStatsContainer.appendChild(table);
        }
      } catch (error) {
        console.error('Error loading class stats:', error);
        classStatsContainer.innerHTML = '<p class="text-danger">Error loading statistics.</p>';
      }
    };

    classSelect.addEventListener('change', updateClassStats);
    periodSelect.addEventListener('change', updateClassStats);

    mainContainer.appendChild(classStatsSection);

    // 4. NEXT CLASS DATES SECTION
    const nextClassSection = document.createElement('div');
    nextClassSection.className = 'analytics-section';
    const nextClassTitle = document.createElement('h2');
    nextClassTitle.textContent = 'Upcoming Gathering Place Schedule';
    nextClassSection.appendChild(nextClassTitle);

    try {
      const nextDates = getNextClassDates(30);
      const scheduleContainer = document.createElement('div');
      scheduleContainer.className = 'schedule-list';

      nextDates.forEach(entry => {
        const scheduleItem = document.createElement('div');
        scheduleItem.className = 'schedule-item';
        const dateObj = new Date(entry.date + 'T00:00:00');
        const formattedDate = dateObj.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric' 
        });

        let classesHTML = '';
        if (entry.classes.length > 0) {
          classesHTML = `<div class="schedule-classes">${entry.classes.join(', ')}</div>`;
        }

        scheduleItem.innerHTML = `
          <div class="schedule-date">${formattedDate}</div>
          <div class="schedule-info">
            <div class="schedule-type">${entry.type}</div>
            ${classesHTML}
          </div>
        `;
        scheduleContainer.appendChild(scheduleItem);
      });

      nextClassSection.appendChild(scheduleContainer);
    } catch (error) {
      console.error('Error loading schedule:', error);
      nextClassSection.innerHTML += '<p class="text-danger">Error loading schedule.</p>';
    }

    mainContainer.appendChild(nextClassSection);

    // Add print functionality
    const printBtn = createButton('Print Report', () => window.print());
    printBtn.className = 'btn btn-secondary mt-lg mb-lg';
    mainContainer.insertBefore(printBtn, mainContainer.firstChild);

    tab.appendChild(mainContainer);
  }

  displayRandomQuote(container) {
    const quote = INSPIRATIONAL_QUOTES[Math.floor(Math.random() * INSPIRATIONAL_QUOTES.length)];
    container.innerHTML = `
      <blockquote class="quote-text">"${quote.text}"</blockquote>
      <footer class="quote-author">— ${quote.author}</footer>
    `;
  }

}
