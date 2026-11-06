const statusMessage = document.querySelector('#status');
        const accountsTable = document.querySelector('#accounts');
        const transactionsTable = document.querySelector('#transactions');
        const totalAccounts = document.querySelector('#totalAccounts');
        const totalBalance = document.querySelector('#totalBalance');
        const totalTransactions = document.querySelector('#totalTransactions');
        const themeToggle = document.querySelector('#themeToggle');
        const logoutButton = document.querySelector('#logoutButton');
        const accountCreationLinks = document.querySelectorAll('a[href="/create"]');
        const adminNavigationGroup = document.querySelector('#adminNavigationGroup');
        const transactionForm = document.querySelector('#transactionForm');
        const openAccountForm = document.querySelector('#openAccountForm');
        const savingsInterestPolicy = document.querySelector('#savingsInterestPolicy');
        const accountLimitMessage = document.querySelector('#accountLimitMessage');
        const demoDepositForm = document.querySelector('#demoDepositForm');
        const demoDepositPanel = document.querySelector('#demoDepositPanel');
        const accountSelect = document.querySelector('#accountNumber');
        const destinationSelect = document.querySelector('#destinationAccountNumber');
        const transactionStatus = document.querySelector('#transactionStatus');
        const accountCreationStatus = document.querySelector('#accountCreationStatus');
        const demoDepositStatus = document.querySelector('#demoDepositStatus');
        const realtimeStatus = document.querySelector('#realtimeStatus');
        const transactionFilterForm = document.querySelector('#transactionFilterForm');
        const filterAccountSelect = document.querySelector('#filterAccount');
        const filterStatus = document.querySelector('#transactionFilterStatus');
        const downloadStatementButton = document.querySelector('#downloadStatement');
        const previousPageButton = document.querySelector('#previousPage');
        const nextPageButton = document.querySelector('#nextPage');
        const paginationLabel = document.querySelector('#paginationLabel');
        const transferKeys = new Map();
        const demoDepositKeys = new Map();
        const socket = io();
        const transactionPageSize = 25;
        const dashboardTransactionLimit = 5;
        let transactionPage = 1;
        let transactionTotal = 0;
        let accountLimit = 3;

        const formatMoney = (amount) => new Intl.NumberFormat('en-ZA', {
            style: 'currency',
            currency: 'ZAR'
        }).format(amount);

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

        logoutButton?.addEventListener('click', async () => {
            try {
                const response = await fetch('/api/auth/logout', { method: 'POST' });
                if (!response.ok) throw new Error('Sign out could not be confirmed. Please try again.');
                window.location.replace('/login');
            } catch (error) {
                if (statusMessage) statusMessage.textContent = error.message;
            }
        });

        socket.on('transfer:completed', (notification) => {
            if (transactionStatus) transactionStatus.textContent = notification.message;
            loadDashboard();
        });
        socket.on('deposit:completed', (notification) => {
            if (demoDepositStatus) demoDepositStatus.textContent = notification.message;
            loadDashboard();
        });
        socket.on('interest:credited', (notification) => {
            if (transactionStatus) transactionStatus.textContent = notification.message;
            loadDashboard();
        });
        socket.on('connect', () => {
            if (realtimeStatus) realtimeStatus.textContent = 'Live updates connected.';
        });
        socket.on('disconnect', () => {
            if (realtimeStatus) realtimeStatus.textContent = 'Live updates disconnected. Reconnecting...';
        });
        socket.on('connect_error', () => {
            if (realtimeStatus) realtimeStatus.textContent = 'Live updates are unavailable. Refresh to retry.';
        });

        function createCell(row, value) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
            return cell;
        }

        function renderAccounts(accounts, ownedAccountCount) {
            accountsTable?.replaceChildren();
            accountSelect?.replaceChildren();
            const demoDepositAccountSelect = demoDepositForm?.elements.accountNumber;
            demoDepositAccountSelect?.replaceChildren();
            const selectedFilterAccount = filterAccountSelect?.value || '';
            filterAccountSelect?.replaceChildren(new Option('All accounts', ''));
            if (destinationSelect) destinationSelect.value = '';

            for (const account of accounts) {
                const card = document.createElement('article');
                card.className = 'account-card';

                const owner = document.createElement('span');
                owner.className = 'account-owner';
                owner.textContent = `${account.name} · ${account.accountType === 'savings' ? 'Savings' : 'Cheque/current'}`;

                const number = document.createElement('span');
                number.className = 'account-number';
                number.textContent = account.accountNumber;

                const balance = document.createElement('span');
                balance.className = 'account-balance';
                balance.textContent = formatMoney(account.balance);

                card.append(owner, number, balance);
                accountsTable?.append(card);

                const label = `${account.accountNumber} — ${account.name} (${formatMoney(account.balance)})`;
                const typedLabel = `${account.accountType === 'savings' ? 'Savings' : 'Cheque/current'} · ${label}`;
                accountSelect?.add(new Option(typedLabel, account.accountNumber));
                demoDepositAccountSelect?.add(new Option(typedLabel, account.accountNumber));
                filterAccountSelect?.add(new Option(
                    `${account.accountNumber} — ${account.accountType}`,
                    account.accountNumber
                ));
            }
            if (filterAccountSelect) filterAccountSelect.value = selectedFilterAccount;
            const reachedAccountLimit = ownedAccountCount >= accountLimit;
            const openAccountButton = openAccountForm?.querySelector('button[type="submit"]');
            if (openAccountButton) openAccountButton.disabled = reachedAccountLimit;
            if (accountLimitMessage) {
                accountLimitMessage.hidden = !reachedAccountLimit;
                accountLimitMessage.textContent = reachedAccountLimit
                    ? `You have reached the limit of ${accountLimit} accounts.`
                    : `You can open up to ${accountLimit} accounts.`;
            }

            if (!accounts.length) {
                accountSelect?.add(new Option('No accounts available', ''));
                demoDepositAccountSelect?.add(new Option('No accounts available', ''));
                if (accountSelect) accountSelect.disabled = true;
                if (demoDepositAccountSelect) demoDepositAccountSelect.disabled = true;
                if (statusMessage) {
                    statusMessage.textContent = openAccountForm
                        ? 'No accounts yet. Open an account to begin.'
                        : 'No accounts yet. Visit Accounts to open one.';
                }
                if (accountsTable) {
                    const emptyState = document.createElement('p');
                    emptyState.className = 'empty-state';
                    emptyState.textContent = 'No accounts are available yet.';
                    accountsTable.append(emptyState);
                }
            } else {
                if (accountSelect) accountSelect.disabled = false;
                if (demoDepositAccountSelect) demoDepositAccountSelect.disabled = false;
                if (statusMessage) statusMessage.textContent = '';
            }
        }

        function renderTransactions(transactions, total) {
            transactionsTable?.replaceChildren();

            for (const transaction of transactions) {
                const row = document.createElement('tr');
                createCell(row, new Date(transaction.createdAt).toLocaleString());
                createCell(row, transaction.type);
                createCell(row, transaction.fromAccount || '—');
                createCell(row, transaction.toAccount || '—');
                const amountCell = createCell(row, formatMoney(transaction.amount));
                amountCell.className = ['deposit', 'interest'].includes(transaction.type)
                    ? 'amount-positive'
                    : transaction.type === 'withdrawal' ? 'amount-negative' : '';
                amountCell.textContent = ['deposit', 'interest'].includes(transaction.type)
                    ? `+${formatMoney(transaction.amount)}`
                    : transaction.type === 'withdrawal' ? `-${formatMoney(transaction.amount)}` : formatMoney(transaction.amount);
                transactionsTable?.append(row);
            }

            if (!transactions.length) {
                const row = document.createElement('tr');
                const cell = createCell(
                    row,
                    transactionFilterForm ? 'No transactions match these filters.' : 'No transactions yet.'
                );
                cell.colSpan = 5;
                transactionsTable?.append(row);
            }
            transactionTotal = total;
            if (totalTransactions) totalTransactions.textContent = total;
            const pageCount = Math.max(1, Math.ceil(total / transactionPageSize));
            if (paginationLabel) paginationLabel.textContent = `Page ${transactionPage} of ${pageCount} · ${total} entries`;
            if (previousPageButton) previousPageButton.disabled = transactionPage <= 1;
            if (nextPageButton) nextPageButton.disabled = transactionPage >= pageCount;
        }

        function transactionFilterParams(includePage = true) {
            const params = new URLSearchParams();
            if (transactionFilterForm) {
                for (const [key, value] of new FormData(transactionFilterForm)) {
                    if (value) params.set(key, value);
                }
            }
            if (includePage) {
                params.set('page', String(transactionPage));
                params.set('limit', String(transactionFilterForm ? transactionPageSize : dashboardTransactionLimit));
            }
            return params;
        }

        async function loadTransactions() {
            if (!transactionsTable) return;
            if (filterStatus) filterStatus.textContent = 'Loading transactions...';
            try {
                const params = transactionFilterParams();
                const response = await fetch(`/api/transactions?${params}`);
                const result = await response.json();
                if (!response.ok) {
                    if (response.status === 401) return window.location.replace('/login');
                    throw new Error(result.error || 'Could not load transactions.');
                }

                const total = Number(response.headers.get('X-Total-Count')) || 0;
                renderTransactions(result, total);
                if (filterStatus) {
                    filterStatus.textContent = transactionFilterForm
                        ? total
                            ? `Showing ${result.length} of ${total} matching transactions.`
                            : 'No transactions match these filters.'
                        : `Showing ${result.length} recent transactions.`;
                }
            } catch (error) {
                if (filterStatus) filterStatus.textContent = error.message;
            }
        }

        async function loadDashboard() {
            if (statusMessage) statusMessage.textContent = 'Loading accounts...';

            try {
                const [profileResponse, accountsResponse] = await Promise.all([
                    fetch('/api/auth/me'),
                    fetch('/api/accounts')
                ]);
                const profileResult = await profileResponse.json();
                const accountsResult = await accountsResponse.json();

                if (!profileResponse.ok) {
                    if (profileResponse.status === 401) return window.location.replace('/login');
                    throw new Error(profileResult.error || 'Could not load your profile.');
                }
                if (!accountsResponse.ok) {
                    if (accountsResponse.status === 401) return window.location.replace('/login');
                    throw new Error(accountsResult.error || 'Could not load accounts.');
                }

                accountLimit = accountsResult.accountLimit;
                renderAccounts(accountsResult.accounts, accountsResult.ownedAccountCount);
                if (demoDepositPanel) {
                    demoDepositPanel.hidden = !profileResult.demoDepositsEnabled || accountsResult.accounts.length === 0;
                }
                if (savingsInterestPolicy) savingsInterestPolicy.hidden = !profileResult.savingsInterestEnabled;
                const accountTypeSelect = openAccountForm?.elements.accountType;
                const savingsOption = accountTypeSelect?.querySelector('option[value="savings"]');
                if (savingsOption) savingsOption.hidden = !profileResult.savingsInterestEnabled;
                if (!profileResult.savingsInterestEnabled && accountTypeSelect?.value === 'savings') {
                    accountTypeSelect.value = 'cheque';
                }
                for (const link of accountCreationLinks) {
                    link.hidden = profileResult.user.role !== 'admin';
                }
                if (adminNavigationGroup) adminNavigationGroup.hidden = profileResult.user.role !== 'admin';
                if (totalAccounts) totalAccounts.textContent = accountsResult.accountCount;
                if (totalBalance) totalBalance.textContent = formatMoney(accountsResult.totalBalance);
                await loadTransactions();
            } catch (error) {
                if (statusMessage) statusMessage.textContent = error.message;
            }
        }

        transactionFilterForm?.addEventListener('submit', (event) => {
            event.preventDefault();
            transactionPage = 1;
            loadTransactions();
        });

        openAccountForm?.addEventListener('submit', async (event) => {
            event.preventDefault();
            accountCreationStatus.textContent = 'Opening account...';
            const payload = Object.fromEntries(new FormData(openAccountForm));
            const button = openAccountForm.querySelector('button[type="submit"]');
            button.disabled = true;
            try {
                const response = await fetch('/api/accounts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (!response.ok) {
                    if (response.status === 401) return window.location.replace('/login');
                    throw new Error(result.error || 'Account could not be opened.');
                }

                accountCreationStatus.textContent = result.message;
                await loadDashboard();
            } catch (error) {
                accountCreationStatus.textContent = error.message;
            } finally {
                button.disabled = false;
            }
        });

        document.querySelector('#clearFilters')?.addEventListener('click', () => {
            transactionFilterForm.reset();
            transactionPage = 1;
            loadTransactions();
        });

        previousPageButton?.addEventListener('click', () => {
            if (transactionPage > 1) {
                transactionPage -= 1;
                loadTransactions();
            }
        });

        nextPageButton?.addEventListener('click', () => {
            if (transactionPage * transactionPageSize < transactionTotal) {
                transactionPage += 1;
                loadTransactions();
            }
        });

        downloadStatementButton?.addEventListener('click', async () => {
            downloadStatementButton.disabled = true;
            if (filterStatus) filterStatus.textContent = 'Preparing CSV statement...';
            try {
                const params = transactionFilterParams(false);
                const response = await fetch(`/api/transactions.csv?${params}`);
                if (!response.ok) {
                    const result = await response.json();
                    if (response.status === 401) return window.location.replace('/login');
                    throw new Error(result.error || 'Could not download the statement.');
                }

                const objectUrl = URL.createObjectURL(await response.blob());
                const downloadLink = document.createElement('a');
                downloadLink.href = objectUrl;
                downloadLink.download = `sky-bank-statement-${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.append(downloadLink);
                downloadLink.click();
                downloadLink.remove();
                window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
                if (filterStatus) filterStatus.textContent = 'CSV statement downloaded.';
            } catch (error) {
                if (filterStatus) filterStatus.textContent = error.message;
            } finally {
                downloadStatementButton.disabled = false;
            }
        });

        transactionForm?.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (transactionStatus) transactionStatus.textContent = 'Processing transaction...';

            const payload = Object.fromEntries(new FormData(transactionForm));
            const confirmed = window.confirm(
                `Confirm transfer of ${formatMoney(Number(payload.amount))} from ${payload.accountNumber} to ${payload.destinationAccountNumber}?`
            );
            if (!confirmed) return;
            const payloadSignature = JSON.stringify(payload);
            if (!transferKeys.has(payloadSignature)) {
                transferKeys.set(payloadSignature, crypto.randomUUID().replaceAll('-', ''));
            }
            try {
                const response = await fetch('/api/transactions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Idempotency-Key': transferKeys.get(payloadSignature)
                    },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();

                if (!response.ok) {
                    if (response.status === 401) return window.location.replace('/login');
                    throw new Error(result.error || 'Transaction failed.');
                }

                if (transactionStatus) transactionStatus.textContent = result.message;
                transferKeys.delete(payloadSignature);
                transactionForm.reset();
                await loadDashboard();
            } catch (error) {
                if (transactionStatus) transactionStatus.textContent = error.message;
            }
        });

        demoDepositForm?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const accountNumber = new FormData(demoDepositForm).get('accountNumber');
            if (typeof accountNumber !== 'string' || !accountNumber) {
                if (demoDepositStatus) demoDepositStatus.textContent = 'Choose an account for the demo deposit.';
                return;
            }

            const payload = {
                type: 'deposit',
                accountNumber,
                amount: new FormData(demoDepositForm).get('amount')
            };
            const confirmed = window.confirm(
                `Add simulated demo funds of ${formatMoney(Number(payload.amount))} to your account? This is not real money.`
            );
            if (!confirmed) return;
            if (demoDepositStatus) demoDepositStatus.textContent = 'Processing demo deposit...';
            const payloadSignature = JSON.stringify(payload);
            if (!demoDepositKeys.has(payloadSignature)) {
                demoDepositKeys.set(payloadSignature, crypto.randomUUID().replaceAll('-', ''));
            }

            try {
                const response = await fetch('/api/transactions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Idempotency-Key': demoDepositKeys.get(payloadSignature)
                    },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();

                if (!response.ok) {
                    if (response.status === 401) return window.location.replace('/login');
                    throw new Error(result.error || 'Demo deposit failed.');
                }

                if (demoDepositStatus) demoDepositStatus.textContent = result.message;
                demoDepositKeys.delete(payloadSignature);
                demoDepositForm.reset();
                await loadDashboard();
            } catch (error) {
                if (demoDepositStatus) demoDepositStatus.textContent = error.message;
            }
        });

        applyTheme();
        loadDashboard();
