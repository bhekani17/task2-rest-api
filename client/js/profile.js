const statusMessage = document.querySelector('#profileStatus');
const profileForm = document.querySelector('#profileForm');
const passwordForm = document.querySelector('#passwordForm');
const profilePhoto = document.querySelector('#profilePhoto');
const profileInitials = document.querySelector('#profileInitials');
const profilePhotoInput = document.querySelector('#profilePhotoInput');
const removeProfilePhotoButton = document.querySelector('#removeProfilePhotoButton');
const saveProfileButton = document.querySelector('#saveProfileButton');
const changePasswordButton = document.querySelector('#changePasswordButton');
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
    document.querySelector('#profileAccountNumber').textContent = user.accountNumber || '—';
    document.querySelector('#adminNavigationGroup').hidden = user.role !== 'admin';
    for (const link of document.querySelectorAll('.investment-nav-link')) {
        link.hidden = user.role === 'admin';
    }
    renderPhoto(user.hasProfilePhoto);
}

async function loadProfile() {
    try {
        const result = await requestJson('/api/auth/me');
        renderProfile(result.user);
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

document.querySelector('#themeToggle').addEventListener('click', (event) => {
    const isDark = document.body.classList.toggle('dark-theme');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    event.currentTarget.textContent = isDark ? 'Light' : 'Dark';
});
document.querySelector('#themeToggle').textContent =
    localStorage.getItem('theme') === 'dark' ? 'Light' : 'Dark';
document.querySelector('#logoutButton').addEventListener('click', async () => {
    try {
        await requestJson('/api/auth/logout', { method: 'POST' });
        window.location.replace('/login');
    } catch (error) {
        statusMessage.textContent = error.message;
    }
});

loadProfile();
