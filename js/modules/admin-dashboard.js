// Admin Dashboard Module
// FIX Bug 2: duplicate auth listener at the bottom of the original file removed.

import {
  initializeClasses, getClasses, getAllUsers, createClass,
  updateClassLockStatus, updateClassInstructor, deleteUser, addStudent, getStudents, getStudentsByClass,
  deleteStudent, getUserData, createSession, getGatheringPlaceStats,
  getSessionsByClass, getAttendanceBySession, deleteAttendanceSession, getGeneralSessions, updateStudent,
  ensureGeneralClasses, bulkAssignStudentsToClass, bulkRemoveStudentsFromClass, updateUser,
  studentHasClass, getStudentMembershipType, deleteClass
} from './firestore.js';
import { AuthService } from './auth.js';
import { auth, db, firebaseConfig } from '../firebase-config.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signOut as signOutSecondaryAuth, updateEmail as updateAuthEmail } from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js';
import { doc, setDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";
import {
  clearElement, showNotification, createTable, createCard,
  createStatCard, createButton, createInput, createSelect,
  createModal, createStatsSkeleton, createTableSkeleton, createTabSkeleton
} from './ui-utils.js';
import { createClassesSkeleton, createUsersSkeleton, createStudentsSkeleton, createAttendanceSkeleton, createAnalyticsSkeleton, createGraduationSkeleton } from './ui-utils.js';
import { formatDate } from './ui-utils.js';
import { renderAnalyticsTab, createMotivationCard } from './analytics-utils.js';
import { renderGraduationTab } from './graduation-utils.js';
import { showClassParticipantsModal } from './class-participants.js';

export class AdminDashboard {
  constructor() {
    this.currentUser = null;
    this.classes = [];
    this.users = [];
    this.students = [];
    this.isDemoMode = false;
    this.isLoading = true;
    this.currentTab = 'overview';
    this.currentUserProfile = null;
    this.eventListenersInitialized = false;
    this.dropdownHandlerInitialized = false;
    this.isDashboardMenuOpen = true;
    this.isSidebarCollapsed = false;
    this._fetchingUserIds = new Set();
    this.manageSelectedClassId = '';
    this.manageTargetClassId = '';
    this.manageGeneralTargetClassId = '';
    this.manageSelectedStudentIds = new Set();
    this.studentsFilterClassId = '';
    this.studentsSearchTerm = '';
  }

  async init() {
    const isLocal = typeof window !== 'undefined' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

    if (isLocal) {
      this.isDemoMode = true;
      this.currentUser = AuthService.getCurrentUser();
      this.renderDashboard();
      this.attachFreshEventListeners();
      this.initializeDropdownHandler();
      try {
        await this.loadCurrentUserProfile();
        await this.loadClasses();
        await this.loadUsers();
        await this.loadStudents();
      } catch (error) {
        console.warn('Admin local-mode data load failed:', error);
      } finally {
        this.isLoading = false;
        this.renderDashboard();
        this.attachFreshEventListeners();
      }
      return;
    }

    // FIX Bug 2: ONE listener only — stray outer AuthService.onAuthStateChanged
    // that existed at the bottom of the original file has been removed.
    AuthService.onAuthStateChanged(async (user) => {
      if (!user) { window.location.href = '../index.html'; return; }
      try {
        const role = await getUserData(user.uid).then(u => u?.role).catch(() => null);
        console.debug('Admin init auth state:', { uid: user.uid, role });
      } catch (e) {}

      const allowed = await AuthService.requireRole('admin');
      if (!allowed) return;
      this.currentUser = user;
      try {
        this.isLoading = true;
        this.renderDashboard();
        this.attachFreshEventListeners();
        this.initializeDropdownHandler();
        await initializeClasses();
        await this.loadCurrentUserProfile();
        await this.loadClasses();
        await this.loadUsers();
        await this.loadStudents();
      } catch (error) {
        console.error('Admin initialization failed:', error);
        showNotification('Failed to initialize admin dashboard', 'error');
      } finally {
        this.isLoading = false;
        this.renderDashboard();
        this.attachFreshEventListeners();
      }
    });
  }

  attachFreshEventListeners() {
    this.setupEventListeners();
  }

  initializeDropdownHandler() {
    if (this.dropdownHandlerInitialized) return;
    this.dropdownHandlerInitialized = true;

    const handleOutsideInteraction = (event) => {
      const dashboardItem = document.querySelector('.nav-item-dashboard');
      if (!dashboardItem) return;

      const isClickInside = dashboardItem.contains(event.target);
      if (!isClickInside) {
        this.setDashboardMenuOpen(false);
      }
    };

    const handleFocusOutside = (event) => {
      const dashboardItem = document.querySelector('.nav-item-dashboard');
      if (!dashboardItem) return;

      if (!dashboardItem.contains(event.target)) {
        this.setDashboardMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;

      const dashboardItem = document.querySelector('.nav-item-dashboard');
      if (!dashboardItem || !dashboardItem.contains(document.activeElement)) return;

      this.setDashboardMenuOpen(false);
      document.getElementById('dashboardNavToggle')?.focus();
    };

    document.addEventListener('click', handleOutsideInteraction, true);
    document.addEventListener('focusin', handleFocusOutside);
    document.addEventListener('keydown', handleEscape);
  }

  async loadClasses() {
    try { this.classes = await getClasses(); }
    catch (e) { console.error(e); showNotification('Failed to load classes', 'error'); }
  }
  async loadUsers() {
    try {
      this.users = await getAllUsers();
      if (this.currentUser?.uid) {
        this.currentUserProfile = this.users.find(user => user.id === this.currentUser.uid) || this.currentUserProfile;
      }
    }
    catch (e) { console.error(e); }
  }
  async loadStudents() {
    try { this.students = await getStudents(); }
    catch (e) { console.error(e); }
  }

  async loadCurrentUserProfile() {
    if (!this.currentUser?.uid) {
      this.currentUserProfile = null;
      return;
    }

    if (this.isDemoMode) {
      this.currentUserProfile = {
        id: this.currentUser.uid,
        name: this.currentUser.displayName || 'Local Admin',
        email: this.currentUser.email || 'admin@example.test',
        role: 'admin',
        phoneNumber: '',
        address: ''
      };
      return;
    }

    try {
      this.currentUserProfile = await getUserData(this.currentUser.uid);
    } catch (error) {
      console.error('Failed to load current user profile', error);
    }
  }

  isDashboardTab(tabName) {
    return ['overview', 'classes', 'graduation', 'students'].includes(tabName);
  }

  getTabFromHash(hashValue = '') {
    const key = (hashValue || '').replace('#', '');
    const map = {
      dashboard: 'overview',
      overview: 'overview',
      classes: 'classes',
      graduation: 'graduation',
      attendance: 'students',
      students: 'students',
      settings: 'settings',
      users: 'users',
      analytics: 'analytics'
    };

    return map[key] || '';
  }

  setDashboardMenuOpen(isOpen) {
    const dashboardToggle = document.getElementById('dashboardNavToggle');
    const dashboardSubmenu = document.getElementById('dashboardSubmenu');
    this.isDashboardMenuOpen = Boolean(isOpen);

    if (dashboardSubmenu) {
      dashboardSubmenu.classList.toggle('hidden', !this.isDashboardMenuOpen);
    }

    if (dashboardToggle) {
      dashboardToggle.setAttribute('aria-expanded', String(this.isDashboardMenuOpen));
      dashboardToggle.classList.toggle('is-expanded', this.isDashboardMenuOpen);
    }
  }

  setSidebarCollapsed(isCollapsed) {
    const shell = document.querySelector('.dashboard-shell');
    const toggle = document.getElementById('sidebarCollapseBtn');
    const icon = toggle?.querySelector('[data-lucide]');
    this.isSidebarCollapsed = Boolean(isCollapsed);

    if (shell) {
      shell.classList.toggle('sidebar-collapsed', this.isSidebarCollapsed);
    }

    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!this.isSidebarCollapsed));
      toggle.setAttribute('aria-label', this.isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
      toggle.title = this.isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
    }

    if (icon) {
      icon.setAttribute('data-lucide', this.isSidebarCollapsed ? 'panel-left-open' : 'panel-left-close');
      window.lucide?.createIcons();
    }

    if (this.isSidebarCollapsed) {
      this.setDashboardMenuOpen(false);
    }

    try {
      localStorage.setItem('adminSidebarCollapsed', this.isSidebarCollapsed ? 'true' : 'false');
    } catch (_) {}
  }

  syncSidebarNavigation(activeTab = this.currentTab) {
    const dashboardToggle = document.getElementById('dashboardNavToggle');
    const submenuLinks = document.querySelectorAll('.nav-sublink[data-tab]');
    const directLinks = document.querySelectorAll('.nav-link[data-tab]');
    const dashboardTabActive = this.isDashboardTab(activeTab);

    submenuLinks.forEach(link => {
      link.classList.toggle('active', link.dataset.tab === activeTab);
    });

    directLinks.forEach(link => {
      link.classList.toggle('active', !dashboardTabActive && link.dataset.tab === activeTab);
    });

    if (dashboardToggle) {
      dashboardToggle.classList.toggle('active', dashboardTabActive);
    }

    if (dashboardTabActive && !this.isSidebarCollapsed) {
      this.setDashboardMenuOpen(true);
    }
  }

  getClassRecordById(classId) {
    return this.classes.find(cls => cls.id === classId) || null;
  }

  getClassName(classId, fallback = 'Unassigned') {
    return this.getClassRecordById(classId)?.name || fallback;
  }

  getGeneralClasses() {
    return this.classes.filter(classRecord => classRecord?.isGeneralClass);
  }

  getStudentsForClass(classId) {
    return this.students.filter(student => studentHasClass(student, classId));
  }

  getSharedClassNames(student) {
    const sharedClassIds = Array.isArray(student?.sharedClassIds) ? student.sharedClassIds : [];
    if (!sharedClassIds.length) return '—';

    return sharedClassIds
      .map(classId => this.getClassName(classId, 'Unknown class'))
      .join(', ');
  }

  ensureStudentsFilterState() {
    const availableClassIds = new Set(this.classes.map(classRecord => classRecord.id));
    if (this.studentsFilterClassId === '__unassigned__') return;

    if (this.studentsFilterClassId && !availableClassIds.has(this.studentsFilterClassId)) {
      this.studentsFilterClassId = '';
    }
  }

  getFilteredStudents() {
    this.ensureStudentsFilterState();

    let filteredStudents = [...this.students];

    if (this.studentsFilterClassId === '__unassigned__') {
      filteredStudents = filteredStudents.filter(student => !student.classId);
    } else if (this.studentsFilterClassId) {
      filteredStudents = filteredStudents.filter(student => studentHasClass(student, this.studentsFilterClassId));
    }

    const searchTerm = String(this.studentsSearchTerm || '').trim().toLowerCase();
    if (searchTerm) {
      filteredStudents = filteredStudents.filter(student =>
        String(student?.name || '').toLowerCase().includes(searchTerm)
      );
    }

    return filteredStudents.sort((left, right) =>
      String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' })
    );
  }

  ensureManageSelectionState() {
    const availableClassIds = new Set(this.classes.map(classRecord => classRecord.id));

    if (!this.manageSelectedClassId || !availableClassIds.has(this.manageSelectedClassId)) {
      this.manageSelectedClassId = this.classes[0]?.id || '';
    }

    const selectableTargetClasses = this.classes.filter(classRecord => classRecord.id !== this.manageSelectedClassId);
    if (!this.manageTargetClassId || !availableClassIds.has(this.manageTargetClassId) || this.manageTargetClassId === this.manageSelectedClassId) {
      this.manageTargetClassId = selectableTargetClasses[0]?.id || '';
    }

    const generalClasses = this.getGeneralClasses();
    const generalClassIds = new Set(generalClasses.map(classRecord => classRecord.id));
    if (!this.manageGeneralTargetClassId || !generalClassIds.has(this.manageGeneralTargetClassId)) {
      this.manageGeneralTargetClassId = generalClasses[0]?.id || '';
    }

    const visibleStudentIds = new Set(this.getStudentsForClass(this.manageSelectedClassId).map(student => student.id));
    this.manageSelectedStudentIds = new Set(
      [...this.manageSelectedStudentIds].filter(studentId => visibleStudentIds.has(studentId))
    );
  }

  async reloadCoreData() {
    await Promise.all([this.loadClasses(), this.loadStudents()]);
    this.ensureManageSelectionState();
  }

  renderActiveTab() {
    if (this.currentTab === 'classes') { this.renderClassesTab(); return; }
    if (this.currentTab === 'settings') { this.renderSettingsTab(); return; }
    if (this.currentTab === 'users') { this.renderUsersTab(); return; }
    if (this.currentTab === 'students') { this.renderStudentsTab(); return; }
    if (this.currentTab === 'analytics') { this.renderAnalyticsTab(); return; }
    if (this.currentTab === 'graduation') { this.renderGraduationTab(); return; }
    this.renderOverviewTab();
  }

  confirmAction(title, message, options = {}) {
    const {
      confirmText = 'Confirm',
      confirmClassName = 'btn-primary'
    } = options;

    return new Promise(resolve => {
      const content = document.createElement('div');
      content.innerHTML = `<p>${message}</p>`;

      let modal;
      const confirmBtn = createButton(confirmText, () => {
        modal.remove();
        resolve(true);
      }, { className: confirmClassName });
      const cancelBtn = createButton('Cancel', () => {
        modal.remove();
        resolve(false);
      }, { className: 'btn-secondary' });

      modal = createModal(title, content, [confirmBtn, cancelBtn]);
      document.body.appendChild(modal);
    });
  }

  setupEventListeners() {
    if (this.eventListenersInitialized) return;
    this.eventListenersInitialized = true;

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await AuthService.logout();
    });

    document.getElementById('sidebarCollapseBtn')?.addEventListener('click', () => {
      this.setSidebarCollapsed(!this.isSidebarCollapsed);
    });

    document.getElementById('dashboardNavToggle')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const dashboardSubmenu = document.getElementById('dashboardSubmenu');
      const isOpen = dashboardSubmenu ? !dashboardSubmenu.classList.contains('hidden') : false;

      if (this.isSidebarCollapsed) {
        this.setSidebarCollapsed(false);
      }

      this.setDashboardMenuOpen(!isOpen);
    });

    document.querySelectorAll('.nav-sublink[data-tab]').forEach(link => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const tabName = link.dataset.tab;
        if (!tabName) return;
        this.setDashboardMenuOpen(true);
        this.switchTab(tabName, null);
        try { history.replaceState(null, '', link.getAttribute('href') || `#${tabName}`); } catch (_) {}
      });
    });

    document.querySelectorAll('.nav-link[data-tab]').forEach(link => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const tabName = link.dataset.tab;
        if (!tabName) return;
        this.setDashboardMenuOpen(false);
        this.switchTab(tabName, null);
        try { history.replaceState(null, '', link.getAttribute('href') || `#${tabName}`); } catch (_) {}
      });
    });

    window.addEventListener('hashchange', () => {
      const tabName = this.getTabFromHash(location.hash);
      if (!tabName) return;
      if (!this.isDashboardTab(tabName)) {
        this.setDashboardMenuOpen(false);
      }
      this.switchTab(tabName, null);
    });

    try {
      this.setSidebarCollapsed(localStorage.getItem('adminSidebarCollapsed') === 'true');
    } catch (_) {
      this.setSidebarCollapsed(false);
    }

    const initialTab = this.getTabFromHash(location.hash) || 'overview';
    this.switchTab(initialTab, null, { force: true });
  }

  switchTab(tabName, event, options = {}) {
    const { force = false } = options;
    if (!force && this.currentTab === tabName) {
      this.syncSidebarNavigation(tabName);
      return;
    }
    this.currentTab = tabName;
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    const targetTabEl = document.getElementById(`${tabName}Tab`);
    if (targetTabEl) {
      clearElement(targetTabEl);
      let skeletonEl = createTabSkeleton();
      if (tabName === 'classes') skeletonEl = createClassesSkeleton();
      if (tabName === 'settings') skeletonEl = createTabSkeleton({ statsCount: 1, tableRows: 3, tableColumns: 2, showQuote: false });
      if (tabName === 'users') skeletonEl = createUsersSkeleton();
      if (tabName === 'students') skeletonEl = createStudentsSkeleton();
      if (tabName === 'analytics') skeletonEl = createAnalyticsSkeleton();
      if (tabName === 'graduation') skeletonEl = createGraduationSkeleton();
      targetTabEl.appendChild(skeletonEl);
      targetTabEl.classList.remove('hidden');
    }
    this.syncSidebarNavigation(tabName);
    if (tabName === 'classes') this.renderClassesTab();
    if (tabName === 'settings') this.renderSettingsTab();
    if (tabName === 'users') this.renderUsersTab();
    if (tabName === 'students') this.renderStudentsTab();
    if (tabName === 'analytics') this.renderAnalyticsTab();
    if (tabName === 'graduation') this.renderGraduationTab();
    if (tabName === 'overview') this.renderOverviewTab();
  }

  renderDashboard() {
    const main = document.querySelector('.main-content');
    clearElement(main);
    const header = document.createElement('div');
    header.className = 'dashboard-content-header mb-xl';
    header.innerHTML = `
      <div>
        <div class="section-eyebrow">Admin Dashboard</div>
        <h1>GP Attendance Admin</h1>
        <p class="text-muted">Manage gathering place classes, users, analytics, and profile settings from one place.</p>
      </div>`;
    main.appendChild(header);
    const tabs = document.createElement('div');
    tabs.innerHTML = `
      <div id="overviewTab" class="tab-content hidden"></div>
      <div id="classesTab" class="tab-content hidden"></div>
      <div id="settingsTab" class="tab-content hidden"></div>
      <div id="usersTab" class="tab-content hidden"></div>
      <div id="studentsTab" class="tab-content hidden"></div>
      <div id="analyticsTab" class="tab-content hidden"></div>
      <div id="graduationTab" class="tab-content hidden"></div>`;
    main.appendChild(tabs);
    this.switchTab(this.currentTab || 'overview', null, { force: true });
  }

  renderOverviewTab() {
    const tab = document.getElementById('overviewTab'); clearElement(tab);
    if (this.isLoading) {
      tab.appendChild(createStatsSkeleton(3));
      return;
    }
    const stats = document.createElement('div'); stats.className = 'flex gap-lg flex-wrap mb-lg';
    stats.appendChild(createStatCard('Classes', this.classes.length));
    stats.appendChild(createStatCard('Leaders/Instructors', this.users.length));
    stats.appendChild(createStatCard('Students', this.students.length));
    tab.appendChild(stats);

    // Motivation quote + simple GP analytics moved to Overview
    const quoteCard = createMotivationCard();
    quoteCard.classList.add('mb-lg');
    tab.appendChild(quoteCard);

    const gpStatsCard = document.createElement('div');
    gpStatsCard.className = 'card mb-lg';
    gpStatsCard.style.padding = '1rem';
    gpStatsCard.innerHTML = '<h3>Gathering Place Attendance</h3><div id="gpOverviewStats">Loading...</div>';
    tab.appendChild(gpStatsCard);

    // Mark Attendance controls
    const attendRow = document.createElement('div');
    attendRow.className = 'flex-between mt-lg';
    attendRow.innerHTML = `
      <div>
        <button id="markAllAttendanceBtn" class="btn btn-primary">Mark Attendance (All Classes)</button>
        <button id="markGeneralAttendanceBtn" class="btn btn-outline">Mark General Attendance</button>
      </div>
    `;
    tab.appendChild(attendRow);

    // Load GP stats async
    (async () => {
      try {
        const gp = await getGatheringPlaceStats();
        const cont = document.getElementById('gpOverviewStats');
        cont.innerHTML = `
          <div class="stats-grid">
            <div class="stat-card"><div class="stat-label">Total Sessions</div><div class="stat-value">${gp.totalSessions}</div></div>
            <div class="stat-card"><div class="stat-label">Present</div><div class="stat-value">${gp.totalPresent}</div></div>
            <div class="stat-card"><div class="stat-label">Absent</div><div class="stat-value">${gp.totalAbsent}</div></div>
            <div class="stat-card"><div class="stat-label">Overall Rate</div><div class="stat-value">${gp.overallRate}%</div></div>
          </div>
        `;
      } catch (err) {
        console.error('Failed to load GP stats:', err);
        const cont = document.getElementById('gpOverviewStats');
        cont.textContent = 'No attendance data available yet.';
      }
    })();

    // Wire up mark attendance button
    document.getElementById('markAllAttendanceBtn')?.addEventListener('click', () => this.showMarkAttendanceModal());
    document.getElementById('markGeneralAttendanceBtn')?.addEventListener('click', () => this.showMarkGeneralAttendanceModal());
  }

  async showMarkAttendanceModal() {
    // Modal UI to mark attendance per class; supports cycling through all classes
    const classes = this.classes || [];
    if (!classes.length) { showNotification('No classes available to mark attendance', 'warning'); return; }

    const allStudents = await getStudents();

    let currentIndex = 0;

    // Prompt admin to choose the session date once before iterating classes
    const chooseSessionDate = () => new Promise((resolve) => {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const defaultDate = `${yyyy}-${mm}-${dd}`;

      const input = createInput('date', '', 'markAttendanceDate', { value: defaultDate });
      const wrapper = document.createElement('div');
      const label = document.createElement('p');
      label.className = 'text-muted';
      label.textContent = 'Select the date for the attendance sessions you are about to record.';
      wrapper.append(label, input);

      const startBtn = createButton('Start', () => {
        const v = input.value || defaultDate;
        modal.remove();
        resolve(v);
      }, { className: 'btn-primary' });

      const cancelBtn = createButton('Cancel', () => {
        modal.remove();
        resolve(null);
      }, { className: 'btn-secondary' });

      const modal = createModal('Select session date', wrapper, [startBtn, cancelBtn]);
      document.body.appendChild(modal);
    });

    const sessionDate = await chooseSessionDate();
    if (!sessionDate) return; // user cancelled

    const showForClass = async (cls) => {
      const students = allStudents.filter(student => studentHasClass(student, cls.id));
      const container = document.createElement('div');
      container.innerHTML = `<h3>Mark Attendance — ${cls.name}</h3>`;

      if (!students.length) {
        const msg = document.createElement('p'); msg.className = 'text-muted'; msg.textContent = 'No students in this class.'; container.appendChild(msg);
      } else {
        const list = document.createElement('div'); list.className = 'attendance-list';
        students.forEach(st => {
          const row = document.createElement('div'); row.className = 'flex gap-md align-center mb-sm';
          const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = true; chk.id = `att_${cls.id}_${st.id}`;
          const lbl = document.createElement('label'); lbl.htmlFor = chk.id; lbl.textContent = st.name;
          row.appendChild(chk); row.appendChild(lbl); list.appendChild(row);
        });
        container.appendChild(list);
      }

      const nextBtn = createButton(
        currentIndex < classes.length - 1 ? 'Save and Next' : 'Save',
        async () => {
      
          // Collect attendance records
          if (students.length) {
      
            const records = students.map(st => ({
              studentId: st.id,
              status: document.getElementById(`att_${cls.id}_${st.id}`).checked
                ? 'present'
                : 'absent'
            }));
      
            try {
      
              await createSession({
                classId: cls.id,
                date: sessionDate,
                records,
                createdBy: this.currentUser?.uid
              });
      
              showNotification(
                `Saved attendance for ${cls.name}`,
                'success'
              );
      
            } catch (err) {
      
              console.error(
                'Failed to save attendance for class',
                cls.id,
                err
              );
      
              showNotification(
                `Failed to save attendance for ${cls.name}`,
                'error'
              );
      
              return;
            }
          }
      
          modal.remove();
      
          currentIndex += 1;
      
          if (currentIndex < classes.length) {
      
            await showForClass(classes[currentIndex]);
      
          } else {
      
            showNotification(
              'Attendance marking completed',
              'success'
            );
          }
        }
      );
      
      const skipBtn = createButton(
        'Skip this class',
      
        async () => {
      
          modal.remove();
      
          showNotification(
            `Skipped ${cls.name}`,
            'warning'
          );
      
          currentIndex += 1;
      
          if (currentIndex < classes.length) {
      
            await showForClass(classes[currentIndex]);
      
          } else {
      
            showNotification(
              'All classes completed',
              'success'
            );
          }
        },
      
        {
          className: 'btn-secondary'
        }
      );
      
      const cancelBtn = createButton(
        'Cancel',
        () => {
          modal.remove();
        },
        {
          className: 'btn-danger'
        }
      );
      
      const modal = createModal(
        `Mark Attendance — ${cls.name}`,
        container,
        [
          nextBtn,
          skipBtn,
          cancelBtn
        ]
      );
      
      document.body.appendChild(modal);
    };
    
     // Start with first class
    await showForClass(classes[currentIndex]);
    }

  async showMarkGeneralAttendanceModal() {
    // Admin can record a general (gathering place) attendance summary: present & absent counts
    const chooseSessionDateAndCounts = () => new Promise((resolve) => {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const defaultDate = `${yyyy}-${mm}-${dd}`;

      const dateInput = createInput('date', '', 'generalAttendanceDate', { value: defaultDate });
      const presentInput = createInput('number', 'Present Count', 'generalPresent', { value: 0, min: 0 });
      const absentInput = createInput('number', 'Absent Count', 'generalAbsent', { value: 0, min: 0 });

      const wrapper = document.createElement('div');
      const p = document.createElement('p'); p.className = 'text-muted'; p.textContent = 'Record a general attendance summary for the gathering place.';
      wrapper.append(p, dateInput, presentInput, absentInput);

      const saveBtn = createButton('Save', () => {
        const date = dateInput.value || defaultDate;
        const present = Math.max(0, Number(presentInput.value) || 0);
        const absent = Math.max(0, Number(absentInput.value) || 0);
        const total = present + absent;
        modal.remove();
        resolve({ date, present, absent, total });
      }, { className: 'btn-primary' });

      const cancelBtn = createButton('Cancel', () => { modal.remove(); resolve(null); }, { className: 'btn-secondary' });

      const modal = createModal('Mark General Attendance', wrapper, [saveBtn, cancelBtn]);
      document.body.appendChild(modal);
    });

    const result = await chooseSessionDateAndCounts();
    if (!result) return;

    try {
      await createSession({ classId: 'GENERAL', date: result.date, createdBy: this.currentUser?.uid, generalSummary: { present: result.present, absent: result.absent, total: result.total } });
      showNotification('General attendance recorded', 'success');
      // refresh overview stats
      this.renderOverviewTab();
    } catch (err) {
      console.error('Failed to create general attendance session', err);
      showNotification('Failed to record general attendance', 'error');
    }
  }

  getInstructorForClass(classRecord) {
    return this.users.find(user => user.id === classRecord.instructorId)
      || this.users.find(user => user.role === 'instructor' && user.assignedClassId === classRecord.id)
      || null;
  }

  async showClassParticipants(classRecord) {
    try {
      const students = await getStudentsByClass(classRecord.id);
      showClassParticipantsModal(classRecord, students);
    } catch (error) {
      console.error('Failed to load class participants:', error);
      showNotification('Failed to load class participants', 'error');
    }
  }

  async renderClassesTab() {
    const tab = document.getElementById('classesTab'); clearElement(tab);
    const h = document.createElement('div'); h.className = 'flex-between mb-lg';
    h.innerHTML = `<h2>Classes</h2><button class="btn btn-primary" id="addClassBtn">Add Class</button>`;
    tab.appendChild(h);
    if (this.isLoading) {
      tab.appendChild(createTableSkeleton(5, 4));
      return;
    }
    const rows = this.classes.map(cls => {
      let instructor = this.getInstructorForClass(cls);
      // If class references an instructorId but user is not yet loaded, fetch it and re-render
      if (!instructor && cls.instructorId && !this._fetchingUserIds.has(cls.instructorId)) {
        this._fetchingUserIds.add(cls.instructorId);
        getUserData(cls.instructorId).then(userDoc => {
          if (userDoc) {
            this.users.push(userDoc);
            this._fetchingUserIds.delete(cls.instructorId);
            // Re-render classes tab to show updated instructor
            this.renderClassesTab();
          } else {
            this._fetchingUserIds.delete(cls.instructorId);
          }
        }).catch(err => {
          console.error('Failed to fetch instructor user doc:', err);
          this._fetchingUserIds.delete(cls.instructorId);
        });
      }
      const instructorDisplay = instructor ? (instructor.name || instructor.email || instructor.id || 'Unknown') : (cls.instructorId ? 'Loading...' : 'Unassigned');
      const participantsCount = this.getStudentsForClass(cls.id).length;

      return {
        'Class Name': cls.name,
        'Type': cls.isGeneralClass ? 'General / Shared' : 'Primary',
        'Instructor': instructorDisplay,
        'Participants': String(participantsCount),
        'Status': cls.isLocked ? '🔒 Locked' : '🔓 Unlocked',
        'Actions': () => {
          const wrap = document.createElement('div');
          wrap.style.display = 'flex';
          wrap.style.gap = '0.5rem';
          wrap.style.flexWrap = 'wrap';

          const viewBtn = createButton('View Participants', async () => {
            viewBtn.disabled = true;
            try {
              await this.showClassParticipants(cls);
            } finally {
              viewBtn.disabled = false;
            }
          }, { className: 'btn-primary btn-small' });

          const lockBtn = document.createElement('button');
          lockBtn.className = 'btn btn-small btn-secondary';
          lockBtn.textContent = cls.isLocked ? 'Unlock' : 'Lock';
          lockBtn.addEventListener('click', async () => {
            try { await updateClassLockStatus(cls.id, !cls.isLocked); await this.loadClasses(); this.renderClassesTab(); showNotification('Class updated', 'success'); }
            catch { showNotification('Failed to update class', 'error'); }
          });

          const deleteBtn = createButton('Delete', async () => {
            const content = document.createElement('div');
            content.innerHTML = `<p>Delete <strong>${cls.name}</strong>? This will remove the class and all associated data.</p>`;
            const confirmBtn = createButton('Delete', async () => {
              try {
                await deleteClass(cls.id);
                await this.loadClasses();
                this.renderClassesTab();
                showNotification('Class deleted successfully', 'success');
              } catch (err) {
                console.error('Failed to delete class:', err);
                showNotification('Failed to delete class', 'error');
              }
              modal.remove();
            }, { className: 'btn-danger' });
            const cancelBtn = createButton('Cancel', () => modal.remove());
            const modal = createModal('Confirm delete class', content, [confirmBtn, cancelBtn]);
            document.body.appendChild(modal);
          }, { className: 'btn-danger btn-small' });

          wrap.append(viewBtn, lockBtn, deleteBtn);
          return wrap;
        }
      };
    });
    tab.appendChild(createTable(['Class Name', 'Type', 'Instructor', 'Participants', 'Status', 'Actions'], rows));
    this.renderClassManagementSection(tab);
    document.getElementById('addClassBtn')?.addEventListener('click', () => this.showAddClassModal());
  }

  showAddClassModal(options = {}) {
    const nameInput = createInput('text', 'Class Name', 'className');
    const generalToggleWrap = document.createElement('label');
    generalToggleWrap.style.display = 'flex';
    generalToggleWrap.style.alignItems = 'center';
    generalToggleWrap.style.gap = '0.5rem';

    const generalCheckbox = document.createElement('input');
    generalCheckbox.type = 'checkbox';

    const generalText = document.createElement('span');
    generalText.textContent = 'General class (shared)';

    const helperText = document.createElement('p');
    helperText.className = 'text-muted';
    helperText.textContent = 'Use this when students can join the class in addition to their main class, like Institute or Self-Reliance.';

    generalToggleWrap.append(generalCheckbox, generalText);

    const form = document.createElement('div');
    form.style.display = 'flex';
    form.style.flexDirection = 'column';
    form.style.gap = '0.75rem';
    form.append(nameInput, generalToggleWrap, helperText);
    let modal;
    const createBtn = createButton('Create Class', async () => {
      const name = (nameInput.value || '').trim();
      if (!name) { showNotification('Please provide a class name', 'warning'); return; }
      try {
        const classId = await createClass(name, { isGeneralClass: generalCheckbox.checked });
        modal.remove();
        await this.loadClasses();
        this.ensureManageSelectionState();
        if (typeof options.onCreated === 'function') {
          await options.onCreated(classId);
        }
        this.renderActiveTab();
        showNotification('Class created successfully', 'success');
      }
      catch (err) { console.error(err); showNotification('Failed to create class', 'error'); }
    });
    const cancelBtn = createButton('Cancel', () => modal.remove());
    modal = createModal('Add New Class', form, [createBtn, cancelBtn]);
    document.body.appendChild(modal);
  }

  async renderSettingsTab() {
    const tab = document.getElementById('settingsTab');
    clearElement(tab);

    const header = document.createElement('div');
    header.className = 'flex-between mb-lg';
    header.innerHTML = `
      <div>
        <h2>Settings</h2>
        <p class="text-muted">Update your name and contact details. Password and verification tools will be added later.</p>
      </div>
    `;
    tab.appendChild(header);

    if (this.isLoading) {
      tab.appendChild(createTabSkeleton({ statsCount: 1, tableRows: 3, tableColumns: 2, showQuote: false }));
      return;
    }

    const profile = this.currentUserProfile || this.users.find(user => user.id === this.currentUser?.uid) || {
      name: this.currentUser?.displayName || '',
      email: this.currentUser?.email || '',
      phoneNumber: '',
      address: ''
    };

    const settingsCard = document.createElement('div');
    settingsCard.className = 'card';
    settingsCard.innerHTML = '<div class="card-header">Profile Settings</div>';

    const body = document.createElement('div');
    body.className = 'card-body';

    const note = document.createElement('p');
    note.className = 'text-muted';
    note.textContent = 'Use the same email you want tied to this admin account. Some email changes may require a fresh sign-in before Firebase allows the update.';
    body.appendChild(note);

    const roleText = document.createElement('p');
    roleText.className = 'text-muted';
    roleText.textContent = `Role: ${profile.role || 'admin'}`;
    body.appendChild(roleText);

    const form = document.createElement('div');
    form.style.display = 'flex';
    form.style.flexDirection = 'column';
    form.style.gap = '0.75rem';
    form.style.maxWidth = '640px';

    const nameInput = createInput('text', 'Full name', 'settingsName', { value: profile.name || '' });
    const emailInput = createInput('email', 'Email address', 'settingsEmail', { value: profile.email || this.currentUser?.email || '' });
    const phoneInput = createInput('text', 'Phone number', 'settingsPhone', { value: profile.phoneNumber || '' });
    const addressInput = createInput('text', 'Address', 'settingsAddress', { value: profile.address || '' });

    form.append(nameInput, emailInput, phoneInput, addressInput);
    body.appendChild(form);

    const actionRow = document.createElement('div');
    actionRow.className = 'flex gap-md mt-lg';
    actionRow.style.flexWrap = 'wrap';

    const saveBtn = createButton('Save Changes', async () => {
      const nextName = (nameInput.value || '').trim();
      const nextEmail = (emailInput.value || '').trim();
      const nextPhone = (phoneInput.value || '').trim();
      const nextAddress = (addressInput.value || '').trim();

      if (!nextName || !nextEmail) {
        showNotification('Name and email are required', 'warning');
        return;
      }

      if (!this.currentUser?.uid) {
        showNotification('Unable to identify the current user', 'error');
        return;
      }

      saveBtn.disabled = true;
      let notificationType = 'success';
      let notificationMessage = 'Settings updated successfully';

      try {
        if (this.isDemoMode) {
          this.currentUserProfile = {
            ...profile,
            name: nextName,
            email: nextEmail,
            phoneNumber: nextPhone,
            address: nextAddress
          };
          this.renderSettingsTab();
          showNotification('Settings updated in local demo mode', 'success');
          return;
        }

        const updates = {
          name: nextName,
          phoneNumber: nextPhone,
          address: nextAddress
        };

        const currentEmail = profile.email || this.currentUser?.email || '';
        if (nextEmail !== currentEmail) {
          try {
            if (auth.currentUser) {
              await updateAuthEmail(auth.currentUser, nextEmail);
            }
            updates.email = nextEmail;
          } catch (error) {
            if (error?.code === 'auth/requires-recent-login') {
              notificationType = 'warning';
              notificationMessage = 'Name and contact details were saved, but email changes require you to log out and sign in again before retrying.';
            } else if (error?.code === 'auth/invalid-email') {
              throw new Error('Please enter a valid email address.');
            } else if (error?.code === 'auth/email-already-in-use') {
              throw new Error('That email address is already in use.');
            } else {
              throw error;
            }
          }
        } else {
          updates.email = nextEmail;
        }

        await updateUser(this.currentUser.uid, updates);
        await Promise.all([this.loadUsers(), this.loadCurrentUserProfile()]);
        this.renderSettingsTab();
        showNotification(notificationMessage, notificationType);
      } catch (error) {
        console.error('Failed to update settings', error);
        showNotification(error?.message || 'Failed to update settings', 'error');
      } finally {
        saveBtn.disabled = false;
      }
    }, { className: 'btn-primary' });

    actionRow.appendChild(saveBtn);
    body.appendChild(actionRow);
    settingsCard.appendChild(body);
    tab.appendChild(settingsCard);
  }

  async renderUsersTab() {
    const tab = document.getElementById('usersTab'); clearElement(tab);
    const h = document.createElement('div'); h.className = 'flex-between mb-lg';
    h.innerHTML = `<h2>Leaders / Instructors</h2><button class="btn btn-primary" id="addUserBtn">Add User</button>`;
    tab.appendChild(h);
    if (this.isLoading) {
      tab.appendChild(createTableSkeleton(5, 5));
      return;
    }
    const rows = this.users.map(user => ({
      'Name': user.name, 'Email': user.email, 'Role': user.role,
      'Class': this.classes.find(cls => cls.id === user.assignedClassId)?.name || '—',
      'Actions': () => {
        const btn = document.createElement('button'); btn.className = 'btn btn-danger btn-small'; btn.textContent = 'Delete';
        btn.addEventListener('click', () => {
          const content = document.createElement('div');
          content.innerHTML = `<p>Delete user <strong>${user.name}</strong>? This will remove their access and profile from the system.</p>`;
          const confirmBtn = createButton('Delete', async () => {
            try { await deleteUser(user.id); await this.loadUsers(); this.renderUsersTab(); showNotification('User deleted', 'success'); }
            catch { showNotification('Failed to delete user', 'error'); }
            modal.remove();
          }, { className: 'btn-danger' });
          const cancelBtn = createButton('Cancel', () => modal.remove());
          const modal = createModal('Confirm delete user', content, [confirmBtn, cancelBtn]);
          document.body.appendChild(modal);
        });
        return btn;
      }
    }));
    tab.appendChild(createTable(['Name', 'Email', 'Role', 'Class', 'Actions'], rows));
    document.getElementById('addUserBtn')?.addEventListener('click', () => this.showAddUserModal());
  }

  async renderStudentsTab(options = {}) {
    const { focusSearch = false } = options;
    const tab = document.getElementById('studentsTab'); clearElement(tab);
    const h = document.createElement('div'); h.className = 'flex-between mb-lg';
    h.innerHTML = `<h2>Students</h2><button class="btn btn-primary" id="addStudentBtn">Add Student</button>`;
    tab.appendChild(h);
    if (this.isLoading) {
      tab.appendChild(createTableSkeleton(6, 3));
      return;
    }
    const filterWrap = document.createElement('div');
    filterWrap.className = 'flex gap-md mb-lg';
    filterWrap.style.flexWrap = 'wrap';

    const classFilterSelect = createSelect([
      { label: 'All classes', value: '' },
      { label: 'Unassigned students', value: '__unassigned__' },
      ...this.classes.map(classRecord => ({ label: classRecord.name, value: classRecord.id }))
    ], 'studentsClassFilter', this.studentsFilterClassId || '');
    classFilterSelect.value = this.studentsFilterClassId || '';
    classFilterSelect.addEventListener('change', () => {
      this.studentsFilterClassId = classFilterSelect.value;
      this.renderStudentsTab();
    });

    const searchInput = createInput('search', 'Search by student name', 'studentsNameFilter');
    searchInput.value = this.studentsSearchTerm || '';
    searchInput.addEventListener('input', () => {
      this.studentsSearchTerm = searchInput.value || '';
      this.renderStudentsTab({ focusSearch: true });
    });

    const filterSummary = document.createElement('p');
    filterSummary.className = 'text-muted';

    const filteredStudents = this.getFilteredStudents();
    const filterLabel = this.studentsFilterClassId === '__unassigned__'
      ? 'unassigned students'
      : (this.studentsFilterClassId ? this.getClassName(this.studentsFilterClassId, 'selected class') : 'all students');
    const searchLabel = this.studentsSearchTerm.trim()
      ? ` matching "${this.studentsSearchTerm.trim()}"`
      : '';
    filterSummary.textContent = `${filteredStudents.length} of ${this.students.length} students shown for ${filterLabel}${searchLabel}.`;

    filterWrap.append(classFilterSelect, searchInput, filterSummary);
    tab.appendChild(filterWrap);

    if (focusSearch) {
      requestAnimationFrame(() => {
        const nextSearchInput = document.getElementById('studentsNameFilter');
        if (!nextSearchInput) return;
        nextSearchInput.focus();
        const valueLength = nextSearchInput.value.length;
        if (typeof nextSearchInput.setSelectionRange === 'function') {
          nextSearchInput.setSelectionRange(valueLength, valueLength);
        }
      });
    }

    const rows = filteredStudents.map(student => {
      const cls = this.classes.find(c => c.id === student.classId);
      return {
        'Name': student.name || '—',
        'Class': cls ? cls.name : 'Unassigned',
        'Shared Classes': this.getSharedClassNames(student),
        'Email': student.email || '—',
        'Phone': student.phoneNumber || '—',
        'Location': student.location || '—',
        'Actions': () => {
          const wrap = document.createElement('div');
          wrap.style.display = 'flex';
          wrap.style.gap = '0.5rem';

          const editBtn = createButton('Edit', () => this.showEditStudentModal(student), { className: 'btn-secondary btn-small' });

          const delBtn = document.createElement('button'); delBtn.className = 'btn btn-danger btn-small'; delBtn.textContent = 'Delete';
          delBtn.addEventListener('click', () => {
            const content = document.createElement('div');
            content.innerHTML = `<p>Delete student <strong>${student.name}</strong>? This will permanently remove the student record.</p>`;
            const confirmBtn = createButton('Delete', async () => {
              try {
                if (!student.id) {
                  showNotification('Student record has no valid id; refreshing list.', 'warning');
                  await this.loadStudents();
                  this.renderStudentsTab();
                  modal.remove();
                  return;
                }
                await deleteStudent(student.id);
                await this.loadStudents();
                this.renderStudentsTab();
                showNotification('Student deleted', 'success');
              } catch (err) {
                console.error(err);
                await this.loadStudents();
                this.renderStudentsTab();
                showNotification('Failed to delete student', 'error');
              }
              modal.remove();
            }, { className: 'btn-danger' });
            const cancelBtn = createButton('Cancel', () => modal.remove());
            const modal = createModal('Confirm delete student', content, [confirmBtn, cancelBtn]);
            document.body.appendChild(modal);
          });

          wrap.appendChild(editBtn);
          wrap.appendChild(delBtn);
          return wrap;
        }
      };
    });

    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'text-muted';
      empty.textContent = this.studentsFilterClassId
        ? 'No students match the selected filter.'
        : 'No students have been added yet.';
      tab.appendChild(empty);
    } else {
      tab.appendChild(createTable(['Name', 'Class', 'Shared Classes', 'Email', 'Phone', 'Location', 'Actions'], rows));
    }

    document.getElementById('addStudentBtn')?.addEventListener('click', () => this.showAddStudentModal());
  }

  showAddStudentModal() {
    const nameInput = createInput('text', 'Student Name', 'studentName');
    const emailInput = createInput('email', 'Email (optional)', 'studentEmail');
    const phoneInput = createInput('text', 'Phone number (optional)', 'studentPhone');
    const locationInput = createInput('text', 'Ward / Location (optional)', 'studentLocation');
    const classSelect = createSelect([{ label: 'Select Class...', value: '' }, ...this.classes.map(c => ({ label: c.name, value: c.id }))], 'studentClass');

    const form = document.createElement('div');
    form.style.display = 'flex';
    form.style.flexDirection = 'column';
    form.style.gap = '0.75rem';
    form.style.padding = '0.5rem 0';
    form.append(nameInput, emailInput, phoneInput, locationInput, classSelect);

    let modal;
    const createBtn = createButton('Add Student', async () => {
      const name = (nameInput.value || '').trim();
      const classId = classSelect.value;
      const email = (emailInput.value || '').trim() || null;
      const phone = (phoneInput.value || '').trim() || null;
      const location = (locationInput.value || '').trim() || null;
      if (!name || !classId) { showNotification('Please provide student name and class', 'warning'); return; }
      try {
        await addStudent(name, classId, email, phone, location);
        modal.remove();
        await this.loadStudents();
        this.ensureManageSelectionState();
        this.renderActiveTab();
        showNotification('Student added', 'success');
      }
      catch (err) { console.error('Add student error', err); showNotification('Failed to add student: ' + (err.message || ''), 'error'); }
    });
    const cancelBtn = createButton('Cancel', () => modal.remove());
    modal = createModal('Add Student', form, [createBtn, cancelBtn]);
    document.body.appendChild(modal);
  }

  showEditStudentModal(student) {
    const nameInput = createInput('text', 'Student Name', 'editStudentName');
    nameInput.value = student.name || '';
    const emailInput = createInput('email', 'Email', 'editStudentEmail');
    emailInput.value = student.email || '';
    const phoneInput = createInput('text', 'Phone number', 'editStudentPhone');
    phoneInput.value = student.phoneNumber || '';
    const locationInput = createInput('text', 'Ward / Location', 'editStudentLocation');
    locationInput.value = student.location || '';

    const classSelect = createSelect([{ label: 'Select Class...', value: '' }, ...this.classes.map(c => ({ label: c.name, value: c.id }))], 'editStudentClass');
    classSelect.value = student.classId || '';

    const joinedInput = createInput('date', 'Joined date', 'editStudentJoined');
    try {
      if (student.createdAt && typeof student.createdAt.toDate === 'function') {
        const d = student.createdAt.toDate();
        const yyyy = d.getFullYear(); const mm = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0');
        joinedInput.value = `${yyyy}-${mm}-${dd}`;
      } else if (student.createdAt) {
        const parsed = new Date(student.createdAt);
        if (!isNaN(parsed.getTime())) {
          const yyyy = parsed.getFullYear(); const mm = String(parsed.getMonth()+1).padStart(2,'0'); const dd = String(parsed.getDate()).padStart(2,'0');
          joinedInput.value = `${yyyy}-${mm}-${dd}`;
        }
      }
    } catch (e) {}

    const form = document.createElement('div');
    form.style.display = 'flex'; form.style.flexDirection = 'column'; form.style.gap = '0.75rem';
    form.append(nameInput, emailInput, phoneInput, locationInput, classSelect, joinedInput);

    const saveBtn = createButton('Save', async () => {
      const updates = {};
      const name = (nameInput.value||'').trim(); if (name) updates.name = name;
      const email = (emailInput.value||'').trim(); if (email) updates.email = email;
      const phone = (phoneInput.value||'').trim(); if (phone) updates.phoneNumber = phone;
      const location = (locationInput.value||'').trim(); if (location) updates.location = location;
      const classId = classSelect.value;
      if (classId) {
        updates.classId = classId;
        const nextSharedClassIds = (student.sharedClassIds || []).filter(sharedClassId => sharedClassId !== classId);
        if (nextSharedClassIds.length !== (student.sharedClassIds || []).length) {
          updates.sharedClassIds = nextSharedClassIds;
        }
      }
      const joined = joinedInput.value; if (joined) updates.createdAt = Timestamp.fromDate(new Date(joined));

      try {
        await updateStudent(student.id, updates);
        showNotification('Student updated', 'success');
        await this.loadStudents();
        this.renderActiveTab();
      } catch (err) {
        console.error('Failed to update student', err);
        showNotification('Failed to update student', 'error');
      }
      modal.remove();
    }, { className: 'btn-primary' });

    const cancelBtn = createButton('Cancel', () => modal.remove(), { className: 'btn-secondary' });
    const modal = createModal('Edit Student', form, [saveBtn, cancelBtn]);
    document.body.appendChild(modal);
  }

  renderClassManagementSection(container) {
    const section = document.createElement('section');
    section.className = 'mt-xl';

    const header = document.createElement('div');
    header.className = 'flex-between mb-lg';
    header.innerHTML = `
      <div>
        <h2>Class Enrollment Management</h2>
        <p class="text-muted">Review class rosters, move students to a new primary class, or add them to shared general classes.</p>
      </div>
    `;

    const actionWrap = document.createElement('div');
    actionWrap.className = 'flex gap-md';
    actionWrap.style.flexWrap = 'wrap';

    const addStudentBtn = createButton('New Student', () => this.showAddStudentModal(), { className: 'btn-secondary' });
    const addClassBtn = createButton('New Class', () => this.showAddClassModal({
      onCreated: async classId => {
        this.manageTargetClassId = classId;
      }
    }), { className: 'btn-primary' });
    actionWrap.append(addStudentBtn, addClassBtn);
    header.appendChild(actionWrap);
    section.appendChild(header);

    if (this.isLoading) {
      section.appendChild(createTableSkeleton(6, 6));
      container.appendChild(section);
      return;
    }

    if (!this.classes.length) {
      const empty = document.createElement('p');
      empty.className = 'text-muted';
      empty.textContent = 'No classes available yet. Create a class to start managing student assignments.';
      section.appendChild(empty);
      container.appendChild(section);
      return;
    }

    this.ensureManageSelectionState();

    const selectedClass = this.getClassRecordById(this.manageSelectedClassId) || this.classes[0];
    const roster = this.getStudentsForClass(selectedClass.id).sort((left, right) =>
      String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' })
    );
    const selectedStudents = roster.filter(student => this.manageSelectedStudentIds.has(student.id));

    const controlsCard = document.createElement('div');
    controlsCard.className = 'card mb-lg';

    const controlsBody = document.createElement('div');
    controlsBody.className = 'card-body';

    const sourceLabel = document.createElement('p');
    sourceLabel.className = 'text-muted';
    sourceLabel.textContent = 'Choose a class to review, then select the students you want to update.';

    const sourceClassSelect = createSelect(
      this.classes.map(classRecord => ({ label: classRecord.name, value: classRecord.id })),
      'manageSourceClassSelect',
      selectedClass.id
    );
    sourceClassSelect.value = selectedClass.id;

    const targetClassOptions = [
      { label: 'Choose destination class...', value: '' },
      ...this.classes
        .filter(classRecord => classRecord.id !== selectedClass.id)
        .map(classRecord => ({ label: classRecord.name, value: classRecord.id }))
    ];
    const targetClassSelect = createSelect(targetClassOptions, 'manageTargetClassSelect', this.manageTargetClassId || '');
    targetClassSelect.value = this.manageTargetClassId || '';

    sourceClassSelect.addEventListener('change', () => {
      this.manageSelectedClassId = sourceClassSelect.value;
      this.manageSelectedStudentIds.clear();
      this.ensureManageSelectionState();
      this.renderClassesTab();
    });

    targetClassSelect.addEventListener('change', () => {
      this.manageTargetClassId = targetClassSelect.value;
    });

    const sourceRow = document.createElement('div');
    sourceRow.className = 'flex gap-md mb-md';
    sourceRow.style.flexWrap = 'wrap';
    sourceRow.append(sourceClassSelect, targetClassSelect);

    const summary = document.createElement('p');
    summary.className = 'text-muted';
    summary.textContent = `${roster.length} student${roster.length === 1 ? '' : 's'} in ${selectedClass.name}. ${selectedStudents.length} selected.`;

    if (selectedClass.isGeneralClass) {
      const generalNote = document.createElement('p');
      generalNote.className = 'text-muted';
      generalNote.textContent = 'This is a shared general class. Students marked Shared still belong to another primary class.';
      controlsBody.append(sourceLabel, sourceRow, summary, generalNote);
    } else {
      controlsBody.append(sourceLabel, sourceRow, summary);
    }

    const selectedActions = document.createElement('div');
    selectedActions.className = 'flex gap-md mb-md';
    selectedActions.style.flexWrap = 'wrap';

    const selectAllBtn = createButton('Select All', () => {
      this.manageSelectedStudentIds = new Set(roster.map(student => student.id));
      this.renderClassesTab();
    }, { className: 'btn-secondary' });

    const clearSelectionBtn = createButton('Clear Selection', () => {
      this.manageSelectedStudentIds.clear();
      this.renderClassesTab();
    }, { className: 'btn-secondary' });

    const addSelectedBtn = createButton('Add Selected to Class', async () => {
      const currentSelectedStudents = roster.filter(student => this.manageSelectedStudentIds.has(student.id));
      const targetClassId = targetClassSelect.value;
      if (!currentSelectedStudents.length) {
        showNotification('Select at least one student first', 'warning');
        return;
      }
      if (!targetClassId) {
        showNotification('Choose a target class first', 'warning');
        return;
      }

      const targetClassName = this.getClassName(targetClassId, 'the selected class');
      const confirmed = await this.confirmAction(
        'Add selected students',
        `Add ${currentSelectedStudents.length} selected student${currentSelectedStudents.length === 1 ? '' : 's'} to <strong>${targetClassName}</strong> without changing their primary class?`
      );
      if (!confirmed) return;

      try {
        const updatedCount = await bulkAssignStudentsToClass(currentSelectedStudents, targetClassId, 'add');
        await this.reloadCoreData();
        this.manageSelectedStudentIds.clear();
        this.renderClassesTab();
        if (updatedCount > 0) {
          showNotification(`Added ${updatedCount} student${updatedCount === 1 ? '' : 's'} to ${targetClassName}`, 'success');
        } else {
          showNotification(`Selected students are already in ${targetClassName}`, 'warning');
        }
      } catch (error) {
        console.error('Failed to add selected students to class', error);
        showNotification('Failed to add selected students to class', 'error');
      }
    }, { className: 'btn-secondary' });

    const moveSelectedBtn = createButton('Move Selected to Class', async () => {
      const currentSelectedStudents = roster.filter(student => this.manageSelectedStudentIds.has(student.id));
      const targetClassId = targetClassSelect.value;
      if (!currentSelectedStudents.length) {
        showNotification('Select at least one student first', 'warning');
        return;
      }
      if (!targetClassId) {
        showNotification('Choose a target class first', 'warning');
        return;
      }

      const targetClassName = this.getClassName(targetClassId, 'the selected class');
      const confirmed = await this.confirmAction(
        'Move selected students',
        `Move ${currentSelectedStudents.length} selected student${currentSelectedStudents.length === 1 ? '' : 's'} to <strong>${targetClassName}</strong> as their new primary class?`
      );
      if (!confirmed) return;

      try {
        const updatedCount = await bulkAssignStudentsToClass(currentSelectedStudents, targetClassId, 'move');
        await this.reloadCoreData();
        this.manageSelectedStudentIds.clear();
        this.renderClassesTab();
        if (updatedCount > 0) {
          showNotification(`Moved ${updatedCount} student${updatedCount === 1 ? '' : 's'} to ${targetClassName}`, 'success');
        } else {
          showNotification(`Selected students are already assigned to ${targetClassName}`, 'warning');
        }
      } catch (error) {
        console.error('Failed to move selected students to class', error);
        showNotification('Failed to move selected students to class', 'error');
      }
    }, { className: 'btn-primary' });

    const removeSelectedBtn = createButton('Remove Selected from Class', async () => {
      const currentSelectedStudents = roster.filter(student => this.manageSelectedStudentIds.has(student.id));
      if (!currentSelectedStudents.length) {
        showNotification('Select at least one student first', 'warning');
        return;
      }

      const confirmed = await this.confirmAction(
        'Remove selected students from class',
        `Remove shared enrollments for ${currentSelectedStudents.length} selected student${currentSelectedStudents.length === 1 ? '' : 's'} from <strong>${selectedClass.name}</strong>? Primary class assignments will stay untouched.`
      );
      if (!confirmed) return;

      try {
        const updatedCount = await bulkRemoveStudentsFromClass(currentSelectedStudents, selectedClass.id);
        await this.reloadCoreData();
        this.manageSelectedStudentIds.clear();
        this.renderClassesTab();
        if (updatedCount > 0) {
          showNotification(`Removed ${updatedCount} shared enrollment${updatedCount === 1 ? '' : 's'} from ${selectedClass.name}`, 'success');
        } else {
          showNotification('Only shared class enrollments can be removed here', 'warning');
        }
      } catch (error) {
        console.error('Failed to remove students from class', error);
        showNotification('Failed to remove students from class', 'error');
      }
    }, { className: 'btn-secondary' });

    selectedActions.append(selectAllBtn, clearSelectionBtn, addSelectedBtn, moveSelectedBtn, removeSelectedBtn);
    controlsBody.appendChild(selectedActions);
    controlsCard.appendChild(controlsBody);
    section.appendChild(controlsCard);

    const rosterRows = roster.map(student => {
      const membershipType = getStudentMembershipType(student, selectedClass.id);

      return {
        'Select': () => {
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = this.manageSelectedStudentIds.has(student.id);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) this.manageSelectedStudentIds.add(student.id);
            else this.manageSelectedStudentIds.delete(student.id);
            this.renderClassesTab();
          });
          return checkbox;
        },
        'Name': student.name || '—',
        'Class Role': membershipType === 'primary' ? 'Primary class' : 'Shared class',
        'Primary Class': this.getClassName(student.classId),
        'Shared Classes': this.getSharedClassNames(student),
        'Email': student.email || '—',
        'Actions': () => {
          const wrap = document.createElement('div');
          wrap.style.display = 'flex';
          wrap.style.gap = '0.5rem';
          wrap.style.flexWrap = 'wrap';

          const editBtn = createButton('Edit', () => this.showEditStudentModal(student), { className: 'btn-secondary btn-small' });
          wrap.appendChild(editBtn);

          if (membershipType === 'shared') {
            const removeBtn = createButton('Remove from Class', async () => {
              const confirmed = await this.confirmAction(
                'Remove student from class',
                `Remove <strong>${student.name || 'this student'}</strong> from <strong>${selectedClass.name}</strong>? Their primary class stays the same.`
              );
              if (!confirmed) return;

              try {
                await bulkRemoveStudentsFromClass([student], selectedClass.id);
                await this.reloadCoreData();
                this.manageSelectedStudentIds.delete(student.id);
                this.renderClassesTab();
                showNotification(`Removed ${student.name || 'student'} from ${selectedClass.name}`, 'success');
              } catch (error) {
                console.error('Failed to remove student from class', error);
                showNotification('Failed to remove student from class', 'error');
              }
            }, { className: 'btn-danger btn-small' });
            wrap.appendChild(removeBtn);
          }

          return wrap;
        }
      };
    });

    if (rosterRows.length) {
      section.appendChild(createTable(['Select', 'Name', 'Class Role', 'Primary Class', 'Shared Classes', 'Email', 'Actions'], rosterRows));
    } else {
      const empty = document.createElement('p');
      empty.className = 'text-muted';
      empty.textContent = `No students are currently assigned to ${selectedClass.name}.`;
      section.appendChild(empty);
    }

    const allStudentsCard = document.createElement('div');
    allStudentsCard.className = 'card mt-lg';
    allStudentsCard.innerHTML = '<div class="card-header">General Class Actions for Everyone</div>';

    const allStudentsBody = document.createElement('div');
    allStudentsBody.className = 'card-body';

    const allStudentsNote = document.createElement('p');
    allStudentsNote.className = 'text-muted';
    allStudentsNote.textContent = "Add keeps students in their current primary class. Move changes every student's primary class.";
    allStudentsBody.appendChild(allStudentsNote);

    const generalClassSelect = createSelect(
      [{ label: 'Choose general class...', value: '' }, ...this.getGeneralClasses().map(classRecord => ({ label: classRecord.name, value: classRecord.id }))],
      'manageGeneralClassSelect',
      this.manageGeneralTargetClassId || ''
    );
    generalClassSelect.value = this.manageGeneralTargetClassId || '';
    generalClassSelect.addEventListener('change', () => {
      this.manageGeneralTargetClassId = generalClassSelect.value;
    });

    allStudentsBody.appendChild(generalClassSelect);

    const allStudentsActions = document.createElement('div');
    allStudentsActions.className = 'flex gap-md mt-md';
    allStudentsActions.style.flexWrap = 'wrap';

    const addAllToSelectedBtn = createButton('Add Everyone to Class', async () => {
      const targetClassId = generalClassSelect.value;
      if (!targetClassId) {
        showNotification('Choose a general class first', 'warning');
        return;
      }

      const targetClassName = this.getClassName(targetClassId, 'the selected class');
      const confirmed = await this.confirmAction(
        'Add everyone to class',
        `Add all ${this.students.length} student${this.students.length === 1 ? '' : 's'} to <strong>${targetClassName}</strong> while keeping their current primary class assignments?`
      );
      if (!confirmed) return;

      try {
        const updatedCount = await bulkAssignStudentsToClass(this.students, targetClassId, 'add');
        await this.reloadCoreData();
        this.renderClassesTab();
        if (updatedCount > 0) {
          showNotification(`Added ${updatedCount} student${updatedCount === 1 ? '' : 's'} to ${targetClassName}`, 'success');
        } else {
          showNotification(`All students are already enrolled in ${targetClassName}`, 'warning');
        }
      } catch (error) {
        console.error('Failed to add all students to general class', error);
        showNotification('Failed to add all students to the selected class', 'error');
      }
    }, { className: 'btn-secondary' });

    const moveAllToSelectedBtn = createButton('Move Everyone to Class', async () => {
      const targetClassId = generalClassSelect.value;
      if (!targetClassId) {
        showNotification('Choose a general class first', 'warning');
        return;
      }

      const targetClassName = this.getClassName(targetClassId, 'the selected class');
      const confirmed = await this.confirmAction(
        'Move all students to class',
        `Move all ${this.students.length} student${this.students.length === 1 ? '' : 's'} to <strong>${targetClassName}</strong> as their primary class?`,
        { confirmText: 'Move Everyone', confirmClassName: 'btn-danger' }
      );
      if (!confirmed) return;

      try {
        const updatedCount = await bulkAssignStudentsToClass(this.students, targetClassId, 'move');
        await this.reloadCoreData();
        this.manageSelectedStudentIds.clear();
        this.renderClassesTab();
        if (updatedCount > 0) {
          showNotification(`Moved ${updatedCount} student${updatedCount === 1 ? '' : 's'} to ${targetClassName}`, 'success');
        } else {
          showNotification(`All students are already assigned to ${targetClassName}`, 'warning');
        }
      } catch (error) {
        console.error('Failed to move all students to class', error);
        showNotification('Failed to move all students to the selected class', 'error');
      }
    }, { className: 'btn-danger' });

    const addAllToCoreGeneralClassesBtn = createButton('Add Everyone to Core General Classes', async () => {
      const confirmed = await this.confirmAction(
        'Add everyone to core general classes',
        "Create any missing core general classes and enroll every student in all of them without changing anyone's primary class?"
      );
      if (!confirmed) return;

      try {
        await ensureGeneralClasses();
        await this.reloadCoreData();

        let totalUpdates = 0;
        for (const classRecord of this.getGeneralClasses()) {
          totalUpdates += await bulkAssignStudentsToClass(this.students, classRecord.id, 'add');
        }

        await this.reloadCoreData();
        this.renderClassesTab();
        if (totalUpdates > 0) {
          showNotification(`Added ${totalUpdates} class enrollment${totalUpdates === 1 ? '' : 's'} across the core general classes`, 'success');
        } else {
          showNotification('All students are already enrolled in the core general classes', 'warning');
        }
      } catch (error) {
        console.error('Failed to add all students to core general classes', error);
        showNotification('Failed to add all students to the core general classes', 'error');
      }
    }, { className: 'btn-primary' });

    allStudentsActions.append(addAllToSelectedBtn, moveAllToSelectedBtn, addAllToCoreGeneralClassesBtn);
    allStudentsBody.appendChild(allStudentsActions);
    allStudentsCard.appendChild(allStudentsBody);
    section.appendChild(allStudentsCard);
    container.appendChild(section);
  }

  async renderAnalyticsTab() {
    const tab = document.getElementById('analyticsTab');
    await renderAnalyticsTab(tab, this.classes, {
      requireAuth: true,
      isDemoMode: this.isDemoMode,
      emptyStateMessage: 'Attendance analytics is available after signing in as an authenticated admin.'
    });

    if (this.isDemoMode || !auth?.currentUser) return;

    // Add admin-only session management UI beneath analytics
    try {
      const sessionMgr = document.createElement('div');
      sessionMgr.className = 'card mt-lg session-manager-card';
      sessionMgr.innerHTML = `<div class="card-header">Class Attendance Sessions</div>`;

      const body = document.createElement('div');
      body.className = 'card-body';

      const classSelect = createSelect([
        { label: 'Select Class...', value: '' },
        ...this.classes.map(c => ({ label: c.name, value: c.id }))
      ], 'adminSessionClassSelect');

      const controls = document.createElement('div');
      controls.className = 'session-controls';

      const classSessionsContainer = document.createElement('div');
      classSessionsContainer.className = 'session-list-container';
      classSessionsContainer.innerHTML = '<p class="text-muted">Select a class to review attendance sessions.</p>';

      const pageSize = 10;
      let classSessions = [];
      let currentPage = 0;

      const renderClassSessionPage = async () => {
        clearElement(classSessionsContainer);

        if (!classSessions.length) {
          classSessionsContainer.innerHTML = '<p class="text-muted">No sessions recorded for this class.</p>';
          return;
        }

        const totalPages = Math.max(1, Math.ceil(classSessions.length / pageSize));
        currentPage = Math.min(currentPage, totalPages - 1);

        const start = currentPage * pageSize;
        const pageItems = classSessions.slice(start, start + pageSize);
        const attendancePairs = await Promise.all(pageItems.map(async session => {
          const attendance = await getAttendanceBySession(session.id);
          return [session.id, attendance];
        }));
        const attendanceBySession = Object.fromEntries(attendancePairs);

        const rows = pageItems.map(session => {
          const attendance = attendanceBySession[session.id] || [];
          const present = attendance.filter(record => record.status === 'present').length;
          const absent = attendance.filter(record => record.status === 'absent').length;

          return {
            'Date': formatDate(session.date),
            'Present': present,
            'Absent': absent,
            'Total': attendance.length,
            'Actions': () => createButton('Delete', async () => {
              const recordCount = attendance.length;
              const confirmed = await this.confirmAction(
                'Delete attendance session',
                `Delete the session on <strong>${formatDate(session.date)}</strong>? This also removes ${recordCount} attendance record${recordCount === 1 ? '' : 's'}.`,
                { confirmText: 'Delete Session', confirmClassName: 'btn-danger' }
              );
              if (!confirmed) return;

              try {
                await deleteAttendanceSession(session.id);
                showNotification('Attendance session deleted', 'success');
                await loadClassSessions({ resetPage: false });
              } catch (err) {
                console.error('Failed to delete session', err);
                showNotification('Failed to delete session', 'error');
              }
            }, { className: 'btn-danger btn-small' })
          };
        });

        classSessionsContainer.appendChild(createTable(['Date', 'Present', 'Absent', 'Total', 'Actions'], rows));

        const pager = document.createElement('div');
        pager.className = 'session-pager';

        const prev = createButton('Prev', async () => {
          if (currentPage <= 0) return;
          currentPage -= 1;
          await renderClassSessionPage();
        }, { className: 'btn-secondary', disabled: currentPage <= 0 });

        const next = createButton('Next', async () => {
          if (currentPage + 1 >= totalPages) return;
          currentPage += 1;
          await renderClassSessionPage();
        }, { className: 'btn-secondary', disabled: currentPage + 1 >= totalPages });

        const info = document.createElement('div');
        info.className = 'text-muted';
        info.textContent = `Page ${currentPage + 1} of ${totalPages}`;

        pager.append(prev, info, next);
        classSessionsContainer.appendChild(pager);
      };

      const loadClassSessions = async ({ resetPage = true } = {}) => {
        const classId = classSelect.value;
        clearElement(classSessionsContainer);

        if (!classId) {
          classSessions = [];
          classSessionsContainer.innerHTML = '<p class="text-muted">Select a class to review attendance sessions.</p>';
          return;
        }

        if (resetPage) currentPage = 0;
        classSessionsContainer.innerHTML = '<p class="text-muted">Loading sessions...</p>';

        try {
          classSessions = await getSessionsByClass(classId);
          await renderClassSessionPage();
        } catch (err) {
          console.error('Failed to load sessions for class', classId, err);
          classSessionsContainer.innerHTML = '<p class="text-danger">Unable to load sessions.</p>';
        }
      };

      const refreshClassBtn = createButton('Refresh Sessions', () => loadClassSessions({ resetPage: false }), { className: 'btn-secondary' });
      classSelect.addEventListener('change', () => loadClassSessions());

      controls.append(classSelect, refreshClassBtn);
      body.append(controls, classSessionsContainer);
      sessionMgr.appendChild(body);
      tab.appendChild(sessionMgr);

      // General sessions manager (admin-only)
      const generalMgr = document.createElement('div');
      generalMgr.className = 'card mt-lg session-manager-card';
      generalMgr.innerHTML = `<div class="card-header">General (Gathering Place) Sessions</div>`;
      const gbody = document.createElement('div');
      gbody.className = 'card-body';

      const generalContainer = document.createElement('div');
      generalContainer.className = 'session-list-container';

      const loadGeneralSessions = async () => {
        clearElement(generalContainer);
        generalContainer.innerHTML = '<p class="text-muted">Loading general sessions...</p>';

        try {
          const sessions = await getGeneralSessions();
          if (!sessions.length) {
            generalContainer.innerHTML = '<p class="text-muted">No general sessions recorded.</p>';
            return;
          }

          const rows = sessions.map(session => ({
            'Date': formatDate(session.date),
            'Present': session.summaryPresent ?? '-',
            'Absent': session.summaryAbsent ?? '-',
            'Total': session.summaryTotal ?? '-',
            'Actions': () => {
              return createButton('Delete', async () => {
                const confirmed = await this.confirmAction(
                  'Delete general session',
                  `Delete the general attendance session on <strong>${formatDate(session.date)}</strong>?`,
                  { confirmText: 'Delete Session', confirmClassName: 'btn-danger' }
                );
                if (!confirmed) return;

                try {
                  await deleteAttendanceSession(session.id);
                  showNotification('General session deleted', 'success');
                  await loadGeneralSessions();
                } catch (err) {
                  console.error('Failed to delete general session', err);
                  showNotification('Failed to delete session', 'error');
                }
              }, { className: 'btn-danger btn-small' });
            }
          }));

          generalContainer.appendChild(createTable(['Date', 'Present', 'Absent', 'Total', 'Actions'], rows));
        } catch (err) {
          console.error('Failed to load general sessions', err);
          generalContainer.innerHTML = '<p class="text-danger">Unable to load general sessions.</p>';
        }
      };

      const loadGeneralBtn = createButton('Refresh General Sessions', loadGeneralSessions, { className: 'btn-secondary' });
      gbody.appendChild(loadGeneralBtn);
      gbody.appendChild(generalContainer);
      generalMgr.appendChild(gbody);
      tab.appendChild(generalMgr);

      if (this.classes.length === 1) {
        classSelect.value = this.classes[0].id;
        await loadClassSessions();
      }
      await loadGeneralSessions();
    } catch (err) {
      console.error('Failed to attach session management UI:', err);
    }
  }

  async renderGraduationTab() {
    const tab = document.getElementById('graduationTab');
    await renderGraduationTab(tab, this.classes, {
      requireAuth: true,
      isDemoMode: this.isDemoMode,
      emptyStateMessage: 'Graduation readiness is available after signing in as an authenticated admin.'
    });
  }

  showAddUserModal() {
    const nameInput = createInput('text', 'Full Name', 'userName');
    const emailInput = createInput('email', 'Email', 'userEmail');
    const passwordInput = createInput('password', 'Set a login password', 'userPassword');
    const confirmPasswordInput = createInput('password', 'Confirm login password', 'userPasswordConfirm');
    const roleSelect = createSelect([{ label:'Select role...',value:'' },{ label:'Instructor',value:'instructor' },{ label:'Leader',value:'leader' }], 'userRole');
    const classSelect = createSelect([{ label:'No class assigned',value:'' }, ...this.classes.map(c=>({ label:c.name,value:c.id }))], 'userClass');
    const helperText = document.createElement('p');
    helperText.className = 'text-muted';
    helperText.textContent = 'Set the email and password this instructor or leader will use to sign in.';

    emailInput.autocomplete = 'email';
    nameInput.autocomplete = 'name';
    passwordInput.autocomplete = 'new-password';
    confirmPasswordInput.autocomplete = 'new-password';
    passwordInput.minLength = 6;
    confirmPasswordInput.minLength = 6;

    const syncClassSelectState = () => {
      const isInstructor = roleSelect.value === 'instructor';
      classSelect.disabled = !isInstructor;

      if (!isInstructor) {
        classSelect.value = '';
      }
    };

    syncClassSelectState();
    roleSelect.addEventListener('change', syncClassSelectState);

    const form = document.createElement('div');
    form.append(helperText, nameInput, emailInput, passwordInput, confirmPasswordInput, roleSelect, classSelect);
    let modal;
    const createBtn = createButton('Create User', async () => {
      const name = (nameInput.value||'').trim(), email = (emailInput.value||'').trim();
      const password = passwordInput.value, confirmPassword = confirmPasswordInput.value, role = roleSelect.value;
      const assignedClassId = role === 'instructor' ? (classSelect.value || null) : null;
      if (!name || !email || !password || !confirmPassword || !role) { showNotification('Please fill all required fields', 'warning'); return; }
      if (password.length < 6) { showNotification('Password must be at least 6 characters long', 'warning'); return; }
      if (password !== confirmPassword) { showNotification('Passwords do not match', 'warning'); return; }
      try {
        const secondaryApp = getApps().find(a => a.name==='admin-user-creator') || initializeApp(firebaseConfig,'admin-user-creator');
        const secondaryAuth = getAuth(secondaryApp);
        const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        await signOutSecondaryAuth(secondaryAuth);
        await setDoc(doc(db,'users',cred.user.uid), {
          name, email, role,
          assignedClassId,  // FIX Bug 5: standardized field name
          createdAt: serverTimestamp()
        });
        if (assignedClassId) {
          await updateClassInstructor(assignedClassId, cred.user.uid);
        }
        modal.remove();
        await Promise.all([this.loadUsers(), this.loadClasses()]);
        this.renderUsersTab();
        showNotification('User created successfully. They can now sign in with this email and password.','success');
      } catch (err) {
        console.error('Create user failed:',err);

        let message = err.message || 'Unknown error';
        if (err?.code === 'auth/email-already-in-use') {
          message = 'That email is already in use.';
        } else if (err?.code === 'auth/invalid-email') {
          message = 'Please enter a valid email address.';
        } else if (err?.code === 'auth/weak-password') {
          message = 'Password must be at least 6 characters long.';
        }

        showNotification(`Failed to create user: ${message}`,'error');
      }
    });
    const cancelBtn = createButton('Cancel', () => modal.remove());
    modal = createModal('Add New User', form, [createBtn, cancelBtn]);
    document.body.appendChild(modal);
  }
}
