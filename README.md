# Task 2 REST API

A simple full-stack project built with Node.js, Express, MongoDB, and vanilla JavaScript. It exposes a CRUD API for user records and includes a small browser page that displays the saved users.

## Project Overview

This project satisfies the requirements for:
- Level 1, Task 2: Build a Simple REST API
- Level 1, Task 3: Frontend with HTML, CSS, and JavaScript

It includes:
- An Express server
- MongoDB integration using Mongoose
- User CRUD endpoints
- Input validation and error handling
- A static frontend page that fetches and displays users

## Tech Stack

- Node.js
- Express.js
- MongoDB
- Mongoose
- HTML, CSS, JavaScript
- dotenv

## Project Structure

- `server.js` – Express server and API logic
- `index.html` – Frontend page that displays the user list
- `.env` – Local environment variables (not committed)
- `package.json` – Project dependencies and scripts

## Prerequisites

Before running the project, make sure you have:

- Node.js installed
- npm installed
- MongoDB running locally or a MongoDB Atlas connection string

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

3. Create a `.env` file in the project root and add your MongoDB connection string:
   ```env
   PORT=5000
   MONGODB_URI=mongodb://localhost:27017/task2-rest-api
   ```

   If you are using MongoDB Atlas, use your connection string instead:
   ```env
   PORT=5000
   MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-url>/<database-name>
   ```

## Running the Project

Start the server:

```bash
node server.js
```

Then open the browser at:

```text
http://localhost:5000
```

The homepage loads the HTML page and fetches the list of users from the API.

## API Endpoints

### Create a User

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

**Response**
```json
{
  "id": 10000,
  "name": "Alice Johnson",
  "email": "alice@example.com",
  "createdAt": "2026-11-05T12:00:00.000Z",
  "updatedAt": "2026-11-05T12:00:00.000Z"
}
```

### Get All Users

**Request**
```http
GET /api/users
```

**Response**
```json
[
  {
    "id": 10000,
    "name": "Alice Johnson",
    "email": "alice@example.com"
  }
]
```

### Get One User

**Request**
```http
GET /api/users/:id
```

Example:
```http
GET /api/users/10000
```

### Update a User

**Request**
```http
PUT /api/users/:id
Content-Type: application/json
```

**Body**
```json
{
  "name": "Alice Updated",
  "email": "alice.updated@example.com"
}
```

### Delete a User

**Request**
```http
DELETE /api/users/:id
```

## Error Handling

The API returns common HTTP status codes:

- `200` – success
- `201` – resource created
- `400` – bad request
- `404` – user not found
- `409` – duplicate email
- `500` – server error
- `503` – database or ID generation issue

## Notes

- User IDs are generated as five-digit numbers starting from `10000`.
- Email addresses must be unique.
- The API transforms MongoDB documents to return a cleaner JSON response.
- The frontend is intentionally simple and uses the Fetch API to display data.

## Testing in Postman or Thunder Client

You can test the API with Postman or the VS Code Thunder Client extension:

1. Start the server.
2. Send requests to `http://localhost:5000/api/users`
3. Use JSON body data for POST and PUT methods.

## Future Improvements

Possible next upgrades:
- Add user creation form in the frontend
- Add update and delete actions from the browser UI
- Add authentication and JWT
- Add React frontend for the same API

## License

ISC