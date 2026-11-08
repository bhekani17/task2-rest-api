const statusMessage = document.querySelector('#profileStatus');
const profileForm = document.querySelector('#profileForm');
const passwordForm = document.querySelector('#passwordForm');
const profilePhoto = document.querySelector('#profilePhoto');
const profileInitials = document.querySelector('#profileInitials');
const profilePhotoInput = document.querySelector('#profilePhotoInput');
const removeProfilePhotoButton = document.querySelector('#removeProfilePhotoButton');
const saveProfileButton = document.querySelector('#saveProfileButton');
const changePasswordButton = document.querySelector('#changePasswordButton');
const activeSessionsList = document.querySelector('#activeSessionsList');
const securityAuditLogsList = document.querySelector('#securityAuditLogsList');
let currentUser;

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const result = await response.json();
    if (response.status === 401) {
        window.location.replace('/login');
        throw new Error('Sign in to continue.');
    }
    if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
    return result;
}

function initialsFor(name) {
    return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'SB';
}

function renderPhoto(hasPhoto) {
    profilePhoto.hidden = !hasPhoto;
    profileInitials.hidden = hasPhoto;
    removeProfilePhotoButton.hidden = !hasPhoto;
    profilePhoto.src = hasPhoto ? `/api/auth/profile/photo?updated=${Date.now()}` : '';
}

function renderProfile(user) {
    currentUser = user;
    profileForm.elements.name.value = user.name;
    profileForm.elements.email.value = user.email;
    profileForm.elements.currentPassword.value = '';
    document.querySelector('#profileDisplayName').textContent = user.name;
    document.querySelector('#profileRole').textContent = user.role;
    document.querySelector('#profileInitials').textContent = initialsFor(user.name);
    document.querySelector('#profileCustomerId').textContent = user.id ?? '—';
    document.querySelector('#profileAccountStatus').textContent = user.status;
    document.querySelector('#profileAccountNumber').textContent =
        user.role === 'admin' ? 'Not applicable (Administrator)' : (user.accountNumber || '—');
    document.querySelector('#adminNavigationGroup').hidden = user.role !== 'admin';
    for (const link of document.querySelectorAll('.investment-nav-link')) {
        link.hidden = user.role === 'admin';
    }
    renderPhoto(user.hasProfilePhoto);
}

async function loadSessionsAndAuditLogs() {
    try {
        const [sessionsResult, logsResult] = await Promise.all([
            requestJson('/api/auth/sessions'),
            requestJson('/api/auth/audit-logs')
        ]);

        if (activeSessionsList) {
            activeSessionsList.replaceChildren();
            const sessions = sessionsResult.sessions || [];
            if (!sessions.length) {
                const empty = document.createElement('p');
                empty.className = 'empty-state';
                empty.textContent = 'No active sessions found.';
                activeSessionsList.append(empty);
            }
            for (const session of sessions) {
                const card = document.createElement('article');
                card.className = 'account-card';
                const meta = document.createElement('span');
                meta.className = 'account-owner';
                meta.textContent = `${session.current ? 'CURRENT SESSION' : 'ACTIVE SESSION'} · ${session.ipAddress}`;
                const agent = document.createElement('span');
                agent.className = 'account-number';
                agent.textContent = `${session.userAgent.slice(0, 72)} · Signed in ${new Date(session.createdAt).toLocaleString()}`;
                card.append(meta, agent);
                if (!session.current) {
                    const revokeBtn = document.createElement('button');
                    revokeBtn.type = 'button';
                    revokeBtn.className = 'filter-button';
                    revokeBtn.textContent = 'Revoke session';
                    revokeBtn.addEventListener('click', async () => {
                        try {
                            const res = await requestJson(`/api/auth/sessions/${session.id}`, { method: 'DELETE' });
                            statusMessage.textContent = res.message;
                            await loadSessionsAndAuditLogs();
                        } catch (error) {
                            statusMessage.textContent = error.message;
                        }
                    });
                    card.append(revokeBtn);
                }
                activeSessionsList.append(card);
            }
        }

        if (securityAuditLogsList) {
            securityAuditLogsList.replaceChildren();
            const logs = logsResult.logs || [];
            if (!logs.length) {
                const empty = document.createElement('p');
                empty.className = 'empty-state';
                empty.textContent = 'No recent security activity recorded.';
                securityAuditLogsList.append(empty);
            }
            for (const entry of logs.slice(0, 10)) {
                const card = document.createElement('article');
                card.className = 'account-card';
                const meta = document.createElement('span');
                meta.className = 'account-owner';
                meta.textContent = `${entry.action.replaceAll('_', ' ').toUpperCase()} · ${new Date(entry.createdAt).toLocaleString()}`;
                const detail = document.createElement('span');
                detail.className = 'account-number';
                detail.textContent = `${entry.detail}${entry.ipAddress ? ` (${entry.ipAddress})` : ''}`;
                card.append(meta, detail);
                securityAuditLogsList.append(card);
            }
        }
    } catch {
        // Ignore non-fatal security log loading errors
    }
}

async function loadProfile() {
    try {
        const result = await requestJson('/api/auth/me');
        renderProfile(result.user);
        await loadSessionsAndAuditLogs();
    } catch (error) {
        statusMessage.textContent = error.message;
    }
}

profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentUser) return;
    saveProfileButton.disabled = true;
    statusMessage.textContent = 'Saving profile...';
    try {
        const result = await requestJson('/api/auth/profile', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: profileForm.elements.name.value,
                email: profileForm.elements.email.value,
                currentPassword: profileForm.elements.currentPassword.value
            })
        });
        renderProfile(result.user);
        statusMessage.textContent = result.message;
    } catch (error) {
        statusMessage.textContent = error.message;
    } finally {
        saveProfileButton.disabled = false;
    }
});

document.querySelector('#cancelProfileButton').addEventListener('click', () => {
    if (currentUser) renderProfile(currentUser);
});

passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const newPassword = passwordForm.elements.newPassword.value;
    if (newPassword !== passwordForm.elements.confirmPassword.value) {
        statusMessage.textContent = 'The new password and confirmation do not match.';
        return;
    }
    changePasswordButton.disabled = true;
    statusMessage.textContent = 'Updating password...';
    try {
        const result = await requestJson('/api/auth/password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentPassword: passwordForm.elements.currentPassword.value,
                newPassword
            })
        });
        passwordForm.reset();
        statusMessage.textContent = result.message;
    } catch (error) {
        statusMessage.textContent = error.message;
    } finally {
        changePasswordButton.disabled = false;
    }
});

profilePhotoInput.addEventListener('change', async () => {
    const [file] = profilePhotoInput.files || [];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        statusMessage.textContent = 'Choose a JPEG, PNG, or WebP image.';
        profilePhotoInput.value = '';
        return;
    }
    if (file.size > 2 * 1024 * 1024) {
        statusMessage.textContent = 'Profile photos must be 2 MB or smaller.';
        profilePhotoInput.value = '';
        return;
    }
    statusMessage.textContent = 'Uploading profile photo...';
    try {
        const result = await requestJson('/api/auth/profile/photo', {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: file
        });
        renderPhoto(true);
        if (currentUser) currentUser.hasProfilePhoto = true;
        statusMessage.textContent = result.message;
    } catch (error) {
        statusMessage.textContent = error.message;
    } finally {
        profilePhotoInput.value = '';
    }
});

removeProfilePhotoButton.addEventListener('click', async () => {
    removeProfilePhotoButton.disabled = true;
    try {
        const result = await requestJson('/api/auth/profile/photo', { method: 'DELETE' });
        renderPhoto(false);
        if (currentUser) currentUser.hasProfilePhoto = false;
        statusMessage.textContent = result.message;
    } catch (error) {
        statusMessage.textContent = error.message;
    } finally {
        removeProfilePhotoButton.disabled = false;
    }
});

const themeToggle = document.querySelector('#themeToggle');
function applyTheme() {
    const isDark = localStorage.getItem('theme') === 'dark';
    document.body.classList.toggle('dark-theme', isDark);
    if (themeToggle) themeToggle.textContent = isDark ? 'Light' : 'Dark';
}
themeToggle?.addEventListener('click', () => {
    const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
    localStorage.setItem('theme', nextTheme);
    applyTheme();
});
applyTheme();
document.querySelector('#logoutButton').addEventListener('click', async () => {
    try {
        await requestJson('/api/auth/logout', { method: 'POST' });
        window.location.replace('/login');
    } catch (error) {
        statusMessage.textContent = error.message;
    }
});

loadProfile();
