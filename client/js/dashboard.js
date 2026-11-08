const statusMessage = document.querySelector('#status');
        const accountsTable = document.querySelector('#accounts');
        const transactionsTable = document.querySelector('#transactions');
        const totalAccounts = document.querySelector('#totalAccounts');
        const totalBalance = document.querySelector('#totalBalance');
        const totalTransactions = document.querySelector('#totalTransactions');
        const themeToggle = document.querySelector('#themeToggle');
        const logoutButton = document.querySelector('#logoutButton');
        const accountCreationLinks = document.querySelectorAll('a[href="/admin"], a[href="/create"]');
        const adminNavigationGroup = document.querySelector('#adminNavigationGroup');
        const transactionForm = document.querySelector('#transactionForm');
        const transactionAccessNotice = document.querySelector('#transactionAccessNotice');
        const transferLinks = document.querySelectorAll('a.primary-btn[href="/transfers"]');
        const profilePhoto = document.querySelector('#profilePhoto');
        const profilePhotoInput = document.querySelector('#profilePhotoInput');
        const removeProfilePhotoButton = document.querySelector('#removeProfilePhotoButton');
        const investmentLinks = document.querySelectorAll('.investment-nav-link');
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
        const notificationsList = document.querySelector('#notificationsList');
        const notificationUnreadBadge = document.querySelector('#notificationUnreadBadge');
        const markNotificationsReadButton = document.querySelector('#markNotificationsReadButton');
        const notificationsStatus = document.querySelector('#notificationsStatus');
        const issueCardForm = document.querySelector('#issueCardForm');
        const cardAccountSelect = document.querySelector('#cardAccountNumber');
        const virtualCardStatus = document.querySelector('#virtualCardStatus');
        const virtualCardsList = document.querySelector('#virtualCardsList');
        const createSavingsGoalForm = document.querySelector('#createSavingsGoalForm');
        const goalAccountSelect = document.querySelector('#goalAccountNumber');
        const savingsGoalStatus = document.querySelector('#savingsGoalStatus');
        const savingsGoalsList = document.querySelector('#savingsGoalsList');
        const recipientLookupResult = document.querySelector('#recipientLookupResult');
        const beneficiaryForm = document.querySelector('#beneficiaryForm');
        const beneficiaryStatus = document.querySelector('#beneficiaryStatus');
        const beneficiariesList = document.querySelector('#beneficiariesList');
        const scheduledTransferForm = document.querySelector('#scheduledTransferForm');
        const scheduledFromAccountSelect = document.querySelector('#scheduledFromAccount');
        const scheduledNextRunDate = document.querySelector('#scheduledNextRunDate');
        const scheduledTransferStatus = document.querySelector('#scheduledTransferStatus');
        const scheduledTransfersList = document.querySelector('#scheduledTransfersList');
        const paymentRequestForm = document.querySelector('#paymentRequestForm');
        const requestReceivingAccountSelect = document.querySelector('#requestReceivingAccount');
        const paymentRequestStatus = document.querySelector('#paymentRequestStatus');
        const incomingPaymentRequests = document.querySelector('#incomingPaymentRequests');
        const outgoingPaymentRequests = document.querySelector('#outgoingPaymentRequests');
        const disputeForm = document.querySelector('#disputeForm');
        const disputeTransactionIdInput = document.querySelector('#disputeTransactionId');
        const disputeReasonInput = document.querySelector('#disputeReason');
        const disputeStatus = document.querySelector('#disputeStatus');
        const disputesList = document.querySelector('#disputesList');
        const transferKeys = new Map();
        const demoDepositKeys = new Map();
        const socket = io();
        const transactionPageSize = 25;
        const dashboardTransactionLimit = 5;
        const transactionTypeLabels = {
            stock_buy: 'Stock purchase',
            stock_sell: 'Stock sale',
            goal_allocate: 'Goal deposit',
            goal_release: 'Goal withdrawal',
            reversal: 'Dispute reversal'
        };
        let transactionPage = 1;
        let transactionTotal = 0;
        let accountLimit = 3;

        if (scheduledNextRunDate && !scheduledNextRunDate.value) {
            scheduledNextRunDate.value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        }

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
        socket.on('notification:new', () => {
            loadNotifications();
        });
        socket.on('paymentRequest:received', (notification) => {
            if (paymentRequestStatus) paymentRequestStatus.textContent = notification.message;
            loadPaymentRequests();
            loadNotifications();
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
            cardAccountSelect?.replaceChildren();
            goalAccountSelect?.replaceChildren();
            scheduledFromAccountSelect?.replaceChildren();
            requestReceivingAccountSelect?.replaceChildren();
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
                const statusSuffix = account.status === 'frozen' ? ' · FROZEN' : '';
                owner.textContent = `${account.name} · ${account.accountType === 'savings' ? 'Savings' : 'Cheque/current'}${statusSuffix}`;

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
                if (account.status !== 'frozen') {
                    accountSelect?.add(new Option(typedLabel, account.accountNumber));
                    demoDepositAccountSelect?.add(new Option(typedLabel, account.accountNumber));
                    cardAccountSelect?.add(new Option(typedLabel, account.accountNumber));
                    goalAccountSelect?.add(new Option(typedLabel, account.accountNumber));
                    scheduledFromAccountSelect?.add(new Option(typedLabel, account.accountNumber));
                    requestReceivingAccountSelect?.add(new Option(typedLabel, account.accountNumber));
                }
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
                createCell(row, transactionTypeLabels[transaction.type] || transaction.type);
                createCell(row, transaction.fromAccount || '—');
                createCell(row, transaction.toAccount || '—');
                const amountCell = createCell(row, formatMoney(transaction.amount));
                amountCell.className = ['deposit', 'interest', 'goal_release', 'reversal'].includes(transaction.type)
                    ? 'amount-positive'
                    : ['withdrawal', 'stock_buy', 'goal_allocate'].includes(transaction.type) ? 'amount-negative' : '';
                amountCell.textContent = ['deposit', 'interest', 'goal_release', 'reversal'].includes(transaction.type)
                    ? `+${formatMoney(transaction.amount)}`
                    : ['withdrawal', 'stock_buy', 'goal_allocate'].includes(transaction.type)
                        ? `-${formatMoney(transaction.amount)}`
                        : ['stock_sell'].includes(transaction.type) ? `+${formatMoney(transaction.amount)}` : formatMoney(transaction.amount);
                if (disputeForm) {
                    const actionCell = document.createElement('td');
                    if (transaction.type === 'transfer') {
                        const disputeBtn = document.createElement('button');
                        disputeBtn.type = 'button';
                        disputeBtn.className = 'filter-button';
                        disputeBtn.textContent = 'Dispute';
                        disputeBtn.addEventListener('click', () => {
                            if (disputeTransactionIdInput) disputeTransactionIdInput.value = transaction.id;
                            disputeReasonInput?.focus();
                        });
                        actionCell.append(disputeBtn);
                    } else {
                        actionCell.textContent = '—';
                    }
                    row.append(actionCell);
                }
                transactionsTable?.append(row);
            }

            if (!transactions.length) {
                const row = document.createElement('tr');
                const cell = createCell(
                    row,
                    transactionFilterForm ? 'No transactions match these filters.' : 'No transactions yet.'
                );
                cell.colSpan = disputeForm ? 6 : 5;
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
                const isAdmin = profileResult.user.role === 'admin';
                for (const link of investmentLinks) link.hidden = isAdmin;
                if (profilePhoto) {
                    profilePhoto.hidden = !profileResult.user.hasProfilePhoto;
                    profilePhoto.src = profileResult.user.hasProfilePhoto
                        ? `/api/auth/profile/photo?updated=${Date.now()}`
                        : '';
                }
                if (removeProfilePhotoButton) removeProfilePhotoButton.hidden = !profileResult.user.hasProfilePhoto;
                if (openAccountForm) openAccountForm.hidden = isAdmin;
                if (accountLimitMessage && isAdmin) accountLimitMessage.hidden = true;
                if (transactionForm) transactionForm.hidden = isAdmin;
                if (transactionAccessNotice) transactionAccessNotice.hidden = !isAdmin;
                for (const link of transferLinks) link.hidden = isAdmin;
                if (demoDepositPanel) {
                    demoDepositPanel.hidden = isAdmin || !profileResult.demoDepositsEnabled || accountsResult.accounts.length === 0;
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
                await Promise.all([
                    loadTransactions(),
                    loadNotifications(),
                    loadVirtualCards(),
                    loadSavingsGoals(),
                    loadBeneficiaries(),
                    loadScheduledTransfers(),
                    loadPaymentRequests(),
                    loadDisputes()
                ]);
            } catch (error) {
                if (statusMessage) statusMessage.textContent = error.message;
            }
        }

        transactionFilterForm?.addEventListener('submit', (event) => {
            event.preventDefault();
            transactionPage = 1;
            loadTransactions();
        });

        profilePhotoInput?.addEventListener('change', async () => {
            const [file] = profilePhotoInput.files || [];
            if (!file) return;
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                if (statusMessage) statusMessage.textContent = 'Choose a JPEG, PNG, or WebP image.';
                profilePhotoInput.value = '';
                return;
            }
            if (file.size > 2 * 1024 * 1024) {
                if (statusMessage) statusMessage.textContent = 'Profile photos must be 2 MB or smaller.';
                profilePhotoInput.value = '';
                return;
            }
            if (statusMessage) statusMessage.textContent = 'Uploading profile photo...';
            try {
                const response = await fetch('/api/auth/profile/photo', {
                    method: 'PUT',
                    headers: { 'Content-Type': file.type },
                    body: file
                });
                const result = await response.json();
                if (!response.ok) {
                    if (response.status === 401) return window.location.replace('/login');
                    throw new Error(result.error || 'Profile photo upload failed.');
                }
                if (statusMessage) statusMessage.textContent = result.message;
                await loadDashboard();
            } catch (error) {
                if (statusMessage) statusMessage.textContent = error.message;
            } finally {
                profilePhotoInput.value = '';
            }
        });

        removeProfilePhotoButton?.addEventListener('click', async () => {
            removeProfilePhotoButton.disabled = true;
            try {
                const response = await fetch('/api/auth/profile/photo', { method: 'DELETE' });
                const result = await response.json();
                if (!response.ok) {
                    if (response.status === 401) return window.location.replace('/login');
                    throw new Error(result.error || 'Profile photo could not be removed.');
                }
                if (statusMessage) statusMessage.textContent = result.message;
                await loadDashboard();
            } catch (error) {
                if (statusMessage) statusMessage.textContent = error.message;
            } finally {
                removeProfilePhotoButton.disabled = false;
            }
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

        // Notifications Inbox
        async function loadNotifications() {
            if (!notificationsList) return;
            try {
                const response = await fetch('/api/notifications');
                if (!response.ok) return;
                const result = await response.json();
                notificationsList.replaceChildren();
                const unread = result.unreadCount || 0;
                if (notificationUnreadBadge) {
                    notificationUnreadBadge.hidden = unread === 0;
                    notificationUnreadBadge.textContent = `${unread} unread`;
                }
                if (markNotificationsReadButton) {
                    markNotificationsReadButton.disabled = unread === 0;
                }
                const items = result.notifications || [];
                if (!items.length) {
                    const empty = document.createElement('p');
                    empty.className = 'empty-state';
                    empty.textContent = 'No notifications yet.';
                    notificationsList.append(empty);
                    return;
                }
                for (const item of items) {
                    const card = document.createElement('article');
                    card.className = `account-card ${item.read ? '' : 'notification-unread'}`.trim();
                    const meta = document.createElement('span');
                    meta.className = 'account-owner';
                    meta.textContent = `${new Date(item.createdAt).toLocaleString()} · ${item.read ? 'Read' : 'New'}`;
                    const msg = document.createElement('span');
                    msg.className = 'account-number';
                    msg.textContent = item.message;
                    card.append(meta, msg);
                    notificationsList.append(card);
                }
            } catch {
                // Ignore background notification errors
            }
        }

        markNotificationsReadButton?.addEventListener('click', async () => {
            markNotificationsReadButton.disabled = true;
            try {
                const response = await fetch('/api/notifications/read-all', { method: 'POST' });
                if (response.ok) {
                    if (notificationsStatus) notificationsStatus.textContent = 'All notifications marked as read.';
                    await loadNotifications();
                }
            } finally {
                markNotificationsReadButton.disabled = false;
            }
        });

        // Recipient Account Lookup on Transfers Page
        destinationSelect?.addEventListener('input', async () => {
            const value = destinationSelect.value.trim();
            if (!recipientLookupResult) return;
            if (!/^\d{10}$/.test(value)) {
                recipientLookupResult.hidden = true;
                recipientLookupResult.textContent = '';
                return;
            }
            recipientLookupResult.hidden = false;
            recipientLookupResult.textContent = 'Verifying recipient account...';
            try {
                const response = await fetch(`/api/accounts/lookup/${value}`);
                const result = await response.json();
                if (!response.ok) {
                    recipientLookupResult.textContent = result.error || 'Account not found.';
                    return;
                }
                recipientLookupResult.textContent = `Verified recipient: ${result.holderName} (${result.accountType === 'savings' ? 'Savings' : 'Cheque/current'})`;
            } catch {
                recipientLookupResult.textContent = 'Could not verify recipient right now.';
            }
        });

        // Saved Beneficiaries
        async function loadBeneficiaries() {
            if (!beneficiariesList) return;
            try {
                const response = await fetch('/api/beneficiaries');
                if (!response.ok) return;
                const result = await response.json();
                beneficiariesList.replaceChildren();
                const items = result.beneficiaries || [];
                if (!items.length) {
                    const empty = document.createElement('p');
                    empty.className = 'empty-state';
                    empty.textContent = 'No saved beneficiaries yet.';
                    beneficiariesList.append(empty);
                    return;
                }
                for (const item of items) {
                    const card = document.createElement('article');
                    card.className = 'account-card';
                    const title = document.createElement('span');
                    title.className = 'account-owner';
                    title.textContent = item.nickname ? `${item.nickname} (${item.name})` : item.name;
                    const number = document.createElement('span');
                    number.className = 'account-number';
                    number.textContent = `${item.accountNumber}${item.defaultReference ? ` · Ref: ${item.defaultReference}` : ''}`;
                    const actions = document.createElement('div');
                    actions.className = 'inline-action-group';
                    const useBtn = document.createElement('button');
                    useBtn.type = 'button';
                    useBtn.className = 'filter-button filter-button-primary';
                    useBtn.textContent = 'Use payee';
                    useBtn.addEventListener('click', () => {
                        if (destinationSelect) {
                            destinationSelect.value = item.accountNumber;
                            destinationSelect.dispatchEvent(new Event('input'));
                        }
                        const descInput = document.querySelector('#description');
                        if (descInput && item.defaultReference) descInput.value = item.defaultReference;
                        document.querySelector('#amount')?.focus();
                    });
                    const delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.className = 'filter-button';
                    delBtn.textContent = 'Remove';
                    delBtn.addEventListener('click', async () => {
                        const res = await fetch(`/api/beneficiaries/${item.id}`, { method: 'DELETE' });
                        if (res.ok) await loadBeneficiaries();
                    });
                    actions.append(useBtn, delBtn);
                    card.append(title, number, actions);
                    beneficiariesList.append(card);
                }
            } catch {
                // Ignore
            }
        }

        beneficiaryForm?.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (beneficiaryStatus) beneficiaryStatus.textContent = 'Saving beneficiary...';
            const payload = Object.fromEntries(new FormData(beneficiaryForm));
            try {
                const response = await fetch('/api/beneficiaries', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Could not save beneficiary.');
                if (beneficiaryStatus) beneficiaryStatus.textContent = result.message;
                beneficiaryForm.reset();
                await loadBeneficiaries();
            } catch (error) {
                if (beneficiaryStatus) beneficiaryStatus.textContent = error.message;
            }
        });

        // Scheduled & Recurring Transfers
        async function loadScheduledTransfers() {
            if (!scheduledTransfersList) return;
            try {
                const response = await fetch('/api/scheduled-transfers');
                if (!response.ok) return;
                const result = await response.json();
                scheduledTransfersList.replaceChildren();
                const items = result.scheduledTransfers || [];
                if (!items.length) {
                    const empty = document.createElement('p');
                    empty.className = 'empty-state';
                    empty.textContent = 'No scheduled or recurring transfers.';
                    scheduledTransfersList.append(empty);
                    return;
                }
                for (const item of items) {
                    const card = document.createElement('article');
                    card.className = 'account-card';
                    const header = document.createElement('span');
                    header.className = 'account-owner';
                    header.textContent = `${item.frequency.toUpperCase()} · ${item.status.toUpperCase()} · Next: ${new Date(item.nextRunAt).toLocaleDateString()}`;
                    const detail = document.createElement('span');
                    detail.className = 'account-number';
                    detail.textContent = `${item.fromAccount} → ${item.toAccount}${item.description ? ` (${item.description})` : ''}`;
                    const amount = document.createElement('span');
                    amount.className = 'account-balance';
                    amount.textContent = formatMoney(item.amount);
                    card.append(header, detail, amount);
                    if (item.status === 'active') {
                        const cancelBtn = document.createElement('button');
                        cancelBtn.type = 'button';
                        cancelBtn.className = 'filter-button';
                        cancelBtn.textContent = 'Cancel schedule';
                        cancelBtn.addEventListener('click', async () => {
                            const res = await fetch(`/api/scheduled-transfers/${item.id}`, { method: 'DELETE' });
                            if (res.ok) await loadScheduledTransfers();
                        });
                        card.append(cancelBtn);
                    }
                    scheduledTransfersList.append(card);
                }
            } catch {
                // Ignore
            }
        }

        scheduledTransferForm?.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (scheduledTransferStatus) scheduledTransferStatus.textContent = 'Scheduling transfer...';
            const payload = Object.fromEntries(new FormData(scheduledTransferForm));
            try {
                const response = await fetch('/api/scheduled-transfers', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Could not schedule transfer.');
                if (scheduledTransferStatus) scheduledTransferStatus.textContent = result.message;
                scheduledTransferForm.reset();
                if (scheduledNextRunDate) {
                    scheduledNextRunDate.value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
                }
                await loadScheduledTransfers();
            } catch (error) {
                if (scheduledTransferStatus) scheduledTransferStatus.textContent = error.message;
            }
        });

        // Payment Requests ("Pay Me")
        async function loadPaymentRequests() {
            if (!incomingPaymentRequests && !outgoingPaymentRequests) return;
            try {
                const response = await fetch('/api/payment-requests');
                if (!response.ok) return;
                const result = await response.json();

                if (incomingPaymentRequests) {
                    incomingPaymentRequests.replaceChildren();
                    const incoming = result.incoming || [];
                    if (!incoming.length) {
                        const empty = document.createElement('p');
                        empty.className = 'empty-state';
                        empty.textContent = 'No incoming payment requests.';
                        incomingPaymentRequests.append(empty);
                    }
                    for (const reqItem of incoming) {
                        const card = document.createElement('article');
                        card.className = 'account-card';
                        const meta = document.createElement('span');
                        meta.className = 'account-owner';
                        meta.textContent = `From ${reqItem.requesterName} · ${reqItem.status.toUpperCase()}`;
                        const detail = document.createElement('span');
                        detail.className = 'account-number';
                        detail.textContent = `Pay from ${reqItem.fromAccount} to ${reqItem.toAccount}${reqItem.description ? ` · ${reqItem.description}` : ''}`;
                        const amount = document.createElement('span');
                        amount.className = 'account-balance';
                        amount.textContent = formatMoney(reqItem.amount);
                        card.append(meta, detail, amount);
                        if (reqItem.status === 'pending') {
                            const actions = document.createElement('div');
                            actions.className = 'inline-action-group';
                            const payBtn = document.createElement('button');
                            payBtn.type = 'button';
                            payBtn.className = 'filter-button filter-button-primary';
                            payBtn.textContent = 'Approve & pay';
                            payBtn.addEventListener('click', async () => {
                                if (!window.confirm(`Approve and pay ${formatMoney(reqItem.amount)} to ${reqItem.requesterName}?`)) return;
                                const res = await fetch(`/api/payment-requests/${reqItem.id}/respond`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: 'pay' })
                                });
                                const body = await res.json();
                                if (paymentRequestStatus) paymentRequestStatus.textContent = body.message || body.error;
                                await loadDashboard();
                            });
                            const declineBtn = document.createElement('button');
                            declineBtn.type = 'button';
                            declineBtn.className = 'filter-button';
                            declineBtn.textContent = 'Decline';
                            declineBtn.addEventListener('click', async () => {
                                const res = await fetch(`/api/payment-requests/${reqItem.id}/respond`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: 'decline' })
                                });
                                const body = await res.json();
                                if (paymentRequestStatus) paymentRequestStatus.textContent = body.message || body.error;
                                await loadPaymentRequests();
                            });
                            actions.append(payBtn, declineBtn);
                            card.append(actions);
                        }
                        incomingPaymentRequests.append(card);
                    }
                }

                if (outgoingPaymentRequests) {
                    outgoingPaymentRequests.replaceChildren();
                    const outgoing = result.outgoing || [];
                    if (!outgoing.length) {
                        const empty = document.createElement('p');
                        empty.className = 'empty-state';
                        empty.textContent = 'No outgoing payment requests.';
                        outgoingPaymentRequests.append(empty);
                    }
                    for (const reqItem of outgoing) {
                        const card = document.createElement('article');
                        card.className = 'account-card';
                        const meta = document.createElement('span');
                        meta.className = 'account-owner';
                        meta.textContent = `Requested from ${reqItem.payerName} · ${reqItem.status.toUpperCase()}`;
                        const detail = document.createElement('span');
                        detail.className = 'account-number';
                        detail.textContent = `${reqItem.fromAccount} → ${reqItem.toAccount}${reqItem.description ? ` · ${reqItem.description}` : ''}`;
                        const amount = document.createElement('span');
                        amount.className = 'account-balance';
                        amount.textContent = formatMoney(reqItem.amount);
                        card.append(meta, detail, amount);
                        if (reqItem.status === 'pending') {
                            const cancelBtn = document.createElement('button');
                            cancelBtn.type = 'button';
                            cancelBtn.className = 'filter-button';
                            cancelBtn.textContent = 'Cancel request';
                            cancelBtn.addEventListener('click', async () => {
                                const res = await fetch(`/api/payment-requests/${reqItem.id}/respond`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: 'cancel' })
                                });
                                if (res.ok) await loadPaymentRequests();
                            });
                            card.append(cancelBtn);
                        }
                        outgoingPaymentRequests.append(card);
                    }
                }
            } catch {
                // Ignore
            }
        }

        paymentRequestForm?.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (paymentRequestStatus) paymentRequestStatus.textContent = 'Sending payment request...';
            const payload = Object.fromEntries(new FormData(paymentRequestForm));
            try {
                const response = await fetch('/api/payment-requests', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Could not send payment request.');
                if (paymentRequestStatus) paymentRequestStatus.textContent = result.message;
                paymentRequestForm.reset();
                await loadPaymentRequests();
            } catch (error) {
                if (paymentRequestStatus) paymentRequestStatus.textContent = error.message;
            }
        });

        // Virtual Debit Cards
        async function loadVirtualCards() {
            if (!virtualCardsList) return;
            try {
                const response = await fetch('/api/cards');
                if (!response.ok) return;
                const result = await response.json();
                virtualCardsList.replaceChildren();
                const cards = result.cards || [];
                if (!cards.length) {
                    const empty = document.createElement('p');
                    empty.className = 'empty-state';
                    empty.textContent = 'No virtual cards issued yet.';
                    virtualCardsList.append(empty);
                    return;
                }
                for (const card of cards) {
                    const item = document.createElement('article');
                    item.className = 'account-card virtual-card-item';
                    const meta = document.createElement('span');
                    meta.className = 'account-owner';
                    meta.textContent = `Account ${card.accountNumber} · ${card.status.toUpperCase()} · Exp ${card.expiryMonth}/${card.expiryYear}`;
                    const pan = document.createElement('span');
                    pan.className = 'account-balance';
                    pan.textContent = card.maskedNumber;
                    const limitInfo = document.createElement('span');
                    limitInfo.className = 'account-number';
                    limitInfo.textContent = `Daily limit: ${formatMoney(card.dailyLimit)} · Online payments: ${card.onlinePaymentsEnabled ? 'Enabled' : 'Blocked'}`;

                    const actions = document.createElement('div');
                    actions.className = 'inline-action-group';

                    const freezeBtn = document.createElement('button');
                    freezeBtn.type = 'button';
                    freezeBtn.className = 'filter-button';
                    freezeBtn.textContent = card.status === 'frozen' ? 'Unfreeze card' : 'Freeze card';
                    freezeBtn.addEventListener('click', async () => {
                        const nextStatus = card.status === 'frozen' ? 'active' : 'frozen';
                        const res = await fetch(`/api/cards/${card.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: nextStatus })
                        });
                        if (res.ok) await loadVirtualCards();
                    });

                    const onlineBtn = document.createElement('button');
                    onlineBtn.type = 'button';
                    onlineBtn.className = 'filter-button';
                    onlineBtn.textContent = card.onlinePaymentsEnabled ? 'Block online' : 'Allow online';
                    onlineBtn.addEventListener('click', async () => {
                        const res = await fetch(`/api/cards/${card.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ onlinePaymentsEnabled: !card.onlinePaymentsEnabled })
                        });
                        if (res.ok) await loadVirtualCards();
                    });

                    actions.append(freezeBtn, onlineBtn);
                    item.append(meta, pan, limitInfo, actions);
                    virtualCardsList.append(item);
                }
            } catch {
                // Ignore
            }
        }

        issueCardForm?.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (virtualCardStatus) virtualCardStatus.textContent = 'Issuing virtual debit card...';
            const payload = Object.fromEntries(new FormData(issueCardForm));
            try {
                const response = await fetch('/api/cards', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Could not issue virtual card.');
                if (virtualCardStatus) virtualCardStatus.textContent = result.message;
                await loadVirtualCards();
            } catch (error) {
                if (virtualCardStatus) virtualCardStatus.textContent = error.message;
            }
        });

        // Savings Goals (Pockets)
        async function loadSavingsGoals() {
            if (!savingsGoalsList) return;
            try {
                const response = await fetch('/api/savings-goals');
                if (!response.ok) return;
                const result = await response.json();
                savingsGoalsList.replaceChildren();
                const goals = result.goals || [];
                if (!goals.length) {
                    const empty = document.createElement('p');
                    empty.className = 'empty-state';
                    empty.textContent = 'No savings goals created yet.';
                    savingsGoalsList.append(empty);
                    return;
                }
                for (const goal of goals) {
                    const card = document.createElement('article');
                    card.className = 'account-card';
                    const meta = document.createElement('span');
                    meta.className = 'account-owner';
                    meta.textContent = `${goal.name} · Linked to ${goal.accountNumber} (${goal.progressPercent}%)`;
                    const amount = document.createElement('span');
                    amount.className = 'account-balance';
                    amount.textContent = `${formatMoney(goal.currentAmount)} / ${formatMoney(goal.targetAmount)}`;

                    const progressTrack = document.createElement('div');
                    progressTrack.className = 'goal-progress-track';
                    const progressFill = document.createElement('div');
                    progressFill.className = 'goal-progress-fill';
                    progressFill.style.width = `${goal.progressPercent}%`;
                    progressTrack.append(progressFill);

                    const actions = document.createElement('div');
                    actions.className = 'inline-action-group';

                    const addBtn = document.createElement('button');
                    addBtn.type = 'button';
                    addBtn.className = 'filter-button filter-button-primary';
                    addBtn.textContent = 'Add funds';
                    addBtn.addEventListener('click', async () => {
                        const raw = window.prompt(`Enter ZAR amount to move from ${goal.accountNumber} into "${goal.name}":`, '100.00');
                        if (!raw) return;
                        const res = await fetch(`/api/savings-goals/${goal.id}/allocate`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ direction: 'deposit', amount: raw })
                        });
                        const body = await res.json();
                        if (savingsGoalStatus) savingsGoalStatus.textContent = body.message || body.error;
                        await loadDashboard();
                    });

                    const withdrawBtn = document.createElement('button');
                    withdrawBtn.type = 'button';
                    withdrawBtn.className = 'filter-button';
                    withdrawBtn.textContent = 'Withdraw';
                    withdrawBtn.disabled = goal.currentAmount <= 0;
                    withdrawBtn.addEventListener('click', async () => {
                        const raw = window.prompt(`Enter ZAR amount to release from "${goal.name}" back to ${goal.accountNumber}:`, String(goal.currentAmount));
                        if (!raw) return;
                        const res = await fetch(`/api/savings-goals/${goal.id}/allocate`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ direction: 'withdraw', amount: raw })
                        });
                        const body = await res.json();
                        if (savingsGoalStatus) savingsGoalStatus.textContent = body.message || body.error;
                        await loadDashboard();
                    });

                    const closeBtn = document.createElement('button');
                    closeBtn.type = 'button';
                    closeBtn.className = 'filter-button';
                    closeBtn.textContent = 'Close goal';
                    closeBtn.addEventListener('click', async () => {
                        if (!window.confirm(`Close "${goal.name}" and return any saved balance to ${goal.accountNumber}?`)) return;
                        const res = await fetch(`/api/savings-goals/${goal.id}`, { method: 'DELETE' });
                        const body = await res.json();
                        if (savingsGoalStatus) savingsGoalStatus.textContent = body.message || body.error;
                        await loadDashboard();
                    });

                    actions.append(addBtn, withdrawBtn, closeBtn);
                    card.append(meta, amount, progressTrack, actions);
                    savingsGoalsList.append(card);
                }
            } catch {
                // Ignore
            }
        }

        createSavingsGoalForm?.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (savingsGoalStatus) savingsGoalStatus.textContent = 'Creating savings goal...';
            const payload = Object.fromEntries(new FormData(createSavingsGoalForm));
            try {
                const response = await fetch('/api/savings-goals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Could not create savings goal.');
                if (savingsGoalStatus) savingsGoalStatus.textContent = result.message;
                createSavingsGoalForm.reset();
                await loadSavingsGoals();
            } catch (error) {
                if (savingsGoalStatus) savingsGoalStatus.textContent = error.message;
            }
        });

        // Transaction Disputes
        async function loadDisputes() {
            if (!disputesList) return;
            try {
                const response = await fetch('/api/disputes');
                if (!response.ok) return;
                const result = await response.json();
                disputesList.replaceChildren();
                const items = result.disputes || [];
                if (!items.length) {
                    const empty = document.createElement('p');
                    empty.className = 'empty-state';
                    empty.textContent = 'No transaction disputes submitted.';
                    disputesList.append(empty);
                    return;
                }
                for (const item of items) {
                    const card = document.createElement('article');
                    card.className = 'account-card';
                    const meta = document.createElement('span');
                    meta.className = 'account-owner';
                    meta.textContent = `${item.status.toUpperCase()}${item.reversed ? ' (REVERSED)' : ''} · Account ${item.accountNumber} · ${new Date(item.createdAt).toLocaleDateString()}`;
                    const reason = document.createElement('span');
                    reason.className = 'account-number';
                    reason.textContent = `Reason: ${item.reason}${item.resolutionNote ? ` · Admin note: ${item.resolutionNote}` : ''}`;
                    card.append(meta, reason);
                    disputesList.append(card);
                }
            } catch {
                // Ignore
            }
        }

        disputeForm?.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (disputeStatus) disputeStatus.textContent = 'Submitting transaction dispute...';
            const payload = Object.fromEntries(new FormData(disputeForm));
            try {
                const response = await fetch('/api/disputes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Could not submit dispute.');
                if (disputeStatus) disputeStatus.textContent = result.message;
                disputeForm.reset();
                await loadDisputes();
            } catch (error) {
                if (disputeStatus) disputeStatus.textContent = error.message;
            }
        });

        applyTheme();
        loadDashboard();
