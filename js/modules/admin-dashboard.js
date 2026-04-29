// Admin Dashboard Module
// FIX Bug 2: duplicate auth listener at the bottom of the original file removed.

import {
  initializeClasses, getClasses, getAllUsers, createClass,
  updateClassLockStatus, updateClassInstructor, deleteUser, addStudent, getStudents,
  deleteStudent
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
import { renderAnalyticsTab } from './analytics-utils.js';
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
      await AuthService.logout(); window.location.href = '../index.html';
    });

    document.querySelectorAll('.tab-btn').forEach(btn =>
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab, e)));

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
      const instructor = this.getInstructorForClass(cls);
      return {
        'Class Name': cls.name,
        'Instructor': instructor ? instructor.name : 'Unassigned',
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
      // FIX Bug 5: only use assignedClassId
      'Class': user.assignedClassId || '—',
      'Actions': () => {
        const btn = document.createElement('button'); btn.className = 'btn btn-danger btn-small'; btn.textContent = 'Delete';
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this user?')) return;
          try { await deleteUser(user.id); await this.loadUsers(); this.renderUsersTab(); showNotification('User deleted', 'success'); }
          catch { showNotification('Failed to delete user', 'error'); }
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
          btn.addEventListener('click', async () => {
            if (!confirm('Delete student?')) return;
            await deleteStudent(student.id); await this.loadStudents(); this.renderStudentsTab();
            showNotification('Student deleted', 'success');
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
    const passwordInput = createInput('password', 'Temporary Password', 'userPassword');
    const roleSelect = createSelect([{ label:'Select role...',value:'' },{ label:'Instructor',value:'instructor' },{ label:'Leader',value:'leader' }], 'userRole');
    const classSelect = createSelect([{ label:'No Class',value:'' }, ...this.classes.map(c=>({ label:c.name,value:c.id }))], 'userClass');
    const form = document.createElement('div'); form.append(nameInput, emailInput, passwordInput, roleSelect, classSelect);
    let modal;
    const createBtn = createButton('Create User', async () => {
      const name = (nameInput.value||'').trim(), email = (emailInput.value||'').trim();
      const password = passwordInput.value, role = roleSelect.value;
      const assignedClassId = role === 'instructor' ? (classSelect.value || null) : null;
      if (!name || !email || !password || !role) { showNotification('Please fill all required fields', 'warning'); return; }
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
        showNotification('User created successfully','success');
      } catch (err) { console.error('Create user failed:',err); showNotification(`Failed to create user: ${err.message||'Unknown error'}`,'error'); }
    });
    const cancelBtn = createButton('Cancel', () => modal.remove());
    modal = createModal('Add New User', form, [createBtn, cancelBtn]);
    document.body.appendChild(modal);
  }
}
