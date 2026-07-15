// Leader Dashboard Module
// Read-only access to attendance reports and class information

import {
  getClasses,
  getStudentsByClass,
  getSessionsByClass,
  getAttendanceBySession,
  calculateGraduationStats,
  getUserData,
  getGatheringPlaceStats
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
  triggerPrint,
  createStatsSkeleton,
  createTableSkeleton
} from './ui-utils.js';

// BUG FIX (refactor): shared analytics rendering
import { renderAnalyticsTab, createMotivationCard } from './analytics-utils.js';
import { renderGraduationTab } from './graduation-utils.js';
import { createTabSkeleton } from './ui-utils.js';
import { createClassesSkeleton, createReportsSkeleton, createAnalyticsSkeleton, createGraduandsSkeleton } from './ui-utils.js';
import { renderSettingsTab as renderSharedSettingsTab } from './shared-settings.js';
import { showClassParticipantsModal } from './class-participants.js';

export class LeaderDashboard {

  constructor() {
    this.currentUser = null;
    this.userData = null;
    this.classes = [];
    this.quoteIntervalRef = { current: null };
    this.isDemoMode = false;
    this.isLoading = true;
    this.currentTab = 'overview';
    this.eventListenersInitialized = false;
    this.mobileNavInitialized = false;
  }

  async init() {
    const isLocal = typeof window !== 'undefined' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

    if (isLocal) {
      this.isDemoMode = true;
      this.currentUser = AuthService.getCurrentUser();
      this.userData = {
        name: this.currentUser?.displayName || 'Local Leader',
        email: this.currentUser?.email || 'leader@example.test',
        role: 'leader',
        phoneNumber: '',
        address: ''
      };
      this.renderDashboard();
      this.attachFreshEventListeners();
      try {
        await this.loadClasses();
      } catch (error) {
        console.warn('Leader local-mode data load failed:', error);
      } finally {
        this.isLoading = false;
        this.renderDashboard();
        this.attachFreshEventListeners();
      }
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
      this.isLoading = true;
      this.renderDashboard();
      this.attachFreshEventListeners();
      try {
        await this.loadUserData();
        await this.loadClasses();
      } finally {
        this.isLoading = false;
        this.renderDashboard();
        this.attachFreshEventListeners();
      }
    });
  }

  attachFreshEventListeners() {
    this.eventListenersInitialized = false;
    this.setupEventListeners();
  }

  async loadClasses() {
    try {
      this.classes = await getClasses();
    } catch (error) {
      console.error(error);
      showNotification('Failed to load classes', 'error');
    }
  }

  async showClassParticipants(classRecord) {
    try {
      const students = await getStudentsByClass(classRecord.id);
      showClassParticipantsModal(classRecord, students, {
        note: 'Read-only view for leaders.'
      });
    } catch (error) {
      console.error('Failed to load class participants:', error);
      showNotification('Failed to load class participants', 'error');
    }
  }

  setupEventListeners() {
    if (this.eventListenersInitialized) return;
    this.eventListenersInitialized = true;

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await AuthService.logout();
    });

    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const tabName = link.dataset.tab;
        if (!tabName) return;
        this.switchTab(tabName, null);
        try { history.replaceState(null, '', link.getAttribute('href') || `#${tabName}`); } catch (_) {}
      });
    });

    window.addEventListener('hashchange', () => {
      const hash = location.hash.replace('#', '');
      const map = { overview: 'overview', classes: 'classes', reports: 'reports', analytics: 'analytics', graduation: 'graduation', graduands: 'graduands', settings: 'settings' };
      const tabName = map[hash] || hash;
      if (tabName) this.switchTab(tabName, null);
    });

    const initialTab = this.getTabFromHash(location.hash);
    if (initialTab) this.switchTab(initialTab, null);
  }

  getTabFromHash(hashValue = '') {
    const key = (hashValue || '').replace('#', '');
    const map = {
      overview: 'overview',
      classes: 'classes',
      reports: 'reports',
      analytics: 'analytics',
      graduation: 'graduation',
      graduands: 'graduands',
      settings: 'settings'
    };
    return map[key] || '';
  }

  switchTab(tabName, event) {
    if (this.currentTab === tabName) return;
    this.currentTab = tabName;

    document.querySelectorAll('.nav-link').forEach(b => {
      if (b.dataset.tab === tabName) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });

    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));

    const targetTabEl = document.getElementById(`${tabName}Tab`);
    if (targetTabEl) {
      clearElement(targetTabEl);
      let skeletonEl = createTabSkeleton();
      if (tabName === 'classes') skeletonEl = createClassesSkeleton();
      if (tabName === 'reports') skeletonEl = createReportsSkeleton();
      if (tabName === 'analytics') skeletonEl = createAnalyticsSkeleton();
      if (tabName === 'settings') skeletonEl = createTabSkeleton({ statsCount: 1, tableRows: 3, tableColumns: 2, showQuote: false });
      if (tabName === 'graduation') skeletonEl = null;
      if (tabName === 'graduands') skeletonEl = createGraduandsSkeleton();
      if (skeletonEl) targetTabEl.appendChild(skeletonEl);
      targetTabEl.classList.remove('hidden');
    }

    if (tabName === 'classes') this.renderClassesTab();
    if (tabName === 'reports')   this.renderReportsTab();
    if (tabName === 'analytics') this.renderAnalyticsTab();
    if (tabName === 'settings') this.renderSettingsTab();
    if (tabName === 'graduation') this.renderGraduationTab();
    if (tabName === 'graduands') this.renderGraduandsTab();
  }

  async renderClassesTab() {
    const tab = document.getElementById('classesTab');
    clearElement(tab);

    const header = document.createElement('div');
    header.className = 'flex-between mb-lg';
    header.innerHTML = `
      <div>
        <h2>Classes</h2>
        <p class="text-muted">View participants assigned to each class.</p>
      </div>
    `;
    tab.appendChild(header);

    if (this.isLoading) {
      tab.appendChild(createTableSkeleton(5, 3));
      return;
    }

    if (!this.classes.length) {
      const empty = document.createElement('p');
      empty.className = 'text-muted';
      empty.textContent = 'No classes available.';
      tab.appendChild(empty);
      return;
    }

    const participantCounts = Object.fromEntries(await Promise.all(
      this.classes.map(async classRecord => {
        try {
          const students = await getStudentsByClass(classRecord.id);
          return [classRecord.id, students.length];
        } catch (error) {
          console.error('Failed to count class participants:', classRecord.id, error);
          return [classRecord.id, '—'];
        }
      })
    ));

    const rows = this.classes.map(classRecord => ({
      'Class Name': classRecord.name,
      'Participants': participantCounts[classRecord.id] ?? '—',
      'Actions': () => {
        const viewBtn = createButton('View Participants', async () => {
          viewBtn.disabled = true;
          try {
            await this.showClassParticipants(classRecord);
          } finally {
            viewBtn.disabled = false;
          }
        }, { className: 'btn-primary btn-small' });
        return viewBtn;
      }
    }));

    tab.appendChild(createTable(['Class Name', 'Participants', 'Actions'], rows));
  }

  async renderGraduandsTab() {
    const tab = document.getElementById('graduandsTab');
    clearElement(tab);

    const container = document.createElement('div');
    container.className = 'analytics-container';

    const heading = document.createElement('div');
    heading.className = 'flex-between mb-lg';
    heading.innerHTML = `
      <div>
        <h2>Potential Graduands</h2>
        <p class="text-muted">List of students likely to graduate, across all classes. Leaders can filter by class.</p>
      </div>
    `;
    container.appendChild(heading);

    const controls = document.createElement('div');
    controls.className = 'flex gap-md mb-lg';

    const classOptions = [
      { label: 'All Classes', value: '' },
      ...this.classes.map(c => ({ label: c.name, value: c.id }))
    ];

    const classSelect = createSelect(classOptions, 'graduandsClassSelect', '');
    controls.append(classSelect);
    container.appendChild(controls);

    const resultsContainer = document.createElement('div');
    resultsContainer.id = 'graduandsResults';
    container.appendChild(resultsContainer);

    const potentialThreshold = 70;

    const loadAndRender = async () => {
      clearElement(resultsContainer);
      resultsContainer.appendChild(createTableSkeleton(4, 2));

      let targets = this.classes;
      if (!targets || targets.length === 0) {
        resultsContainer.innerHTML = '<p class="text-muted">No classes available.</p>';
        return;
      }

      try {
        const statsList = await Promise.all(targets.map(cls => calculateGraduationStats(cls.id)));

        const potentials = [];
        for (const stats of statsList) {
          if (!stats || !stats.studentGraduationStats) continue;
          for (const s of Object.values(stats.studentGraduationStats)) {
            if (s.graduationRate >= potentialThreshold) {
              potentials.push({ name: s.name, className: stats.className });
            }
          }
        }

        const filterClass = classSelect.value;
        const filtered = filterClass ? potentials.filter(p => p.className && this.classes.find(c => c.id === filterClass)?.name === p.className) : potentials;

        if (filtered.length === 0) {
          resultsContainer.innerHTML = '<p class="text-muted">No potential graduands found.</p>';
          return;
        }

        const rows = filtered.map(p => ({ 'Student': p.name, 'Class': p.className }));
        resultsContainer.appendChild(createTable(['Student', 'Class'], rows));
      } catch (err) {
        console.error('Failed to load potential graduands:', err);
        resultsContainer.innerHTML = '<p class="text-danger">Unable to load potential graduands right now.</p>';
      }
    };

    classSelect.addEventListener('change', loadAndRender);

    await loadAndRender();

    tab.appendChild(container);
  }

  renderDashboard() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) { console.error('Main content container not found'); return; }

    clearElement(mainContent);

    const tabContent = document.createElement('div');
    tabContent.innerHTML = `
      <div id="overviewTab" class="tab-content"></div>
      <div id="classesTab" class="tab-content hidden"></div>
      <div id="reportsTab" class="tab-content hidden"></div>
      <div id="analyticsTab" class="tab-content hidden"></div>
      <div id="graduationTab" class="tab-content hidden"></div>
      <div id="graduandsTab" class="tab-content hidden"></div>
      <div id="settingsTab" class="tab-content hidden"></div>
    `;
    mainContent.appendChild(tabContent);

    this.renderOverviewTab();
  }

  async renderOverviewTab() {
    const tab = document.getElementById('overviewTab');
    clearElement(tab);

    if (this.isLoading) {
      tab.appendChild(createStatsSkeleton(3));
      return;
    }

    const statsRow = document.createElement('div');
    statsRow.className = 'flex gap-lg flex-wrap mb-lg';
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

    const quoteCard = createMotivationCard();
    quoteCard.classList.add('mb-lg');
    tab.appendChild(quoteCard);

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
      <div>
        <h2>Program-wide Attendance Report</h2>
        <p class="text-muted">A consolidated overview of attendance across all classes for leaders and coordinators.</p>
      </div>
      <button id="printReportBtn" class="btn btn-secondary">Print</button>
    `;
    tab.appendChild(header);

    const reportsContainer = document.createElement('div');
    reportsContainer.id = 'reportsContainer';
    reportsContainer.className = 'analytics-container';
    tab.appendChild(reportsContainer);

    if (this.isLoading) {
      reportsContainer.appendChild(createTableSkeleton(5, 2));
      return;
    }

    const printButton = document.getElementById('printReportBtn');
    printButton?.addEventListener('click', () => triggerPrint());

    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'stats-grid mb-lg';
    reportsContainer.appendChild(summaryGrid);

    const breakdownCard = document.createElement('div');
    breakdownCard.className = 'card';
    const breakdownHeader = document.createElement('div');
    breakdownHeader.className = 'card-header';
    breakdownHeader.textContent = 'Attendance Summary by Class';
    breakdownCard.appendChild(breakdownHeader);

    const body = document.createElement('div');
    body.className = 'card-body';
    breakdownCard.appendChild(body);
    reportsContainer.appendChild(breakdownCard);

    const renderSummary = (summaryData = {}) => {
      clearElement(summaryGrid);
      const cards = [
        { label: 'Total Classes', value: summaryData.totalClasses ?? this.classes.length },
        { label: 'Total Students', value: summaryData.totalStudents ?? 0 },
        { label: 'Total Attendance Records', value: summaryData.totalRecords ?? 0 },
        { label: 'Overall Attendance Rate', value: `${summaryData.overallRate ?? 0}%` },
        { label: 'Present Records', value: summaryData.presentRecords ?? 0 },
        { label: 'Absent Records', value: summaryData.absentRecords ?? 0 },
        { label: 'Total Sessions', value: summaryData.totalSessions ?? 0 }
      ];

      cards.forEach(({ label, value }) => summaryGrid.appendChild(createStatCard(label, value)));
    };

    const renderBreakdown = (classSummaries = []) => {
      clearElement(body);
      body.appendChild(createTable(
        ['Class', 'Students', 'Sessions', 'Overall Rate', 'Latest Session Rate'],
        classSummaries.map(item => ({
          Class: item.className,
          Students: item.totalStudents,
          Sessions: item.totalSessions,
          'Overall Rate': `${item.overallRate}%`,
          'Latest Session Rate': `${item.latestRate}%`
        }))
      ));
    };

    try {
      const classSummaries = await Promise.all(this.classes.map(async (classRecord) => {
        const [students, sessions] = await Promise.all([
          getStudentsByClass(classRecord.id),
          getSessionsByClass(classRecord.id)
        ]);

        if (!sessions.length) {
          return {
            className: classRecord.name,
            totalStudents: students.length,
            totalSessions: 0,
            overallRate: 0,
            latestRate: 0
          };
        }

        const latestSession = [...sessions].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
        const latestAttendance = latestSession ? await getAttendanceBySession(latestSession.id) : [];
        const latestPresent = latestAttendance.filter(record => record.status === 'present').length;
        const latestTotal = latestAttendance.length;
        const latestRate = latestTotal === 0 ? 0 : Math.round((latestPresent / latestTotal) * 100);

        const attendanceResults = await Promise.all(sessions.map(session => getAttendanceBySession(session.id)));
        const combinedRecords = attendanceResults.flat();
        const present = combinedRecords.filter(record => record.status === 'present').length;
        const totalRecords = combinedRecords.length;
        const overallRate = totalRecords === 0 ? 0 : Math.round((present / totalRecords) * 100);

        return {
          className: classRecord.name,
          totalStudents: students.length,
          totalSessions: sessions.length,
          overallRate,
          latestRate,
          totalRecords,
          presentRecords: present,
          absentRecords: totalRecords - present
        };
      }));

      const totalStudents = classSummaries.reduce((sum, item) => sum + (item.totalStudents || 0), 0);
      const totalSessions = classSummaries.reduce((sum, item) => sum + (item.totalSessions || 0), 0);
      const totalRecords = classSummaries.reduce((sum, item) => sum + (item.totalRecords || 0), 0);
      const presentRecords = classSummaries.reduce((sum, item) => sum + (item.presentRecords || 0), 0);
      const absentRecords = classSummaries.reduce((sum, item) => sum + (item.absentRecords || 0), 0);
      const overallRate = totalRecords === 0 ? 0 : Math.round((presentRecords / totalRecords) * 100);
      const latestSessionAverage = classSummaries.length === 0
        ? 0
        : Math.round(classSummaries.reduce((sum, item) => sum + (item.latestRate || 0), 0) / classSummaries.length);

      renderSummary({
        totalClasses: this.classes.length,
        totalStudents,
        totalSessions,
        totalRecords,
        presentRecords,
        absentRecords,
        overallRate,
        latestSessionAverage
      });
      renderBreakdown(classSummaries.map(item => ({
        className: item.className,
        totalStudents: item.totalStudents,
        totalSessions: item.totalSessions,
        overallRate: item.overallRate,
        latestRate: item.latestRate
      })));
    } catch (error) {
      console.error('Failed to load consolidated leader reports:', error);
      renderSummary();
      renderBreakdown();
      body.innerHTML = '<p class="text-muted">No attendance data available yet.</p>';
    }
  }

  // BUG FIX (refactor): delegates to shared renderAnalyticsTab from analytics-utils.js
  async renderAnalyticsTab() {
    const tab = document.getElementById('analyticsTab');
    await renderAnalyticsTab(tab, this.classes, {
      quoteIntervalRef: this.quoteIntervalRef,
      requireAuth: true,
      isDemoMode: this.isDemoMode,
      emptyStateMessage: 'Attendance analytics is available after signing in as an authenticated leader.'
    });
  }

  async renderGraduationTab() {
    const tab = document.getElementById('graduationTab');
    await renderGraduationTab(tab, this.classes, {
      requireAuth: true,
      isDemoMode: this.isDemoMode,
      leaderView: true,
      potentialThreshold: 70,
      emptyStateMessage: 'Graduation readiness is available after signing in as an authenticated leader.'
    });
  }

  async loadUserData() {
    if (!this.currentUser?.uid) return;
    try {
      const profile = await getUserData(this.currentUser.uid);
      this.userData = profile || {
        name: this.currentUser.displayName || '',
        email: this.currentUser.email || '',
        role: 'leader',
        phoneNumber: '',
        address: ''
      };
    } catch (error) {
      console.warn('Failed to load leader profile data:', error);
      this.userData = {
        name: this.currentUser?.displayName || '',
        email: this.currentUser?.email || '',
        role: 'leader',
        phoneNumber: '',
        address: ''
      };
    }
  }

  async renderSettingsTab() {
    const tab = document.getElementById('settingsTab');
    await renderSharedSettingsTab(tab, {
      currentUser: this.currentUser,
      profile: this.userData,
      isLoading: this.isLoading,
      isDemoMode: this.isDemoMode,
      onProfileUpdated: (profile) => {
        this.userData = profile;
      }
    });
  }
}
