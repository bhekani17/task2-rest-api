const form = document.querySelector('#loginForm');
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
            message.textContent = 'Logging in...';

            const payload = {
                email: document.querySelector('#email').value.trim(),
                password: document.querySelector('#password').value
            };

            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.error || 'Login failed.');
                }

                message.textContent = `Welcome back, ${result.user.name}.`;
                window.location.replace('/dashboard');
            } catch (error) {
                message.textContent = error.message;
            }
        });

        applyTheme();
