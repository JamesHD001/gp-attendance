// Admin Dashboard Module
// FIX Bug 2: duplicate auth listener at the bottom of the original file removed.

import {
  initializeClasses, getClasses, getAllUsers, createClass,
  updateClassLockStatus, updateClassInstructor, deleteUser, addStudent, getStudents,
  deleteStudent, getUserData, createSession, getGatheringPlaceStats,
  getSessionsByClass, getAttendanceBySession, deleteAttendanceSession
} from './firestore.js';
import { AuthService } from './auth.js';
import { auth, db, firebaseConfig } from '../firebase-config.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signOut as signOutSecondaryAuth } from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js';
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";
import {
  clearElement, showNotification, createTable, createCard,
  createStatCard, createButton, createInput, createSelect,
  createModal, createStatsSkeleton, createTableSkeleton
} from './ui-utils.js';
import { formatDate } from './ui-utils.js';
import { renderAnalyticsTab, displayRandomQuote } from './analytics-utils.js';
import { renderGraduationTab } from './graduation-utils.js';

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

  setupEventListeners() {
    if (this.eventListenersInitialized) return;
    this.eventListenersInitialized = true;

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await AuthService.logout();
    });

    document.querySelectorAll('.tab-btn').forEach(btn =>
      btn.addEventListener('click', (e) => this.switchTab(e.currentTarget.dataset.tab, e)));

    const navLinks = document.querySelectorAll('.nav-link');
    const mapHash = h => ({ overview:'overview', classes:'classes', users:'users', attendance:'students', analytics:'analytics', graduation:'graduation' })[(h||'').replace('#','')] || (h||'').replace('#','');

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
    document.getElementById(`${tabName}Tab`)?.classList.remove('hidden');
    // FIX: null guard for hash/sidebar navigation
    if (event?.target) event.target.classList.add('active');
    if (tabName === 'classes') this.renderClassesTab();
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
      <button class="tab-btn" data-tab="users">Leaders / Instructors</button>
      <button class="tab-btn" data-tab="students">Students</button>
      <button class="tab-btn" data-tab="analytics">Attendance Reports</button>
      <button class="tab-btn" data-tab="graduation">Graduation</button>`;
    main.appendChild(tabNav);
    const tabs = document.createElement('div');
    tabs.innerHTML = `
      <div id="overviewTab" class="tab-content"></div>
      <div id="classesTab" class="tab-content hidden"></div>
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
    const stats = document.createElement('div'); stats.className = 'flex gap-lg flex-wrap';
    stats.appendChild(createStatCard('Classes', this.classes.length));
    stats.appendChild(createStatCard('Leaders/Instructors', this.users.length));
    stats.appendChild(createStatCard('Students', this.students.length));
    tab.appendChild(stats);

    // Motivation quote + simple GP analytics moved to Overview
    const analyticsRow = document.createElement('div');
    analyticsRow.className = 'flex gap-lg mt-lg';

    const quoteCard = document.createElement('div');
    quoteCard.className = 'card';
    const quoteBox = document.createElement('div');
    quoteBox.id = 'adminQuoteBox';
    quoteBox.style.padding = '1rem';
    displayRandomQuote(quoteBox);
    quoteCard.appendChild(quoteBox);

    const gpStatsCard = document.createElement('div');
    gpStatsCard.className = 'card';
    gpStatsCard.style.padding = '1rem';
    gpStatsCard.innerHTML = '<h3>Gathering Place Attendance</h3><div id="gpOverviewStats">Loading...</div>';

    analyticsRow.appendChild(quoteCard);
    analyticsRow.appendChild(gpStatsCard);
    tab.appendChild(analyticsRow);

    // Mark Attendance controls
    const attendRow = document.createElement('div');
    attendRow.className = 'flex-between mt-lg';
    attendRow.innerHTML = `
      <div>
        <button id="markAllAttendanceBtn" class="btn btn-primary">Mark Attendance (All Classes)</button>
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
  }

  async showMarkAttendanceModal() {
    // Modal UI to mark attendance per class; supports cycling through all classes
    const classes = this.classes || [];
    if (!classes.length) { showNotification('No classes available to mark attendance', 'warning'); return; }

    const allStudents = await getStudents();

    let currentIndex = 0;

    const showForClass = async (cls) => {
      const students = allStudents.filter(s => s.classId === cls.id);
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

      const nextBtn = createButton(currentIndex < classes.length - 1 ? 'Save and Next' : 'Save', async () => {
        // collect records
        if (students.length) {
          const records = students.map(st => ({ studentId: st.id, status: document.getElementById(`att_${cls.id}_${st.id}`).checked ? 'present' : 'absent' }));
          try {
            await createSession({ classId: cls.id, date: new Date().toISOString(), records, createdBy: this.currentUser?.uid });
            showNotification(`Saved attendance for ${cls.name}`, 'success');
          } catch (err) {
            console.error('Failed to save attendance for class', cls.id, err);
            showNotification(`Failed to save attendance for ${cls.name}`, 'error');
          }
        }
        modal.remove();
        currentIndex += 1;
        if (currentIndex < classes.length) {
          await showForClass(classes[currentIndex]);
        }
      });

      const cancelBtn = createButton('Cancel', () => { modal.remove(); });
      const modal = createModal(`Mark Attendance — ${cls.name}`, container, [nextBtn, cancelBtn]);
      document.body.appendChild(modal);
    };

    // Start with first class
    await showForClass(classes[currentIndex]);
  }

  getInstructorForClass(classRecord) {
    return this.users.find(user => user.id === classRecord.instructorId)
      || this.users.find(user => user.role === 'instructor' && user.assignedClassId === classRecord.id)
      || null;
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

      return {
        'Class Name': cls.name,
        'Instructor': instructorDisplay,
        'Status': cls.isLocked ? '🔒 Locked' : '🔓 Unlocked',
        'Actions': () => {
          const btn = document.createElement('button');
          btn.className = 'btn btn-small btn-secondary';
          btn.textContent = cls.isLocked ? 'Unlock' : 'Lock';
          btn.addEventListener('click', async () => {
            try { await updateClassLockStatus(cls.id, !cls.isLocked); await this.loadClasses(); this.renderClassesTab(); showNotification('Class updated', 'success'); }
            catch { showNotification('Failed to update class', 'error'); }
          });
          return btn;
        }
      };
    });
    tab.appendChild(createTable(['Class Name', 'Instructor', 'Status', 'Actions'], rows));
    document.getElementById('addClassBtn')?.addEventListener('click', () => this.showAddClassModal());
  }

  showAddClassModal() {
    const nameInput = createInput('text', 'Class Name', 'className');
    const form = document.createElement('div'); form.append(nameInput);
    let modal;
    const createBtn = createButton('Create Class', async () => {
      const name = (nameInput.value || '').trim();
      if (!name) { showNotification('Please provide a class name', 'warning'); return; }
      try { await createClass(name); modal.remove(); await this.loadClasses(); this.renderClassesTab(); showNotification('Class created successfully', 'success'); }
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

  async renderStudentsTab() {
    const tab = document.getElementById('studentsTab'); clearElement(tab);
    const h = document.createElement('div'); h.className = 'flex-between mb-lg';
    h.innerHTML = `<h2>Students</h2><button class="btn btn-primary" id="addStudentBtn">Add Student</button>`;
    tab.appendChild(h);
    if (this.isLoading) {
      tab.appendChild(createTableSkeleton(6, 3));
      return;
    }
    const rows = this.students.map(student => {
      const cls = this.classes.find(c => c.id === student.classId);
      return {
        'Name': student.name, 'Class': cls ? cls.name : 'Unassigned',
        'Actions': () => {
          const btn = document.createElement('button'); btn.className = 'btn btn-danger btn-small'; btn.textContent = 'Delete';
          btn.addEventListener('click', () => {
            const content = document.createElement('div');
            content.innerHTML = `<p>Delete student <strong>${student.name}</strong>? This will permanently remove the student record.</p>`;
            const confirmBtn = createButton('Delete', async () => {
              try { await deleteStudent(student.id); await this.loadStudents(); this.renderStudentsTab(); showNotification('Student deleted', 'success'); }
              catch (err) { console.error(err); showNotification('Failed to delete student', 'error'); }
              modal.remove();
            }, { className: 'btn-danger' });
            const cancelBtn = createButton('Cancel', () => modal.remove());
            const modal = createModal('Confirm delete student', content, [confirmBtn, cancelBtn]);
            document.body.appendChild(modal);
          });
          return btn;
        }
      };
    });
    tab.appendChild(createTable(['Name', 'Class', 'Actions'], rows));
    document.getElementById('addStudentBtn')?.addEventListener('click', () => this.showAddStudentModal());
  }

  showAddStudentModal() {
    const nameInput = createInput('text', 'Student Name', 'studentName');
    const classSelect = createSelect([{ label: 'Select Class...', value: '' }, ...this.classes.map(c => ({ label: c.name, value: c.id }))], 'studentClass');
    const form = document.createElement('div'); form.append(nameInput, classSelect);
    let modal;
    const createBtn = createButton('Add Student', async () => {
      const name = (nameInput.value || '').trim(); const classId = classSelect.value;
      if (!name || !classId) { showNotification('Fill all fields', 'warning'); return; }
      try { await addStudent(name, classId); modal.remove(); await this.loadStudents(); this.renderStudentsTab(); showNotification('Student added', 'success'); }
      catch (err) { console.error(err); showNotification('Failed to add student', 'error'); }
    });
    const cancelBtn = createButton('Cancel', () => modal.remove());
    modal = createModal('Add Student', form, [createBtn, cancelBtn]);
    document.body.appendChild(modal);
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
