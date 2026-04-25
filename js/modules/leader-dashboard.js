// Leader Dashboard Module
// Read-only access to attendance reports and class information

import {
  getClasses,
  getStudentsByClass,
  getSessionsByClass,
  getAttendanceBySession,
} from './firestore.js';

import { AuthService } from './auth.js';

import {
  clearElement,
  showNotification,
  formatDate,
  createTable,
  createCard,
  createStatCard,
  createSelect,
  triggerPrint
} from './ui-utils.js';

// BUG FIX (refactor): shared analytics rendering
import { renderAnalyticsTab } from './analytics-utils.js';

export class LeaderDashboard {

  constructor() {
    this.currentUser = null;
    this.classes = [];
    this.quoteIntervalRef = { current: null };
    this.currentTab = 'overview';
    this.eventListenersInitialized = false;
  }

  async init() {
    const isLocal = typeof window !== 'undefined' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

    if (isLocal) {
      this.currentUser = AuthService.getCurrentUser();
      try {
        await this.loadClasses();
      } catch (error) {
        console.warn('Leader local-mode data load failed:', error);
      }
      this.renderDashboard();
      this.setupEventListeners();
      return;
    }

    AuthService.onAuthStateChanged(async (user) => {

      if (!user) {
        window.location.href = '../index.html';
        return;
      }

      const allowed = await AuthService.requireRole('leader');
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
      showNotification('Failed to load classes', 'error');
    }
  }

  setupEventListeners() {
    if (this.eventListenersInitialized) return;
    this.eventListenersInitialized = true;

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await AuthService.logout();
        window.location.href = '../index.html';
      });
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab, e));
    });

    const navLinks = document.querySelectorAll('.nav-link');
    const mapHashToTab = (hash) => {
      if (!hash) return '';
      const map = { overview: 'overview', reports: 'reports', analytics: 'analytics' };
      return map[hash.replace('#', '')] || hash.replace('#', '');
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
        try { history.replaceState(null, '', link.getAttribute('href') || ''); } catch (_) {}
      });
    });

    window.addEventListener('hashchange', () => {
      const tabName = mapHashToTab(location.hash);
      if (!tabName) return;
      const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
      if (btn) btn.click();
      else this.switchTab(tabName, null);
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
    if (this.currentTab === tabName) return;
    this.currentTab = tabName;

    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

    const selectedTab = document.getElementById(`${tabName}Tab`);
    if (selectedTab) selectedTab.classList.remove('hidden');

    // BUG FIX: event is null when navigating via sidebar links or hash changes.
    // Guard before accessing event.target to prevent an uncaught TypeError.
    if (event && event.target) event.target.classList.add('active');

    if (tabName === 'reports')   this.renderReportsTab();
    if (tabName === 'analytics') this.renderAnalyticsTab();
  }

  renderDashboard() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) { console.error('Main content container not found'); return; }

    clearElement(mainContent);

    const header = document.createElement('div');
    header.className = 'flex-between mb-xl';
    header.innerHTML = `
      <div>
        <h1>Leader Dashboard</h1>
        <p class="text-muted">Read-only attendance reports</p>
      </div>
      <button id="logoutBtn" class="btn btn-secondary">Logout</button>
    `;
    mainContent.appendChild(header);

    const tabNav = document.createElement('div');
    tabNav.className = 'tab-navigation mb-lg';
    tabNav.innerHTML = `
      <button class="tab-btn active" data-tab="overview">Overview</button>
      <button class="tab-btn" data-tab="reports">Reports</button>
      <button class="tab-btn" data-tab="analytics">Analytics</button>
    `;
    mainContent.appendChild(tabNav);

    const tabContent = document.createElement('div');
    tabContent.innerHTML = `
      <div id="overviewTab"   class="tab-content"></div>
      <div id="reportsTab"    class="tab-content hidden"></div>
      <div id="analyticsTab"  class="tab-content hidden"></div>
    `;
    mainContent.appendChild(tabContent);

    this.renderOverviewTab();
  }

  async renderOverviewTab() {
    const tab = document.getElementById('overviewTab');
    clearElement(tab);

    const statsRow = document.createElement('div');
    statsRow.className = 'flex gap-lg flex-wrap';
    statsRow.appendChild(createStatCard('Total Classes', this.classes.length));

    let totalStudents = 0;
    let totalSessions = 0;

    for (const cls of this.classes) {
      const [students, sessions] = await Promise.all([
        getStudentsByClass(cls.id),
        getSessionsByClass(cls.id)
      ]);
      totalStudents += students.length;
      totalSessions += sessions.length;
    }

    statsRow.appendChild(createStatCard('Total Students', totalStudents));
    statsRow.appendChild(createStatCard('Total Sessions', totalSessions));
    tab.appendChild(statsRow);

    tab.appendChild(createCard(
      'Information',
      'This dashboard provides read-only access to attendance data. Use Reports or Analytics to view details.'
    ));
  }

  async renderReportsTab() {
    const tab = document.getElementById('reportsTab');
    clearElement(tab);

    const header = document.createElement('div');
    header.className = 'flex-between mb-lg';
    header.innerHTML = `
      <h2>Attendance Reports</h2>
      <button id="printReportBtn" class="btn btn-secondary">Print</button>
    `;
    tab.appendChild(header);

    const classSelect = createSelect(
      [{ label: 'Select Class...', value: '' }, ...this.classes.map(c => ({ label: c.name, value: c.id }))],
      'reportClassSelect'
    );
    tab.appendChild(classSelect);

    const reportsContainer = document.createElement('div');
    reportsContainer.id = 'reportsContainer';
    tab.appendChild(reportsContainer);

    classSelect.addEventListener('change', async (e) => {
      const classId = e.target.value;
      if (!classId) return;
      await this.loadAndRenderReports(classId, reportsContainer);
    });

    document.getElementById('printReportBtn').addEventListener('click', () => triggerPrint());
  }

  async loadAndRenderReports(classId, container) {
    clearElement(container);
    const sessions = await getSessionsByClass(classId);

    if (!sessions.length) {
      container.innerHTML = '<p class="text-muted">No sessions recorded.</p>';
      return;
    }

    for (const session of sessions) {
      const card = await this.createReportCard(session);
      container.appendChild(card);
    }
  }

  async createReportCard(session) {
    const card = document.createElement('div');
    card.className = 'card mb-lg';

    const [attendance, students] = await Promise.all([
      getAttendanceBySession(session.id),
      getStudentsByClass(session.classId)
    ]);

    const present = attendance.filter(a => a.status === 'present').length;
    const absent  = attendance.filter(a => a.status === 'absent').length;

    const header = document.createElement('h3');
    header.textContent = `Session — ${formatDate(session.date)}`;
    card.appendChild(header);

    const summary = document.createElement('div');
    summary.innerHTML = `
      <p><strong>Present:</strong> ${present}</p>
      <p><strong>Absent:</strong>  ${absent}</p>
      <p><strong>Total:</strong>   ${attendance.length}</p>
    `;
    card.appendChild(summary);

    const rows = attendance.map(record => {
      const student = students.find(s => s.id === record.studentId);
      return {
        Student: student ? student.name : 'Unknown',
        Status:  record.status === 'present' ? 'Present' : 'Absent'
      };
    });

    card.appendChild(createTable(['Student', 'Status'], rows));
    return card;
  }

  // BUG FIX (refactor): delegates to shared renderAnalyticsTab from analytics-utils.js
  async renderAnalyticsTab() {
    const tab = document.getElementById('analyticsTab');
    await renderAnalyticsTab(tab, this.classes, { quoteIntervalRef: this.quoteIntervalRef });
  }
}
