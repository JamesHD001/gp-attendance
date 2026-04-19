// Leader Dashboard Module
// Read-only access to attendance reports and class information

import {
  getClasses,
  getStudentsByClass,
  getSessionsByClass,
  getAttendanceBySession,
  calculateAttendanceStats,
  getAttendanceByTimePeriod,
  getGatheringPlaceStats,
  getNextClassDates
} from "./firestore.js";

import { AuthService } from "./auth.js";

import {
  clearElement,
  showNotification,
  formatDate,
  createTable,
  createCard,
  createStatCard,
  createSelect,
  triggerPrint
} from "./ui-utils.js";

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

export class LeaderDashboard {

  constructor() {
    this.currentUser = null;
    this.classes = [];
    this.quoteInterval = null;
    this.currentQuoteIndex = 0;
  }

  async init() {

    // Wait for Firebase auth state
    AuthService.onAuthStateChanged(async (user) => {

      if (!user) {
        window.location.href = "../index.html";
        return;
      }
    
      const allowed = await AuthService.requireRole("leader");
      if (!allowed) return;
    
      this.currentUser = user;
    
      await this.loadClasses();
      this.renderDashboard();
      this.setupEventListeners();
    
    });

  }

  async loadClasses() {

    try {

      this.classes = await getClasses();

    } catch (error) {

      console.error(error);
      showNotification("Failed to load classes", "error");

    }

  }

  setupEventListeners() {

    const logoutBtn = document.getElementById("logoutBtn");

    if (logoutBtn) {

      logoutBtn.addEventListener("click", async () => {

        await AuthService.logout();
        window.location.href = "../index.html";

      });

    }

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
        overview: 'overview',
        reports: 'reports',
        analytics: 'analytics'
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

  }

  switchTab(tabName, event) {

    document.querySelectorAll(".tab-content").forEach(tab => {

      tab.classList.add("hidden");

    });

    document.querySelectorAll(".tab-btn").forEach(btn => {

      btn.classList.remove("active");

    });

    const selectedTab = document.getElementById(`${tabName}Tab`);

    if (selectedTab) {

      selectedTab.classList.remove("hidden");

    }

    event.target.classList.add("active");

    if (tabName === "reports") this.renderReportsTab();
    if (tabName === "analytics") this.renderAnalyticsTab();

  }

  renderDashboard() {

    const mainContent = document.querySelector(".main-content");

    if (!mainContent) {

      console.error("Main content container not found");
      return;

    }

    clearElement(mainContent);

    const header = document.createElement("div");

    header.className = "flex-between mb-xl";

    header.innerHTML = `
      <div>
        <h1>Leader Dashboard</h1>
        <p class="text-muted">Read-only attendance reports</p>
      </div>
      <button id="logoutBtn" class="btn btn-secondary">Logout</button>
    `;

    mainContent.appendChild(header);

    const tabNav = document.createElement("div");

    tabNav.className = "tab-navigation mb-lg";

    tabNav.innerHTML = `
      <button class="tab-btn active" data-tab="overview">Overview</button>
      <button class="tab-btn" data-tab="reports">Reports</button>
      <button class="tab-btn" data-tab="analytics">Analytics</button>
    `;

    mainContent.appendChild(tabNav);

    const tabContent = document.createElement("div");

    tabContent.innerHTML = `
      <div id="overviewTab" class="tab-content"></div>
      <div id="reportsTab" class="tab-content hidden"></div>
      <div id="analyticsTab" class="tab-content hidden"></div>
    `;

    mainContent.appendChild(tabContent);

    this.renderOverviewTab();

  }

  async renderOverviewTab() {

    const tab = document.getElementById("overviewTab");

    clearElement(tab);

    const statsRow = document.createElement("div");

    statsRow.className = "flex gap-lg flex-wrap";

    statsRow.appendChild(createStatCard("Total Classes", this.classes.length));

    let totalStudents = 0;
    let totalSessions = 0;

    for (const cls of this.classes) {

      const students = await getStudentsByClass(cls.id);
      const sessions = await getSessionsByClass(cls.id);

      totalStudents += students.length;
      totalSessions += sessions.length;

    }

    statsRow.appendChild(createStatCard("Total Students", totalStudents));
    statsRow.appendChild(createStatCard("Total Sessions", totalSessions));

    tab.appendChild(statsRow);

    const infoCard = createCard(
      "Information",
      "This dashboard provides read-only access to attendance data. Use Reports or Analytics to view details."
    );

    tab.appendChild(infoCard);

  }

  async renderReportsTab() {

    const tab = document.getElementById("reportsTab");

    clearElement(tab);

    const header = document.createElement("div");

    header.className = "flex-between mb-lg";

    header.innerHTML = `
      <h2>Attendance Reports</h2>
      <button id="printReportBtn" class="btn btn-secondary">Print</button>
    `;

    tab.appendChild(header);

    const classSelect = createSelect(
      [
        { label: "Select Class...", value: "" },
        ...this.classes.map(c => ({ label: c.name, value: c.id }))
      ],
      "reportClassSelect"
    );

    tab.appendChild(classSelect);

    const reportsContainer = document.createElement("div");
    reportsContainer.id = "reportsContainer";

    tab.appendChild(reportsContainer);

    classSelect.addEventListener("change", async (e) => {

      const classId = e.target.value;

      if (!classId) return;

      await this.loadAndRenderReports(classId, reportsContainer);

    });

    document
      .getElementById("printReportBtn")
      .addEventListener("click", () => triggerPrint());

  }

  async loadAndRenderReports(classId, container) {

    clearElement(container);

    const sessions = await getSessionsByClass(classId);

    if (!sessions.length) {

      container.innerHTML = "<p>No sessions recorded</p>";
      return;

    }

    for (const session of sessions) {

      const card = await this.createReportCard(session);
      container.appendChild(card);

    }

  }

  async createReportCard(session) {

    const card = document.createElement("div");

    card.className = "card mb-lg";

    const attendance = await getAttendanceBySession(session.id);
    const students = await getStudentsByClass(session.classId);

    const present = attendance.filter(a => a.status === "present").length;
    const absent = attendance.filter(a => a.status === "absent").length;

    const header = document.createElement("h3");
    header.textContent = `Session - ${formatDate(session.date)}`;

    card.appendChild(header);

    const summary = document.createElement("div");

    summary.innerHTML = `
      <p><strong>Present:</strong> ${present}</p>
      <p><strong>Absent:</strong> ${absent}</p>
      <p><strong>Total:</strong> ${attendance.length}</p>
    `;

    card.appendChild(summary);

    const rows = attendance.map(record => {

      const student = students.find(s => s.id === record.studentId);

      return {
        Student: student ? student.name : "Unknown",
        Status: record.status === "present" ? "Present" : "Absent"
      };

    });

    const table = createTable(["Student", "Status"], rows);

    card.appendChild(table);

    return card;

  }

  async renderAnalyticsTab() {
    const tab = document.getElementById("analyticsTab");
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
        ...this.classes.map(c => ({ label: c.name, value: c.id }))],
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
    const printBtn = createButton('Print Report', () => triggerPrint());
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

document.addEventListener("DOMContentLoaded", () => {

  const dashboard = new LeaderDashboard();
  dashboard.init();

});