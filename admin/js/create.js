const form = document.querySelector('#userForm');
const editForm = document.querySelector('#editUserForm');
const editSection = document.querySelector('#editSection');
const message = document.querySelector('#message');
const customersStatus = document.querySelector('#customersStatus');
const customersTable = document.querySelector('#customersTable');
const activationLinkField = document.querySelector('#activationLinkField');
const activationLink = document.querySelector('#activationLink');
const themeToggle = document.querySelector('#themeToggle');
const logoutButton = document.querySelector('#logoutButton');
const customerFilters = document.querySelector('#customerFilters');
const accountFilters = document.querySelector('#accountFilters');
const accountsStatus = document.querySelector('#accountsStatus');
const adminAccountsTable = document.querySelector('#adminAccountsTable');
const transactionFilters = document.querySelector('#transactionFilters');
const transactionExportStatus = document.querySelector('#transactionExportStatus');
const disputesStatus = document.querySelector('#disputesStatus');
const adminDisputesTable = document.querySelector('#adminDisputesTable');
let customerPage = 1;
let customerTotalPages = 1;
let accountPage = 1;
let accountTotalPages = 1;
let customerSearchTimer;
let accountSearchTimer;

function applyTheme() {
    const isDark = localStorage.getItem('theme') === 'dark';
    document.body.classList.toggle('dark-theme', isDark);
    themeToggle.textContent = isDark ? 'Light' : 'Dark';
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const result = await response.json();
    if (response.status === 401) {
        window.location.replace('/login');
        throw new Error('Your session has expired. Sign in again.');
    }
    if (!response.ok) {
        throw new Error(result.error || 'The request could not be completed.');
    }
    return result;
}

function addCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
    return cell;
}

function makeAction(label, action, id, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `action-btn ${className}`.trim();
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.id = String(id);
    return button;
}

function renderCustomers(users) {
    customersTable.replaceChildren();
    if (users.length === 0) {
        customersStatus.textContent = 'No customers found.';
        return;
    }

    for (const user of users) {
        const row = document.createElement('tr');
        addCell(row, String(user.id));
        addCell(row, user.name);
        addCell(row, user.email);
        const statusCell = addCell(row, '');
        const badge = document.createElement('span');
        badge.className = 'status-badge';
        badge.textContent = user.status;
        statusCell.append(badge);
        addCell(row, new Intl.NumberFormat('en-ZA', {
            style: 'currency',
            currency: user.currency || 'ZAR'
        }).format(Number(user.balance) || 0));

        const actions = document.createElement('td');
        actions.className = 'row-actions';
        actions.append(makeAction('Edit', 'edit', user.id));
        if (user.status !== 'closed') {
            actions.append(makeAction('Close', 'close', user.id, 'danger'));
        }
        row.append(actions);
        customersTable.append(row);
    }
}

async function loadCustomers() {
    customersStatus.textContent = 'Loading customers...';
    try {
        const params = new URLSearchParams(new FormData(customerFilters));
        params.set('page', String(customerPage));
        params.set('limit', '10');
        const result = await requestJson(`/api/users?${params}`);
        customerTotalPages = result.totalPages;
        renderCustomers(result.users);
        customersStatus.textContent = `${result.total} customer${result.total === 1 ? '' : 's'} found.`;
        document.querySelector('#customersPagination').textContent =
            `Page ${result.page} of ${result.totalPages}`;
        document.querySelector('#previousCustomersPage').disabled = result.page <= 1;
        document.querySelector('#nextCustomersPage').disabled = result.page >= result.totalPages;
    } catch (error) {
        customersStatus.textContent = error.message;
    }
}

function renderAccounts(accounts) {
    adminAccountsTable.replaceChildren();
    if (!accounts.length) {
        accountsStatus.textContent = 'No accounts found.';
        return;
    }

    for (const account of accounts) {
        const row = document.createElement('tr');
        addCell(row, account.accountNumber);
        addCell(row, account.owner ? `${account.owner.name} · ${account.owner.email}` : 'Unknown owner');
        addCell(row, account.accountType === 'savings' ? 'Savings' : 'Cheque/current');
        const statusCell = addCell(row, '');
        const badge = document.createElement('span');
        badge.className = 'status-badge';
        badge.textContent = account.status;
        statusCell.append(badge);
        addCell(row, new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(account.balance));
        const actions = document.createElement('td');
        actions.className = 'row-actions';
        if (account.status === 'active') {
            actions.append(makeAction('Freeze', 'freeze-account', account.accountNumber));
        } else if (account.status === 'frozen') {
            actions.append(makeAction('Unfreeze', 'unfreeze-account', account.accountNumber));
        }
        if (account.status !== 'closed') actions.append(makeAction('Close', 'close-account', account.accountNumber, 'danger'));
        else actions.textContent = '—';
        row.append(actions);
        adminAccountsTable.append(row);
    }
}

async function loadAccounts() {
    accountsStatus.textContent = 'Loading accounts...';
    try {
        const params = new URLSearchParams(new FormData(accountFilters));
        params.set('page', String(accountPage));
        params.set('limit', '10');
        const result = await requestJson(`/api/admin/accounts?${params}`);
        accountTotalPages = result.totalPages;
        renderAccounts(result.accounts);
        accountsStatus.textContent = `${result.total} account${result.total === 1 ? '' : 's'} found.`;
        document.querySelector('#accountsPagination').textContent =
            `Page ${result.page} of ${result.totalPages}`;
        document.querySelector('#previousAccountsPage').disabled = result.page <= 1;
        document.querySelector('#nextAccountsPage').disabled = result.page >= result.totalPages;
    } catch (error) {
        accountsStatus.textContent = error.message;
    }
}

async function loadSummary() {
    try {
        const summary = await requestJson('/api/admin/summary');
        document.querySelector('#activeCustomers').textContent = summary.customers.active;
        document.querySelector('#pendingCustomers').textContent = summary.customers.pending;
        document.querySelector('#activeAccounts').textContent = summary.activeAccounts;
        document.querySelector('#totalBalance').textContent = new Intl.NumberFormat('en-ZA', {
            style: 'currency',
            currency: 'ZAR'
        }).format(summary.totalBalance);
        document.querySelector('#totalTransactions').textContent = summary.transactions;
    } catch (error) {
        message.textContent = error.message;
    }
}

function closeEditForm() {
    editForm.reset();
    editSection.hidden = true;
}

themeToggle.addEventListener('click', () => {
    const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
    localStorage.setItem('theme', nextTheme);
    applyTheme();
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = 'Creating customer...';
    activationLinkField.hidden = true;

    const name = document.querySelector('#name').value.trim();
    const email = document.querySelector('#email').value.trim();
    try {
        const result = await requestJson('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email })
        });
        message.textContent = `${result.message} Share the activation link securely with the customer.`;
        activationLink.value = new URL(result.activationPath, window.location.origin).href;
        activationLinkField.hidden = false;
        form.reset();
        await Promise.all([loadCustomers(), loadSummary()]);
    } catch (error) {
        message.textContent = error.message;
    }
});

editForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.querySelector('#editUserId').value;
    message.textContent = 'Saving customer changes...';
    try {
        await requestJson(`/api/users/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: document.querySelector('#editName').value.trim(),
                email: document.querySelector('#editEmail').value.trim()
            })
        });
        message.textContent = `Customer ${id} updated.`;
        closeEditForm();
        await loadCustomers();
    } catch (error) {
        message.textContent = error.message;
    }
});

customersTable.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;

    if (action === 'edit') {
        message.textContent = `Loading customer ${id}...`;
        try {
            const user = await requestJson(`/api/users/${encodeURIComponent(id)}`);
            document.querySelector('#editUserId').value = String(user.id);
            document.querySelector('#editName').value = user.name;
            document.querySelector('#editEmail').value = user.email;
            document.querySelector('#editHeading').textContent = `Edit customer ${user.id}`;
            editSection.hidden = false;
            message.textContent = '';
            document.querySelector('#editName').focus();
        } catch (error) {
            message.textContent = error.message;
        }
        return;
    }

    if (action === 'close' && window.confirm(`Close customer ${id}? This can only be done when all account balances are zero.`)) {
        message.textContent = `Closing customer ${id}...`;
        try {
            const result = await requestJson(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
            message.textContent = result.message || `Customer ${id} closed.`;
            closeEditForm();
            await Promise.all([loadCustomers(), loadSummary()]);
        } catch (error) {
            message.textContent = error.message;
        }
    }
});

document.querySelector('#cancelEditButton').addEventListener('click', closeEditForm);
document.querySelector('#refreshCustomersButton').addEventListener('click', () => {
    loadCustomers();
    loadSummary();
});
document.querySelector('#refreshAccountsButton').addEventListener('click', loadAccounts);

customerFilters.addEventListener('input', (event) => {
    if (event.target.name === 'search') {
        window.clearTimeout(customerSearchTimer);
        customerSearchTimer = window.setTimeout(() => {
            customerPage = 1;
            loadCustomers();
        }, 250);
    }
});
customerFilters.addEventListener('change', () => {
    customerPage = 1;
    loadCustomers();
});
accountFilters.addEventListener('input', (event) => {
    if (event.target.name === 'search') {
        window.clearTimeout(accountSearchTimer);
        accountSearchTimer = window.setTimeout(() => {
            accountPage = 1;
            loadAccounts();
        }, 250);
    }
});
accountFilters.addEventListener('change', () => {
    accountPage = 1;
    loadAccounts();
});
document.querySelector('#previousCustomersPage').addEventListener('click', () => {
    if (customerPage > 1) {
        customerPage -= 1;
        loadCustomers();
    }
});
document.querySelector('#nextCustomersPage').addEventListener('click', () => {
    if (customerPage < customerTotalPages) {
        customerPage += 1;
        loadCustomers();
    }
});
document.querySelector('#previousAccountsPage').addEventListener('click', () => {
    if (accountPage > 1) {
        accountPage -= 1;
        loadAccounts();
    }
});
document.querySelector('#nextAccountsPage').addEventListener('click', () => {
    if (accountPage < accountTotalPages) {
        accountPage += 1;
        loadAccounts();
    }
});

adminAccountsTable.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;

    if (action === 'freeze-account' || action === 'unfreeze-account') {
        const nextStatus = action === 'freeze-account' ? 'frozen' : 'active';
        message.textContent = `${nextStatus === 'frozen' ? 'Freezing' : 'Unfreezing'} account ${id}...`;
        try {
            const result = await requestJson(`/api/admin/accounts/${encodeURIComponent(id)}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: nextStatus })
            });
            message.textContent = result.message;
            await Promise.all([loadAccounts(), loadSummary()]);
        } catch (error) {
            message.textContent = error.message;
        }
        return;
    }

    if (action !== 'close-account') return;
    if (!window.confirm(`Close account ${id}? Its balance must be zero.`)) return;
    message.textContent = `Closing account ${id}...`;
    try {
        const result = await requestJson(`/api/admin/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
        message.textContent = result.message;
        await Promise.all([loadAccounts(), loadCustomers(), loadSummary()]);
    } catch (error) {
        message.textContent = error.message;
    }
});

async function loadDisputes() {
    if (!adminDisputesTable || !disputesStatus) return;
    disputesStatus.textContent = 'Loading disputes...';
    try {
        const result = await requestJson('/api/disputes');
        adminDisputesTable.replaceChildren();
        const disputes = result.disputes || [];
        if (!disputes.length) {
            disputesStatus.textContent = 'No transaction disputes reported.';
            return;
        }
        disputesStatus.textContent = `${disputes.length} dispute${disputes.length === 1 ? '' : 's'} found.`;
        for (const dispute of disputes) {
            const row = document.createElement('tr');
            addCell(row, `${dispute.reporterName} (${dispute.reporterEmail})`);
            addCell(row, dispute.accountNumber);
            addCell(
                row,
                dispute.transactionAmount !== null
                    ? new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(dispute.transactionAmount)
                    : '—'
            );
            addCell(row, dispute.reason);
            const statusCell = addCell(row, '');
            const badge = document.createElement('span');
            badge.className = 'status-badge';
            badge.textContent = `${dispute.status}${dispute.reversed ? ' (reversed)' : ''}`;
            statusCell.append(badge);

            const actions = document.createElement('td');
            actions.className = 'row-actions';
            if (dispute.status === 'open') {
                actions.append(
                    makeAction('Reverse & resolve', 'reverse-dispute', dispute.id),
                    makeAction('Resolve only', 'resolve-dispute', dispute.id),
                    makeAction('Reject', 'reject-dispute', dispute.id, 'danger')
                );
            } else {
                actions.textContent = dispute.resolutionNote || '—';
            }
            row.append(actions);
            adminDisputesTable.append(row);
        }
    } catch (error) {
        disputesStatus.textContent = error.message;
    }
}

document.querySelector('#refreshDisputesButton')?.addEventListener('click', loadDisputes);

adminDisputesTable?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    const isReversal = action === 'reverse-dispute';
    const nextStatus = action === 'reject-dispute' ? 'rejected' : 'resolved';
    const note = window.prompt(
        `Enter an optional resolution note for this dispute (${isReversal ? 'will reverse funds and resolve' : nextStatus}):`,
        isReversal ? 'Approved and reversed by administrator.' : ''
    );
    if (note === null) return;
    message.textContent = 'Updating dispute...';
    try {
        const result = await requestJson(`/api/admin/disputes/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: nextStatus,
                resolutionNote: note,
                reverseTransaction: isReversal
            })
        });
        message.textContent = result.message;
        await Promise.all([loadDisputes(), loadAccounts(), loadCustomers(), loadSummary()]);
    } catch (error) {
        message.textContent = error.message;
    }
});

transactionFilters.addEventListener('submit', async (event) => {
    event.preventDefault();
    const params = new URLSearchParams(new FormData(transactionFilters));
    const accountNumber = params.get('accountNumber');
    if (accountNumber && !/^\d{10}$/.test(accountNumber)) {
        transactionExportStatus.textContent = 'Account number must be exactly 10 digits.';
        return;
    }
    const button = document.querySelector('#exportTransactionsButton');
    button.disabled = true;
    transactionExportStatus.textContent = 'Preparing CSV statement...';
    try {
        const response = await fetch(`/api/transactions.csv?${params}`);
        if (!response.ok) {
            const result = await response.json();
            if (response.status === 401) return window.location.replace('/login');
            throw new Error(result.error || 'Statement export failed.');
        }
        const objectUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `sky-bank-statement-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        transactionExportStatus.textContent = 'Statement downloaded.';
    } catch (error) {
        transactionExportStatus.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

logoutButton.addEventListener('click', async () => {
    try {
        await requestJson('/api/auth/logout', { method: 'POST' });
        window.location.replace('/login');
    } catch (error) {
        message.textContent = error.message;
    }
});

applyTheme();
Promise.all([loadCustomers(), loadAccounts(), loadSummary(), loadDisputes()]);
