// Leader Dashboard Module
// Read-only access to attendance reports and class information

import {
  getClasses,
  getStudentsByClass,
  getSessionsByClass,
  getAttendanceBySession,
  calculateAttendanceStats
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

export class LeaderDashboard {

  constructor() {
    this.currentUser = null;
    this.classes = [];
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

    const header = document.createElement("div");

    header.innerHTML = `
      <h2>Attendance Analytics</h2>
      <button id="printAnalyticsBtn" class="btn btn-secondary">Print</button>
    `;

    tab.appendChild(header);

    const classSelect = createSelect(
      [
        { label: "Select Class...", value: "" },
        ...this.classes.map(c => ({ label: c.name, value: c.id }))
      ],
      "analyticsClassSelect"
    );

    tab.appendChild(classSelect);

    const analyticsContainer = document.createElement("div");

    tab.appendChild(analyticsContainer);

    classSelect.addEventListener("change", async (e) => {

      const classId = e.target.value;

      if (!classId) return;

      await this.loadAnalytics(classId, analyticsContainer);

    });

    document
      .getElementById("printAnalyticsBtn")
      .addEventListener("click", () => triggerPrint());

  }

  async loadAnalytics(classId, container) {

    clearElement(container);

    const stats = await calculateAttendanceStats(classId);

    const statRow = document.createElement("div");

    statRow.className = "flex gap-lg flex-wrap";

    statRow.appendChild(createStatCard("Students", stats.totalStudents));
    statRow.appendChild(createStatCard("Sessions", stats.totalSessions));

    const studentStatsArray = Object.values(stats.studentStats);

    const avg =
      studentStatsArray.length
        ? studentStatsArray.reduce((sum, s) => sum + s.attendanceRate, 0) /
          studentStatsArray.length
        : 0;

    statRow.appendChild(
      createStatCard("Average Attendance %", Math.round(avg))
    );

    container.appendChild(statRow);

    const rows = studentStatsArray.map(stat => ({
      Student: stat.name,
      Present: stat.present,
      Absent: stat.absent,
      Total: stat.total,
      "Attendance %": `${stat.attendanceRate}%`
    }));

    const table = createTable(
      ["Student", "Present", "Absent", "Total", "Attendance %"],
      rows
    );

    container.appendChild(table);

  }
}

document.addEventListener("DOMContentLoaded", () => {

  const dashboard = new LeaderDashboard();
  dashboard.init();

});