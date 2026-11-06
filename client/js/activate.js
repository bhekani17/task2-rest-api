const form = document.querySelector('#activationForm');
        const message = document.querySelector('#message');
        const token = new URLSearchParams(window.location.hash.slice(1)).get('token');

        if (!token) {
            form.hidden = true;
            message.textContent = 'This activation link is invalid or expired. Contact the account administrator.';
        }

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            message.textContent = 'Activating account...';

            try {
                const response = await fetch('/api/auth/activate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token,
                        password: document.querySelector('#password').value
                    })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Account activation failed.');
                message.textContent = result.message;
                form.reset();
                window.setTimeout(() => window.location.replace('/login'), 1000);
            } catch (error) {
                message.textContent = error.message;
            }
        });
