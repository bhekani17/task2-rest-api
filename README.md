# Sky Bank

A Sky Bank full-stack application built with Node.js, Express, MongoDB, and vanilla JavaScript. The selected internship scope covers two tasks at each level: Level 1 Tasks 2 and 3, Level 2 Tasks 2 and 3, and Level 3 Tasks 1 and 2.

## Project Overview

It includes:
- An Express server
- MongoDB integration using Mongoose
- Customer accounts with generated account numbers
- Integer-cent balance storage to avoid floating-point rounding in money calculations
- Atomic internal transfers with a MongoDB transaction ledger
- bcrypt password hashes, signed JWTs in HttpOnly cookies, and customer/administrator access controls
- Legacy plaintext and scrypt passwords are upgraded to bcrypt after a successful sign-in
- Authenticated, user-specific WebSocket notifications for completed transfers
- Input validation and error handling
- A responsive dashboard with account cards, transfer controls, and recent activity; desktop layout fits one viewport while long lists scroll within their panels

## Internship Rubric Map

| Level and selected task | Evidence in this project |
|---|---|
| Level 1, Task 2: REST API | Express routes provide CRUD, validation, status codes, and error handling. |
| Level 1, Task 3: HTML/CSS/JavaScript frontend | Responsive pages use vanilla JavaScript and Fetch to display API data. |
| Level 2, Task 2: Authentication/authorization | bcrypt password hashing, HS256 JWTs in HttpOnly cookies, signed-in route guards, role checks, and rate limiting. |
| Level 2, Task 3: Database integration | Mongoose models, validation, unique/TTL indexes, and MongoDB-backed account/ledger data. |
| Level 3, Task 1: Full-stack application | Express serves the frontend and API; Docker/Render deployment configuration is included. A live deployment still requires a MongoDB URI and hosting account setup. |
| Level 3, Task 2: WebSockets | Socket.IO authenticates with the JWT cookie and sends transfer notifications only to the involved users. |

This selection intentionally keeps the existing vanilla frontend instead of introducing a JavaScript framework. The task sheet requires only two tasks per level.

## Project Analysis and Delivery Stages

The project is a small full-stack monolith organized by responsibility: `server.js` configures the app and startup lifecycle, while page/API routes, middleware, models, and business services live in focused modules. Browser styles and scripts are external files under the page asset folders. MongoDB is the persistence layer, and there is no payment-card, bill-payment, email/SMS, or external banking provider integration.

Work is delivered in stages:

1. **Foundation:** secure JWT sign-in with revocable session records, customer/admin authorization, customer-scoped account/history data, and retry-safe internal transfers.
2. **Account services (demo):** multiple cheque/current and savings accounts per customer, with account ownership and balance controls.
3. **Payments and cards:** provider interfaces, beneficiary management, bill-pay/scheduled-payment workflows, and tokenized card controls. Actual payment/card processing requires a selected regulated provider.
4. **Savings and statements (demo):** 12% annual nominal savings interest credited monthly, plus downloadable CSV statements. Provider-backed products and persistent/email/SMS notifications remain future work.

This repository is not a production banking system. Production use requires an approved banking/payment provider, regulatory and operational controls, security review, monitoring, recovery procedures, and independently validated deployment infrastructure. The dashboard's demo deposit only adds simulated funds in non-production environments; real deposits and withdrawals require an authorized provider workflow.

## Tech Stack

- Node.js
- Express.js
- Socket.IO
- MongoDB
- Mongoose
- bcryptjs and JSON Web Tokens
- HTML, CSS, JavaScript
- dotenv

## Project Structure

- `server.js` – Express app configuration, dependency wiring, and startup lifecycle
- `routes/` – Public page routes and API route groups for authentication, accounts, transactions, and administration
- `middleware/` – Authentication/authorization and API readiness/origin checks
- `models/` – Mongoose schemas and model exports
- `services/` – Account lifecycle/interest and transaction parsing/filtering/CSV logic
- `lib/` – Session handling, password utilities, and shared HTTP helpers
- `client/index.html` – Dashboard overview with account and recent-activity summaries
- `client/accounts.html` – Account list, balances, and account opening
- `client/transfers.html` – Internal transfers and demo deposits
- `client/transactions.html` – Searchable transaction history and CSV statements
- `client/css/` and `client/js/` – Customer page styles and browser behavior
- `client/welcome.html` – Public landing page for signed-out visitors
- `admin/create.html` – Administrator page for creating customer accounts
- `admin/css/` and `admin/js/` – Administrator page styles and browser behavior
- `client/activate.html` – Customer password setup from a one-time activation link
- `client/login.html` – Login page for existing users
- `client/register.html` – Registration page for creating new accounts
- `Dockerfile` and `render.yaml` – Container and Render deployment configuration
- `images/bg.png` – Supplied Sky Bank logo artwork used in the page navigation and browser tab
- `images/home.png` – Branch photo used in the dashboard banner
- `images/logo.png` – Original supplied logo; its checkerboard background is baked into the image
- `.env` – Local environment variables (not committed)
- `package.json` – Project dependencies and scripts

## Prerequisites

Before running the project, make sure you have:

- Node.js installed
- npm installed
- MongoDB Atlas or a local MongoDB replica set (required for transactional banking operations)

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd task2-rest-api
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and set your MongoDB connection string and a private JWT secret of at least 32 characters:
   ```env
   PORT=5000
   MONGODB_URI=mongodb://localhost:27017/task2-rest-api?replicaSet=rs0
   JWT_SECRET=replace-with-at-least-32-random-characters
   ```

   If you are using MongoDB Atlas, use your connection string instead:
   ```env
   PORT=5000
   MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-url>/<database-name>
   ```

## Running the Project

Start the server:

```bash
npm start
```

Then open the browser at:

```text
http://localhost:5000
```

Customer pages (`/dashboard`) require an active session. `/create` requires the `admin` role; the activation page is reachable only with a valid one-time link.

The app opens on the welcome page. Signed-out users can choose sign-in or registration; active sessions are sent directly to the dashboard. You can also visit:

```text
http://localhost:5000/
http://localhost:5000/login
http://localhost:5000/register
http://localhost:5000/dashboard
http://localhost:5000/create
```

The dashboard displays the signed-in customer's account and transaction history. Registration opens an account; administrators can create pending accounts and share the generated activation link securely.

Internal transfers require MongoDB Atlas or a local MongoDB replica set because balance changes and ledger entries are committed in database transactions.

## API Endpoints

### Create a Customer (administrator)

**Request**
```http
POST /api/users
Content-Type: application/json
```

**Body**
```json
{
  "name": "Alice Johnson",
  "email": "alice@example.com"
}
```

`POST /api/users` is administrator-only and creates a pending account plus a 24-hour activation link. The operator must deliver that link securely because no email provider is configured. Customer self-registration is provided by `POST /api/auth/register`.

**Response**
```json
{
  "message": "Customer account created. Customer activation is pending.",
  "user": {
    "id": 10000,
    "name": "Alice Johnson",
    "email": "alice@example.com",
    "role": "customer",
    "status": "pending",
    "accountNumber": "1000000000",
    "balance": 0,
    "currency": "ZAR"
  }
}
```

### List Customer Accounts

**Request**
```http
GET /api/accounts
```

This dashboard endpoint returns account numbers and balances in ZAR. The older `GET /api/users` endpoint remains available for compatibility.

Customers can open up to three cheque/current or savings accounts in total, including their first account, with `POST /api/accounts`. The limit is enforced atomically by the API, including when account-opening requests arrive concurrently:

```json
{ "accountType": "savings" }
```

Existing single-account customers are migrated to a cheque/current account when the server starts. Savings accounts use a demo-only rate of 12% per year, calculated as 1% monthly and rounded to cents. The server credits completed calendar months on its hourly check, using the balance at the time the check runs; the monthly credit compounds into the next period. Simulated interest is disabled in production and is not a real banking product.

### Compatibility Customer Endpoints

The existing `GET`, `PUT`, and `DELETE /api/users/:id` endpoints remain available for the original CRUD exercise.

### Authentication Endpoints

- `POST /api/auth/register` – Register and open an account (12-128 character password)
- `POST /api/auth/login` – Authenticate and set an HttpOnly JWT cookie
- `POST /api/auth/activate` – Set a password and activate an administrator-created account
- `GET /api/auth/me` – Return the signed-in user's account summary
- `POST /api/auth/logout` – Revoke the current session

JWTs expire after 12 hours and are stored in HttpOnly, SameSite=Strict cookies (Secure in production). The server also stores a hash of each token in MongoDB so logout and account closure revoke sessions. Login attempts are limited per client IP. Existing plaintext and scrypt passwords are migrated to bcrypt after successful login. Existing users may need to sign in again after upgrading because pre-upgrade session cookies are invalidated.

### Banking Endpoints

- `GET /api/transactions` – List a page of ledger entries (25 by default)
- `GET /api/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD&type=transfer&accountNumber=1000000000` – Filter and page through ledger entries
- `GET /api/transactions.csv?from=YYYY-MM-DD&to=YYYY-MM-DD&type=transfer&accountNumber=1000000000` – Download a filtered CSV statement
- `GET /api/accounts/:accountNumber/transactions` – List an account's latest 100 ledger entries
- `POST /api/transactions` – Transfer funds or make a demo deposit

Transaction search accepts optional `from`, `to`, `type`, `accountNumber`, `page`, and `limit` query parameters. Types include transfers, demo deposits, withdrawals, and savings interest. Dates are inclusive UTC calendar dates; JSON results use pages of 25 entries by default (up to 100), with total/page metadata in response headers. Customer requests are always restricted to their own accounts, even when filters are supplied. CSV exports use the same filters and ownership checks, are capped at 5,000 rows, and require both start and end dates if account history exceeds that cap. CSV descriptions are escaped against spreadsheet formula injection.

## Real-Time Notifications

The dashboard opens an authenticated Socket.IO connection using the same HttpOnly JWT cookie as the REST API. After a transfer commits, the server emits `transfer:completed` only to the sender's and recipient's user rooms. The event contains a short message and transaction ID; clients refresh their authorized REST data for updated balances/history. The ledger remains the source of truth if a client is offline during an event.

Account and transaction reads are customer-scoped; customer account opening is limited to the signed-in customer, while the customer directory, customer creation, and customer closure require the `admin` role. An operator must assign the first admin role through a trusted database administration process; public registration cannot grant admin privileges.

Example transfer:

```json
{
  "type": "transfer",
  "accountNumber": "1000000000",
  "destinationAccountNumber": "1000000001",
  "amount": "25.50",
  "description": "Transfer"
}
```

Include a unique `Idempotency-Key` header (16-128 characters) so network retries cannot post the same transaction twice. Reusing the key with a different request returns a conflict. Amounts must be positive and have no more than two decimal places. Transfers reject insufficient funds, and balance changes plus ledger entries are committed atomically.

`POST /api/transactions` also accepts `type: "deposit"` for the signed-in user's own account in non-production environments. This demo-only operation atomically credits simulated funds and creates a ledger entry with `DEMO-FUNDING` as its source. It is disabled when `NODE_ENV=production` and must not be used to represent or process real money. Withdrawals return `501` until a banking provider is configured.

```http
Idempotency-Key: 0b0f385f413d4d8c8a9e516c4e6f317e
```

To grant the initial administrator role, first register the operator account, then use a trusted MongoDB administration session:

```javascript
db.users.updateOne(
  { email: "operator@example.com" },
  { $set: { role: "admin" } }
)
```

Do not expose database administration credentials or create a public admin-bootstrap endpoint.

The administrator-only `GET /api/users` endpoint returns customer summaries:
```json
[
  {
    "id": 10000,
    "name": "Alice Johnson",
    "email": "alice@example.com",
    "role": "customer",
    "status": "active",
    "accountNumber": "1000000000",
    "balance": 0,
    "currency": "ZAR"
  }
]
```

## Error Handling

The API returns common HTTP status codes:

- `200` – success
- `201` – resource created
- `400` – bad request
- `404` – user not found
- `409` – duplicate email
- `401` – sign-in required or invalid credentials
- `403` – insufficient role/account access
- `429` – sign-in rate limit exceeded
- `501` – withdrawals unavailable without a provider
- `500` – server error
- `503` – database or ID generation issue

## Notes

- Customer IDs are generated as five-digit numbers; account numbers are generated as ten-digit numbers starting from `1000000000`.
- All displayed money is in South African rand (ZAR); balances are stored as integer cents.
- Email addresses must be unique.
- Run `npm test` for password hashing, legacy hash migration, and amount-validation unit tests.
- The frontend is intentionally simple and uses the Fetch API to display data.

## Testing in Postman or Thunder Client

You can test the API with Postman or the VS Code Thunder Client extension:

1. Start the server and register/sign in to receive an HttpOnly JWT cookie.
2. Send requests to the authenticated endpoints at `http://localhost:5000/api`.
3. Include the JWT cookie and an `Idempotency-Key` header for transfers.

## Deployment

The included `Dockerfile` and `render.yaml` deploy the combined Express frontend/API as one Render web service. Create a MongoDB Atlas database, connect the Render service, and deploy the Blueprint; Render generates `JWT_SECRET` from the configuration. The `/health` endpoint is used for readiness checks. A successful cloud deployment cannot be completed without an operator-owned MongoDB database and hosting account.

Docker is not installed in the current development environment, so the image could not be built here. Validate it in a Docker-enabled environment before deployment.

## Future Improvements

A real banking/payment provider, beneficiaries and scheduled bill payments, tokenized cards, regulatory controls, production-grade interest calculations, and persistent/email/SMS notifications remain future stages.

## License

ISC