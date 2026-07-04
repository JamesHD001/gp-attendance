import { AuthService } from './auth.js';
import { updateUser } from './firestore.js';
import { getThemePreference, toggleTheme } from './theme.js';
import {
  clearElement,
  createButton,
  createInput,
  createModal,
  createTabSkeleton,
  showNotification
} from './ui-utils.js';

function buildProfileSnapshot(profile = {}, currentUser = null) {
  return {
    name: profile?.name || currentUser?.displayName || '',
    email: profile?.email || currentUser?.email || '',
    phoneNumber: profile?.phoneNumber || '',
    address: profile?.address || '',
    role: profile?.role || '',
    signInMethod: AuthService.hasPasswordProvider(currentUser)
      ? 'Email/password'
      : (AuthService.hasGoogleProvider(currentUser) ? 'Google' : 'Unknown')
  };
}

function appendMetaItem(container, label, value) {
  const item = document.createElement('div');
  item.className = 'settings-meta-item';

  const labelEl = document.createElement('span');
  labelEl.className = 'settings-meta-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.textContent = value || '—';

  item.append(labelEl, valueEl);
  container.appendChild(item);
}

function createSettingsCard(title) {
  const card = document.createElement('section');
  card.className = 'card settings-card';
  card.innerHTML = `<div class="card-header">${title}</div>`;
  const body = document.createElement('div');
  body.className = 'card-body settings-card-body';
  card.appendChild(body);
  return { card, body };
}

function createSettingsField(label, input) {
  const group = document.createElement('div');
  group.className = 'settings-field';

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.setAttribute('for', input.id || '');

  group.append(labelEl, input);
  return group;
}

async function saveProfileUpdate(options, nextProfile) {
  const { currentUser, isDemoMode = false, onProfileUpdated } = options;

  if (isDemoMode) {
    await onProfileUpdated?.(nextProfile);
    return;
  }

  await updateUser(currentUser.uid, {
    name: nextProfile.name,
    phoneNumber: nextProfile.phoneNumber,
    address: nextProfile.address
  });

  await onProfileUpdated?.(nextProfile);
}

async function saveEmailUpdate(options, nextEmail, currentPassword = '') {
  const { currentUser, profileSnapshot, isDemoMode = false, onProfileUpdated } = options;

  if (isDemoMode) {
    await onProfileUpdated?.({ ...profileSnapshot, email: nextEmail });
    return;
  }

  await AuthService.changeEmail(nextEmail, { currentPassword });
  await updateUser(currentUser.uid, { email: nextEmail });
  await onProfileUpdated?.({ ...profileSnapshot, email: nextEmail });
}

export async function renderSettingsTab(targetTab, options = {}) {
  if (!targetTab) return;

  const {
    title = 'Settings',
    description = 'Manage your profile, email, appearance, and password from one place.',
    currentUser = null,
    profile = null,
    isLoading = false,
    isDemoMode = false
  } = options;

  clearElement(targetTab);

  const header = document.createElement('div');
  header.className = 'dashboard-content-header settings-header mb-lg';
  header.innerHTML = `
    <div>
      <h2>${title}</h2>
      <p class="text-muted">${description}</p>
    </div>
  `;
  targetTab.appendChild(header);

  if (isLoading) {
    targetTab.appendChild(createTabSkeleton({ statsCount: 1, tableRows: 4, tableColumns: 2, showQuote: false }));
    return;
  }

  const profileSnapshot = buildProfileSnapshot(profile, currentUser);
  const settingsGrid = document.createElement('div');
  settingsGrid.className = 'settings-grid';

  const profileCard = createSettingsCard('Profile');
  const profileNote = document.createElement('p');
  profileNote.className = 'text-muted';
  profileNote.textContent = 'Update the name and contact details stored on your account.';

  const profileMeta = document.createElement('div');
  profileMeta.className = 'settings-meta';
  appendMetaItem(profileMeta, 'Role', profileSnapshot.role || '—');
  appendMetaItem(profileMeta, 'Sign-in', profileSnapshot.signInMethod);

  const profileForm = document.createElement('div');
  profileForm.className = 'settings-form';

  const nameInput = createInput('text', 'Full name', 'settingsName', { value: profileSnapshot.name });
  const phoneInput = createInput('text', 'Phone number', 'settingsPhone', { value: profileSnapshot.phoneNumber });
  const addressInput = createInput('text', 'Address', 'settingsAddress', { value: profileSnapshot.address });

  profileForm.append(
    createSettingsField('Full name', nameInput),
    createSettingsField('Phone number', phoneInput),
    createSettingsField('Address', addressInput)
  );

  const profileActions = document.createElement('div');
  profileActions.className = 'settings-actions';

  const saveProfileBtn = createButton('Save profile', async () => {
    const nextName = String(nameInput.value || '').trim();
    const nextPhone = String(phoneInput.value || '').trim();
    const nextAddress = String(addressInput.value || '').trim();

    if (!nextName) {
      showNotification('Name is required', 'warning');
      return;
    }

    if (!currentUser?.uid) {
      showNotification('Unable to identify the current user', 'error');
      return;
    }

    saveProfileBtn.disabled = true;

    try {
      const nextProfile = {
        ...profileSnapshot,
        name: nextName,
        phoneNumber: nextPhone,
        address: nextAddress
      };

      await saveProfileUpdate(options, nextProfile);
      showNotification(isDemoMode ? 'Profile updated in local demo mode' : 'Profile updated successfully', 'success');
    } catch (error) {
      console.error('Failed to update profile:', error);
      showNotification(error?.message || 'Failed to update profile', 'error');
    } finally {
      saveProfileBtn.disabled = false;
    }
  }, { className: 'btn-primary' });

  profileActions.appendChild(saveProfileBtn);
  profileCard.body.append(profileNote, profileMeta, profileForm, profileActions);

  const emailCard = createSettingsCard('Account Email');
  const emailNote = document.createElement('p');
  emailNote.className = 'text-muted';
  emailNote.textContent = AuthService.hasPasswordProvider(currentUser)
    ? 'Updating your email requires your current password.'
    : 'Updating your email will re-authenticate with Google before saving.';

  const emailForm = document.createElement('div');
  emailForm.className = 'settings-form';

  const emailInput = createInput('email', 'Email address', 'settingsEmail', { value: profileSnapshot.email });
  emailForm.append(createSettingsField('Email address', emailInput));

  const currentPasswordInput = AuthService.hasPasswordProvider(currentUser)
    ? createInput('password', 'Current password', 'settingsCurrentPassword')
    : null;

  if (currentPasswordInput) {
    emailForm.append(currentPasswordInput);
  }

  const emailActions = document.createElement('div');
  emailActions.className = 'settings-actions';

  const saveEmailBtn = createButton('Update email', async () => {
    const nextEmail = String(emailInput.value || '').trim();

    if (!nextEmail) {
      showNotification('Email address is required', 'warning');
      return;
    }

    if (nextEmail === profileSnapshot.email) {
      showNotification('Email address is unchanged', 'warning');
      return;
    }

    if (!currentUser?.uid) {
      showNotification('Unable to identify the current user', 'error');
      return;
    }

    saveEmailBtn.disabled = true;

    try {
      await saveEmailUpdate(options, nextEmail, currentPasswordInput?.value || '');
      showNotification(isDemoMode ? 'Email updated in local demo mode' : 'Email updated successfully', 'success');
    } catch (error) {
      console.error('Failed to update email:', error);
      showNotification(error?.message || 'Failed to update email', 'error');
    } finally {
      saveEmailBtn.disabled = false;
    }
  }, { className: 'btn-primary' });

  emailActions.appendChild(saveEmailBtn);
  emailCard.body.append(emailNote, emailForm, emailActions);

  const appearanceCard = createSettingsCard('Appearance');
  const themeStatus = document.createElement('p');
  themeStatus.className = 'settings-status';

  const themeNote = document.createElement('p');
  themeNote.className = 'text-muted';
  themeNote.textContent = 'Theme preference is saved in your browser and applies across the login page and dashboards.';

  const updateThemeControl = (themeName) => {
    const isDark = themeName === 'dark';
    themeStatus.textContent = isDark ? 'Dark mode is active.' : 'Light mode is active.';
    themeButton.textContent = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    themeButton.setAttribute('aria-label', themeButton.textContent);
  };

  const themeButton = createButton(getThemePreference() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', () => {
    const nextTheme = toggleTheme({ animate: true });
    updateThemeControl(nextTheme);
    showNotification(`Switched to ${nextTheme} mode`, 'success');
  }, { className: 'btn-secondary settings-theme-button' });
  themeButton.type = 'button';

  updateThemeControl(getThemePreference());
  appearanceCard.body.append(themeStatus, themeNote, themeButton);

  const securityCard = createSettingsCard('Security');
  const securityNote = document.createElement('p');
  securityNote.className = 'text-muted';

  if (AuthService.hasPasswordProvider(currentUser)) {
    securityNote.textContent = 'Change the password used to sign in with email and password.';

    const passwordForm = document.createElement('div');
    passwordForm.className = 'settings-form';

    const currentPassword = createInput('password', 'Current password', 'settingsPasswordCurrent');
    const newPassword = createInput('password', 'New password', 'settingsPasswordNew');
    const confirmPassword = createInput('password', 'Confirm new password', 'settingsPasswordConfirm');

    passwordForm.append(
      createSettingsField('Current password', currentPassword),
      createSettingsField('New password', newPassword),
      createSettingsField('Confirm new password', confirmPassword)
    );

    const securityActions = document.createElement('div');
    securityActions.className = 'settings-actions';

    const updatePasswordBtn = createButton('Update password', async () => {
      const currentPasswordValue = String(currentPassword.value || '');
      const nextPasswordValue = String(newPassword.value || '');
      const confirmPasswordValue = String(confirmPassword.value || '');

      if (!currentPasswordValue || !nextPasswordValue || !confirmPasswordValue) {
        showNotification('Please complete all password fields', 'warning');
        return;
      }

      if (nextPasswordValue.length < 6) {
        showNotification('New password must be at least 6 characters long', 'warning');
        return;
      }

      if (nextPasswordValue !== confirmPasswordValue) {
        showNotification('New password and confirmation do not match', 'warning');
        return;
      }

      updatePasswordBtn.disabled = true;

      try {
        if (!isDemoMode) {
          await AuthService.changePassword(currentPasswordValue, nextPasswordValue);
        }

        showNotification(isDemoMode ? 'Password updated in local demo mode' : 'Password updated successfully', 'success');
      } catch (error) {
        console.error('Failed to update password:', error);
        showNotification(error?.message || 'Failed to update password', 'error');
      } finally {
        updatePasswordBtn.disabled = false;
      }
    }, { className: 'btn-primary' });

    securityActions.appendChild(updatePasswordBtn);
    securityCard.body.append(securityNote, passwordForm, securityActions);
  } else {
    securityNote.textContent = 'This account uses Google sign-in, so there is no local password to change here.';
    securityCard.body.append(securityNote);
  }

  settingsGrid.append(profileCard.card, emailCard.card, appearanceCard.card, securityCard.card);
  targetTab.appendChild(settingsGrid);
}
