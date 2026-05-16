// Admin Dashboard Module
// FIX Bug 2: duplicate auth listener at the bottom of the original file removed.

import {
  initializeClasses, getClasses, getAllUsers, createClass,
  updateClassLockStatus, updateClassInstructor, deleteUser, addStudent, getStudents, getStudentsByClass,
  deleteStudent, getUserData, createSession, getGatheringPlaceStats,
  getSessionsByClass, getAttendanceBySession, deleteAttendanceSession, getGeneralSessions, updateStudent,
  ensureGeneralClasses, bulkAssignStudentsToClass, bulkRemoveStudentsFromClass,
  studentHasClass, getStudentMembershipType
} from './firestore.js';
import { AuthService } from './auth.js';
import { auth, db, firebaseConfig } from '../firebase-config.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signOut as signOutSecondaryAuth } from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js';
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
    this.eventListenersInitialized = false;
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
      try {
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
        await initializeClasses();
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
    this.eventListenersInitialized = false;
    this.setupEventListeners();
  }

  async loadClasses() {
    try { this.classes = await getClasses(); }
    catch (e) { console.error(e); showNotification('Failed to load classes', 'error'); }
  }
  async loadUsers() {
    try { this.users = await getAllUsers(); }
    catch (e) { console.error(e); }
  }
  async loadStudents() {
    try { this.students = await getStudents(); }
    catch (e) { console.error(e); }
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
    if (this.currentTab === 'users') { this.renderUsersTab(); return; }
    if (this.currentTab === 'students') { this.renderStudentsTab(); return; }
    if (this.currentTab === 'manage') { this.renderManageClassesStudentsTab(); return; }
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

    document.querySelectorAll('.tab-btn').forEach(btn =>
      btn.addEventListener('click', (e) => this.switchTab(e.currentTarget.dataset.tab, e)));

    const navLinks = document.querySelectorAll('.nav-link');
    const mapHash = h => ({ overview:'overview', classes:'classes', manage:'manage', users:'users', attendance:'students', analytics:'analytics', graduation:'graduation' })[(h||'').replace('#','')] || (h||'').replace('#','');

    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const t = mapHash(link.getAttribute('href')||''); if(!t) return;
        navLinks.forEach(n => n.classList.remove('active')); link.classList.add('active');
        const btn = document.querySelector(`.tab-btn[data-tab="${t}"]`);
        if(btn) btn.click(); else this.switchTab(t, null);
        try { history.replaceState(null, '', link.getAttribute('href')); } catch(e) {}
      });
    });

    window.addEventListener('hashchange', () => {
      const t = mapHash(location.hash); if(!t) return;
      const btn = document.querySelector(`.tab-btn[data-tab="${t}"]`);
      if(btn) btn.click(); else this.switchTab(t, null);
    });

    if (location.hash) {
      const t = mapHash(location.hash);
      if(t) { const btn = document.querySelector(`.tab-btn[data-tab="${t}"]`); if(btn) btn.click(); else this.switchTab(t,null); }
    }
  }

  switchTab(tabName, event) {
    if (this.currentTab === tabName) return;
    this.currentTab = tabName;
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const targetTabEl = document.getElementById(`${tabName}Tab`);
    if (targetTabEl) {
      clearElement(targetTabEl);
      let skeletonEl = createTabSkeleton();
      if (tabName === 'classes') skeletonEl = createClassesSkeleton();
      if (tabName === 'manage') skeletonEl = createStudentsSkeleton();
      if (tabName === 'users') skeletonEl = createUsersSkeleton();
      if (tabName === 'students') skeletonEl = createStudentsSkeleton();
      if (tabName === 'attendance') skeletonEl = createAttendanceSkeleton();
      if (tabName === 'analytics') skeletonEl = createAnalyticsSkeleton();
      if (tabName === 'graduation') skeletonEl = createGraduationSkeleton();
      targetTabEl.appendChild(skeletonEl);
      targetTabEl.classList.remove('hidden');
    }
    // FIX: null guard for hash/sidebar navigation
    if (event?.target) event.target.classList.add('active');
    if (tabName === 'classes') this.renderClassesTab();
    if (tabName === 'manage') this.renderManageClassesStudentsTab();
    if (tabName === 'users') this.renderUsersTab();
    if (tabName === 'students') this.renderStudentsTab();
    if (tabName === 'analytics') this.renderAnalyticsTab();
    if (tabName === 'graduation') this.renderGraduationTab();
  }

  renderDashboard() {
    const main = document.querySelector('.main-content');
    clearElement(main);
    const header = document.createElement('div');
    header.className = 'flex-between mb-xl';
    header.innerHTML = `<div><h1>GP Attendance Admin</h1><p class="text-muted">Manage gathering place classes, users, and students</p></div><button id="logoutBtn" class="btn btn-secondary">Logout</button>`;
    main.appendChild(header);
    const tabNav = document.createElement('div');
    tabNav.className = 'tab-navigation mb-lg';
    tabNav.innerHTML = `
      <button class="tab-btn active" data-tab="overview">Overview</button>
      <button class="tab-btn" data-tab="classes">Classes</button>
      <button class="tab-btn" data-tab="manage">Class Management</button>
      <button class="tab-btn" data-tab="users">Leaders / Instructors</button>
      <button class="tab-btn" data-tab="students">Students</button>
      <button class="tab-btn" data-tab="analytics">Attendance Reports</button>
      <button class="tab-btn" data-tab="graduation">Graduation</button>`;
    main.appendChild(tabNav);
    const tabs = document.createElement('div');
    tabs.innerHTML = `
      <div id="overviewTab" class="tab-content"></div>
      <div id="classesTab" class="tab-content hidden"></div>
      <div id="manageTab" class="tab-content hidden"></div>
      <div id="usersTab" class="tab-content hidden"></div>
      <div id="studentsTab" class="tab-content hidden"></div>
      <div id="analyticsTab" class="tab-content hidden"></div>
      <div id="graduationTab" class="tab-content hidden"></div>`;
    main.appendChild(tabs);
    this.renderOverviewTab();
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

          wrap.append(viewBtn, lockBtn);
          return wrap;
        }
      };
    });
    tab.appendChild(createTable(['Class Name', 'Type', 'Instructor', 'Participants', 'Status', 'Actions'], rows));
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

  renderManageClassesStudentsTab() {
    const tab = document.getElementById('manageTab');
    clearElement(tab);

    const header = document.createElement('div');
    header.className = 'flex-between mb-lg';
    header.innerHTML = `
      <div>
        <h2>Class Management</h2>
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
    tab.appendChild(header);

    if (this.isLoading) {
      tab.appendChild(createTableSkeleton(6, 6));
      return;
    }

    if (!this.classes.length) {
      const empty = document.createElement('p');
      empty.className = 'text-muted';
      empty.textContent = 'No classes available yet. Create a class to start managing student assignments.';
      tab.appendChild(empty);
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
      this.renderManageClassesStudentsTab();
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
      this.renderManageClassesStudentsTab();
    }, { className: 'btn-secondary' });

    const clearSelectionBtn = createButton('Clear Selection', () => {
      this.manageSelectedStudentIds.clear();
      this.renderManageClassesStudentsTab();
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
        this.renderManageClassesStudentsTab();
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
        this.renderManageClassesStudentsTab();
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
        this.renderManageClassesStudentsTab();
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
    tab.appendChild(controlsCard);

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
            this.renderManageClassesStudentsTab();
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
                this.renderManageClassesStudentsTab();
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
      tab.appendChild(createTable(['Select', 'Name', 'Class Role', 'Primary Class', 'Shared Classes', 'Email', 'Actions'], rosterRows));
    } else {
      const empty = document.createElement('p');
      empty.className = 'text-muted';
      empty.textContent = `No students are currently assigned to ${selectedClass.name}.`;
      tab.appendChild(empty);
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
        this.renderManageClassesStudentsTab();
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
        this.renderManageClassesStudentsTab();
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
        this.renderManageClassesStudentsTab();
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
    tab.appendChild(allStudentsCard);
  }

  async renderAnalyticsTab() {
    const tab = document.getElementById('analyticsTab');
    await renderAnalyticsTab(tab, this.classes, {
      requireAuth: true,
      isDemoMode: this.isDemoMode,
      emptyStateMessage: 'Attendance analytics is available after signing in as an authenticated admin.'
    });

    // Add admin-only session management UI beneath analytics
    try {
      const sessionMgr = document.createElement('div');
      sessionMgr.className = 'card mt-lg';
      sessionMgr.innerHTML = `<div class="card-header">Session Management</div>`;

      const body = document.createElement('div');
      body.className = 'card-body';

      const classSelect = createSelect([
        { label: 'Select Class...', value: '' },
        ...this.classes.map(c => ({ label: c.name, value: c.id }))
      ], 'adminSessionClassSelect');

      const loadBtn = createButton('Load Sessions', async () => {
        const classId = classSelect.value;
        const container = document.getElementById('adminSessionsContainer');
        clearElement(container);
        if (!classId) { container.innerHTML = '<p class="text-muted">Select a class to load sessions.</p>'; return; }
        container.innerHTML = '<p class="text-muted">Loading sessions...</p>';
        try {
          const sessions = await getSessionsByClass(classId);
          if (!sessions.length) { container.innerHTML = '<p class="text-muted">No sessions recorded for this class.</p>'; return; }

          // Pagination
          const pageSize = 10;
          let currentPage = 0;

          const renderPage = async () => {
            clearElement(container);
            const start = currentPage * pageSize;
            const pageItems = sessions.slice(start, start + pageSize);
            const rows = [];
            for (const s of pageItems) {
              const attendance = await getAttendanceBySession(s.id);
              rows.push({
                'Date': formatDate(s.date),
                'Present': attendance.filter(a => a.status === 'present').length,
                'Total': attendance.length,
                'Actions': () => {
                  const del = createButton('Delete', () => {
                    const content = document.createElement('div');
                    content.innerHTML = `<p>Delete session on <strong>${formatDate(s.date)}</strong>? This will remove attendance records.</p>`;
                    const confirmBtn = createButton('Delete', async () => {
                      try {
                        await deleteAttendanceSession(s.id);
                        showNotification('Session deleted', 'success');
                        // reload sessions and re-render
                        const refreshed = await getSessionsByClass(classId);
                        sessions.length = 0; sessions.push(...refreshed);
                        if (currentPage > Math.floor((sessions.length - 1) / pageSize)) currentPage = Math.max(0, Math.floor((sessions.length - 1) / pageSize));
                        await renderPage();
                      } catch (err) {
                        console.error('Failed to delete session', err);
                        showNotification('Failed to delete session', 'error');
                      }
                      modal.remove();
                    }, { className: 'btn-danger' });
                    const cancelBtn = createButton('Cancel', () => modal.remove());
                    const modal = createModal('Confirm delete session', content, [confirmBtn, cancelBtn]);
                    document.body.appendChild(modal);
                  }, { className: 'btn-danger btn-small' });
                  return del;
                }
              });
            }

            container.appendChild(createTable(['Date', 'Present', 'Total', 'Actions'], rows));

            const pager = document.createElement('div');
            pager.className = 'flex gap-md mt-md';
            const prev = createButton('Prev', async () => { if (currentPage > 0) { currentPage -= 1; await renderPage(); } }, { className: 'btn-secondary' });
            const next = createButton('Next', async () => { if ((currentPage + 1) * pageSize < sessions.length) { currentPage += 1; await renderPage(); } }, { className: 'btn-secondary' });
            const info = document.createElement('div'); info.className = 'text-muted'; info.textContent = `Page ${currentPage + 1} of ${Math.max(1, Math.ceil(sessions.length / pageSize))}`;
            pager.append(prev, info, next);
            container.appendChild(pager);
          };

          await renderPage();
        } catch (err) {
          console.error('Failed to load sessions for class', classId, err);
          container.innerHTML = '<p class="text-danger">Unable to load sessions.</p>';
        }
      });

      body.appendChild(classSelect);
      body.appendChild(loadBtn);
      body.appendChild(document.createElement('div')).id = 'adminSessionsContainer';
      sessionMgr.appendChild(body);
      tab.appendChild(sessionMgr);
      // General sessions manager (admin-only)
      const generalMgr = document.createElement('div');
      generalMgr.className = 'card mt-lg';
      generalMgr.innerHTML = `<div class="card-header">General (Gathering Place) Sessions</div>`;
      const gbody = document.createElement('div');
      gbody.className = 'card-body';

      const loadGeneralBtn = createButton('Load General Sessions', async () => {
        const container = document.getElementById('adminGeneralSessionsContainer');
        clearElement(container);
        container.innerHTML = '<p class="text-muted">Loading general sessions...</p>';
        try {
          const sessions = await getGeneralSessions();
          if (!sessions.length) { container.innerHTML = '<p class="text-muted">No general sessions recorded.</p>'; return; }

          const rows = sessions.map(s => ({
            'Date': formatDate(s.date),
            'Present': s.summaryPresent ?? '-',
            'Absent': s.summaryAbsent ?? '-',
            'Total': s.summaryTotal ?? '-',
            'Actions': () => {
              const del = createButton('Delete', () => {
                const content = document.createElement('div');
                content.innerHTML = `<p>Delete general session on <strong>${formatDate(s.date)}</strong>? This will remove the session record.</p>`;
                const confirmBtn = createButton('Delete', async () => {
                  try {
                    await deleteAttendanceSession(s.id);
                    showNotification('Session deleted', 'success');
                    // Reload list
                    loadGeneralBtn.click();
                  } catch (err) {
                    console.error('Failed to delete general session', err);
                    showNotification('Failed to delete session', 'error');
                  }
                  modal.remove();
                }, { className: 'btn-danger' });
                const cancelBtn = createButton('Cancel', () => modal.remove());
                const modal = createModal('Confirm delete session', content, [confirmBtn, cancelBtn]);
                document.body.appendChild(modal);
              }, { className: 'btn-danger btn-small' });
              return del;
            }
          }));

          container.appendChild(createTable(['Date', 'Present', 'Absent', 'Total', 'Actions'], rows));
        } catch (err) {
          console.error('Failed to load general sessions', err);
          container.innerHTML = '<p class="text-danger">Unable to load general sessions.</p>';
        }
      });

      gbody.appendChild(loadGeneralBtn);
      const generalContainer = document.createElement('div');
      generalContainer.id = 'adminGeneralSessionsContainer';
      gbody.appendChild(generalContainer);
      generalMgr.appendChild(gbody);
      tab.appendChild(generalMgr);
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
