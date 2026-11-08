const form = document.querySelector('#registerForm');
        const message = document.querySelector('#message');
        const themeToggle = document.querySelector('#themeToggle');

        function applyTheme() {
            const isDark = localStorage.getItem('theme') === 'dark';
            document.body.classList.toggle('dark-theme', isDark);
            themeToggle.textContent = isDark ? 'Light' : 'Dark';
        }

        themeToggle.addEventListener('click', () => {
            const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
            localStorage.setItem('theme', nextTheme);
            applyTheme();
        });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            message.textContent = 'Creating account...';

            const adminCode = document.querySelector('#adminCode')?.value.trim() || '';
            const payload = {
                name: document.querySelector('#name').value.trim(),
                email: document.querySelector('#email').value.trim(),
                password: document.querySelector('#password').value,
                ...(adminCode ? { adminCode } : {})
            };

            try {
                const response = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.error || 'Registration failed.');
                }

                message.textContent = `Welcome ${result.user.name}! Your account is ready.`;
                window.location.replace(result.user.role === 'admin' ? '/admin' : '/dashboard');
            } catch (error) {
                message.textContent = error.message;
            }
        });

        applyTheme();
