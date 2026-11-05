// Load environment variables such as MONGODB_URI and PORT from the local .env file.
// This keeps database credentials and runtime config out of the source code.
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

// Create the Express application and choose the port to listen on.
// PORT defaults to 5000 so the app can still run locally when no environment variable is set.
const app = express();
const PORT = process.env.PORT || 5000;

// JSON middleware converts incoming request bodies into JavaScript objects.
// Without this, req.body would be undefined for POST and PUT requests.
app.use(express.json());

// Serve the browser page from the root URL so a user can view all saved users in the table.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// A Mongoose schema defines the structure of each user document in MongoDB.
// It also enforces validation rules such as required fields and numeric ID constraints.
// The timestamps option automatically adds createdAt and updatedAt to every document.
// The unique option prevents duplicate email addresses from being stored.
const userSchema = new mongoose.Schema({
  userId: {
    type: Number,
    required: true,
    min: 10000,
    max: 99999,
    validate: Number.isInteger,
    unique: true,
    sparse: true
  },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true }
}, {
  timestamps: true,
  toJSON: {
    transform: (document, result) => {
      result.id = result.userId;
      delete result.userId;
      delete result._id;
      delete result.__v;
      return result;
    }
  }
});

// The User model is the MongoDB collection interface we use in all route handlers.
// It exposes methods such as find(), findOne(), create(), updateOne(), and deleteOne().
const User = mongoose.model('User', userSchema);

// This counter table keeps track of the next available user ID.
// Using a separate counter avoids collisions when multiple users are created quickly.
const counterSchema = new mongoose.Schema({
  _id: String,
  sequence: { type: Number, required: true }
});
const Counter = mongoose.model('Counter', counterSchema);

let databaseReady = false;

// This helper creates a new five-digit user ID by incrementing the shared counter.
// The sequence is stored in MongoDB so the ID is unique even if the server restarts.
async function nextUserId() {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'users' },
    { $inc: { sequence: 1 } },
    { new: true }
  );

  // Once the sequence reaches 100000, no more valid IDs are available in the five-digit range.
  if (!counter || counter.sequence > 99999) {
    const error = new Error('All five-digit user IDs have been used.');
    error.code = 'USER_IDS_EXHAUSTED';
    throw error;
  }

  return counter.sequence;
}

// When the app starts, it must ensure that the database has every required index and counter value.
// This prevents duplicate user IDs and keeps legacy records compatible with the public API format.
async function initializeUserIds() {
  await User.init(); // Create the unique indexes before assigning public IDs.

  const highestAssignedUser = await User.findOne({ userId: { $exists: true } })
    .sort({ userId: -1 })
    .select('userId')
    .lean();
  const startingSequence = Math.max(9999, highestAssignedUser?.userId || 9999);

  // Keep the counter at least as high as the IDs already stored in MongoDB.
  await Counter.updateOne(
    { _id: 'users' },
    { $max: { sequence: startingSequence } },
    { upsert: true }
  );

  // Any older records without a userId are backfilled so the whole API always returns the same shape.
  const usersWithoutId = await User.find({ userId: { $exists: false } })
    .select('_id')
    .lean();
  for (const user of usersWithoutId) {
    const userId = await nextUserId();
    await User.updateOne(
      { _id: user._id, userId: { $exists: false } },
      { $set: { userId } }
    );
  }
}

// Block API routes until MongoDB is connected and the ID counter has been initialized.
// This avoids race conditions where requests hit the database before the app is ready.
app.use('/api', (req, res, next) => {
  if (!databaseReady) {
    return res.status(503).json({ error: 'The database is not ready yet.' });
  }
  next();
});

// Connect to MongoDB, initialize the ID sequence, and then unlock the API.
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    await initializeUserIds();
    databaseReady = true;
    console.log('Connected to MongoDB Atlas successfully!');
  })
  .catch((err) => console.error('MongoDB initialization error:', err));

// POST /api/users creates a new user from the JSON body that the browser or client sends.
// The route validates input, assigns a unique five-digit ID, and stores the document in MongoDB.
app.post('/api/users', async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      // 400 means the client did not provide all required fields.
      return res.status(400).json({ error: 'Name and email are required.' });
    }

    const userId = await nextUserId();
    const newUser = new User({ userId, name, email });
    await newUser.save(); // Save the new document to MongoDB.
    res.status(201).json(newUser); // 201 means a resource was created.
  } catch (error) {
    if (error.code === 'USER_IDS_EXHAUSTED') {
      return res.status(503).json({ error: error.message });
    }
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }
    // Send an error response if validation or the database operation fails.
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users returns the complete list of users in JSON format.
// The frontend uses this endpoint to render the table on the main page.
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users/:id fetches one document by its five-digit public ID.
// The regex makes sure the URL uses exactly five numeric characters before querying MongoDB.
app.get('/api/users/:id', async (req, res) => {
  if (!/^\d{5}$/.test(req.params.id)) {
    return res.status(400).json({ error: 'User ID must be exactly five digits.' });
  }

  try {
    const user = await User.findOne({ userId: Number(req.params.id) });
    if (!user) {
      // 404 means the requested ID does not match a saved user.
      return res.status(404).json({ error: 'User not found.' });
    }
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/users/:id updates the selected user with new name and email values.
// runValidators ensures the schema rules are checked before the update is saved.
app.put('/api/users/:id', async (req, res) => {
  if (!/^\d{5}$/.test(req.params.id)) {
    return res.status(400).json({ error: 'User ID must be exactly five digits.' });
  }

  try {
    const { name, email } = req.body;
    const updatedUser = await User.findOneAndUpdate(
      { userId: Number(req.params.id) },
      { name, email },
      { new: true, runValidators: true } // Return the updated user and check schema rules.
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.status(200).json(updatedUser);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/users/:id removes a single user record from MongoDB.
// The response returns a short confirmation message plus the deleted user data for debugging or UI use.
app.delete('/api/users/:id', async (req, res) => {
  if (!/^\d{5}$/.test(req.params.id)) {
    return res.status(400).json({ error: 'User ID must be exactly five digits.' });
  }

  try {
    const deletedUser = await User.findOneAndDelete({ userId: Number(req.params.id) });
    if (!deletedUser) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.status(200).json({ message: 'User deleted successfully.', user: deletedUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start accepting HTTP requests after all routes have been defined.
// Express will then listen for incoming browser and API calls on the configured port.
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});