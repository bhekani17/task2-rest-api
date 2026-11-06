const form = document.querySelector('#userForm');
        const message = document.querySelector('#message');
        const activationLinkField = document.querySelector('#activationLinkField');
        const activationLink = document.querySelector('#activationLink');
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
            message.textContent = 'Creating customer account...';

            const name = document.querySelector('#name').value.trim();
            const email = document.querySelector('#email').value.trim();

            try {
                const response = await fetch('/api/users', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ name, email })
                });

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.error || 'User could not be created.');
                }

                message.textContent = `${result.message} Share the activation link securely with the customer.`;
                activationLink.value = new URL(result.activationPath, window.location.origin).href;
                activationLinkField.hidden = false;
                form.reset();
            } catch (error) {
                message.textContent = error.message;
            }
        });

        applyTheme();
